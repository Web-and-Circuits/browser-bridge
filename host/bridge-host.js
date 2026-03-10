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
const REPO_ROOT = dirname(ROOT); // .bridge is inside the repo root

let buf = Buffer.alloc(0);
const pending = new Map();
let promptRunning = false;

// ── Native messaging framing ───────────────────────────────────────────────

function send(msg) {
  const json = Buffer.from(JSON.stringify(msg));
  const hdr  = Buffer.alloc(4);
  hdr.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([hdr, json]));
}

// ── Stdin (messages from extension) ───────────────────────────────────────

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
        handlePrompt(msg.message, msg.id).catch(err => {
          send({ kind: 'stream-end', id: msg.id, ok: false, error: err.message });
        });
      }
    } catch {}
  }
});

// ── Prompt → claude subprocess ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a browser automation agent with bash access to the active Chrome tab.

Bridge commands (run from ${REPO_ROOT}):
  ./bridge.js ping
  ./bridge.js get_active_tab
  ./bridge.js snapshot                      # visible text + links
  ./bridge.js snapshot --selector "<css>"   # scope to element
  ./bridge.js snapshot --mode forms         # extract inputs/labels
  ./bridge.js run_js "<expression>"         # evaluate JS in page
  ./bridge.js click "<selector>"            # click element
  ./bridge.js fill "<selector>" "<value>"   # set input value
  ./bridge.js navigate "<url>"              # navigate tab

Rules:
- Start by snapshotting the page to understand current state.
- Print what you're doing before each command.
- Be concise. Show your work. Complete the task.`;

async function handlePrompt(message, id) {
  if (promptRunning) {
    send({ kind: 'stream', id, chunk: '[busy — another prompt is running]\n' });
    send({ kind: 'stream-end', id, ok: false });
    return;
  }
  promptRunning = true;

  const claudeBin = process.env.CLAUDE_PATH || 'claude';
  const args = [
    '-p', message,
    '--allowedTools', 'Bash',
    '--system', SYSTEM_PROMPT,
  ];

  const proc = spawn(claudeBin, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, BROWSER_BRIDGE_DIR: ROOT },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', chunk => {
    send({ kind: 'stream', id, chunk: chunk.toString() });
  });

  proc.stderr.on('data', chunk => {
    // surface stderr as a dim prefix so it's visible but distinct
    send({ kind: 'stream', id, chunk: '[err] ' + chunk.toString(), dim: true });
  });

  proc.on('close', code => {
    promptRunning = false;
    send({ kind: 'stream-end', id, ok: code === 0 });
  });

  proc.on('error', err => {
    promptRunning = false;
    const hint = err.code === 'ENOENT'
      ? `\n\nclaude CLI not found. Install it or set CLAUDE_PATH in host/run.sh.\n`
      : '\n\n' + err.message + '\n';
    send({ kind: 'stream', id, chunk: hint });
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
