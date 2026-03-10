#!/usr/bin/env node
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';

const ROOT      = resolve(process.env.BROWSER_BRIDGE_DIR || join(os.homedir(), '.browser-bridge'));
const REQUESTS  = join(ROOT, 'requests');
const INFLIGHT  = join(ROOT, 'requests-inflight');
const RESPONSES = join(ROOT, 'responses');
const STATE     = join(ROOT, 'state');
const REPO_ROOT = dirname(ROOT); // .bridge lives inside the repo

let buf = Buffer.alloc(0);
const pending = new Map();
let promptRunning  = false;
let currentSession = null; // session-mode session ID

// ── Native messaging framing ───────────────────────────────────────────────

function send(msg) {
  const json = Buffer.from(JSON.stringify(msg));
  const hdr  = Buffer.alloc(4);
  hdr.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([hdr, json]));
}

// ── Stdin ──────────────────────────────────────────────────────────────────

process.stdin.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.slice(4, 4 + len).toString('utf8');
    buf = buf.slice(4 + len);
    try {
      const msg = JSON.parse(body);
      if (msg.kind === 'response' && msg.response?.id) {
        pending.set(msg.response.id, msg.response);
      }
      if (msg.kind === 'prompt') {
        handlePrompt(msg).catch(err => {
          send({ kind: 'stream', id: msg.id, chunk: '\n[error] ' + err.message + '\n', streamType: 'error' });
          send({ kind: 'stream-end', id: msg.id, ok: false });
          promptRunning = false;
        });
      }
      if (msg.kind === 'reset-session') {
        currentSession = null;
      }
    } catch {}
  }
});

// ── Claude subprocess ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a browser automation agent. You have bash access to the active Chrome tab via bridge.js.

Commands (run from the working directory):
  ./bridge.js ping
  ./bridge.js get_active_tab
  ./bridge.js snapshot                       # visible text + links
  ./bridge.js snapshot --selector "<css>"    # scope to a CSS element
  ./bridge.js snapshot --mode forms          # extract form inputs + labels
  ./bridge.js run_js "<js expression>"       # evaluate JS in page context
  ./bridge.js click "<css selector>"         # click element
  ./bridge.js fill "<css selector>" "<val>"  # set input value
  ./bridge.js navigate "<url>"               # navigate tab

Always snapshot first to understand the page. Show your work briefly. Be concise.`;

// Parse stream-json events from claude --output-format stream-json
function handleStreamEvent(id, event, mode) {
  switch (event.type) {
    case 'system':
      if (event.session_id) {
        if (mode === 'session') currentSession = event.session_id;
        send({ kind: 'session-id', id, sessionId: event.session_id });
      }
      break;

    case 'assistant': {
      const content = event.message?.content || [];
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          send({ kind: 'stream', id, chunk: block.text, streamType: 'text' });
        }
        if (block.type === 'tool_use') {
          const cmd = block.input?.command || `[${block.name}]`;
          send({ kind: 'stream', id, chunk: '$ ' + cmd + '\n', streamType: 'tool-call' });
        }
      }
      break;
    }

    case 'user': {
      const content = event.message?.content || [];
      for (const block of content) {
        if (block.type === 'tool_result') {
          const text = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content, null, 2);
          if (text) send({ kind: 'stream', id, chunk: text.slice(0, 3000) + '\n', streamType: 'tool-result' });
        }
      }
      break;
    }

    case 'result':
      if (event.session_id) {
        if (mode === 'session') currentSession = event.session_id;
        send({ kind: 'session-id', id, sessionId: event.session_id });
      }
      break;
  }
}

async function handlePrompt({ id, message, mode = 'amnesia', resumeId = null }) {
  if (promptRunning) {
    send({ kind: 'stream', id, chunk: '[busy — another prompt is running]\n', streamType: 'error' });
    send({ kind: 'stream-end', id, ok: false });
    return;
  }
  promptRunning = true;

  const claudeBin = process.env.CLAUDE_PATH || 'claude';
  const args = [
    '-p', message,
    '--output-format', 'stream-json',
    '--allowedTools', 'Bash',
    '--system', SYSTEM_PROMPT,
  ];

  // Mode determines whether and which session to resume
  if (mode === 'session' && currentSession) {
    args.push('--resume', currentSession);
  } else if (mode === 'terminal' && resumeId) {
    args.push('--resume', resumeId);
  }
  // amnesia: no --resume

  const proc = spawn(claudeBin, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, BROWSER_BRIDGE_DIR: ROOT },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let lineBuf = '';

  function flushLine(line) {
    if (!line.trim()) return;
    try {
      handleStreamEvent(id, JSON.parse(line), mode);
    } catch {
      // Not JSON — pass through as raw text
      send({ kind: 'stream', id, chunk: line + '\n', streamType: 'text' });
    }
  }

  proc.stdout.on('data', chunk => {
    lineBuf += chunk.toString();
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop();
    for (const line of lines) flushLine(line);
  });

  proc.stderr.on('data', chunk => {
    send({ kind: 'stream', id, chunk: chunk.toString(), streamType: 'error' });
  });

  proc.on('close', code => {
    if (lineBuf) flushLine(lineBuf);
    promptRunning = false;
    send({ kind: 'stream-end', id, ok: code === 0 });
  });

  proc.on('error', err => {
    promptRunning = false;
    const msg = err.code === 'ENOENT'
      ? 'claude CLI not found. Install it or set CLAUDE_PATH in host/run.sh.\n'
      : err.message + '\n';
    send({ kind: 'stream', id, chunk: msg, streamType: 'error' });
    send({ kind: 'stream-end', id, ok: false });
  });
}

// ── File queue loop ────────────────────────────────────────────────────────

async function ensureDirs() {
  for (const d of [REQUESTS, INFLIGHT, RESPONSES, STATE]) {
    await mkdir(d, { recursive: true });
  }
}

async function claim() {
  const names = (await readdir(REQUESTS)).filter(n => n.endsWith('.json')).sort();
  const claimed = [];
  for (const name of names) {
    try {
      await rename(join(REQUESTS, name), join(INFLIGHT, name));
      claimed.push(name);
    } catch {}
  }
  return claimed;
}

async function handle(name) {
  const path    = join(INFLIGHT, name);
  const request = JSON.parse(await readFile(path, 'utf8'));
  send({ kind: 'request', request });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const res = pending.get(request.id);
    if (res) {
      pending.delete(request.id);
      await writeFile(join(RESPONSES, name), JSON.stringify(res, null, 2) + '\n');
      await rm(path, { force: true });
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  await writeFile(join(RESPONSES, name), JSON.stringify({
    id: request.id, ok: false,
    createdAt: new Date().toISOString(),
    result: null,
    error: { message: 'Timeout', code: 'TIMEOUT' }
  }, null, 2) + '\n');
  await rm(path, { force: true });
}

async function loop() {
  await ensureDirs();
  while (true) {
    for (const name of await claim()) await handle(name);
    await new Promise(r => setTimeout(r, 300));
  }
}

loop().catch(async err => {
  await mkdir(STATE, { recursive: true });
  await writeFile(join(STATE, 'host-error.log'),
    `${new Date().toISOString()} ${err.stack || err.message}\n`, { flag: 'a' });
  process.exit(1);
});
