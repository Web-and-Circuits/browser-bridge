#!/usr/bin/env node
/**
 * server.js — WebSocket server mode for browser-bridge
 *
 * Alternative to the native messaging host for environments where
 * Chrome extensions are blocked by policy.
 *
 * Usage:
 *   node server.js [port]          (default port: 9876)
 *
 * Then add the bookmarklet to your browser (see bookmarklet.js).
 * The bridge CLI and file protocol work exactly the same.
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT     = parseInt(process.argv[2] || process.env.BRIDGE_PORT || '9876', 10);
const ROOT     = resolve(process.env.BROWSER_BRIDGE_DIR
               || join(dirname(fileURLToPath(import.meta.url)), '.bridge'));
const REQUESTS = join(ROOT, 'requests');
const INFLIGHT = join(ROOT, 'requests-inflight');
const RESPONSES = join(ROOT, 'responses');
const ARCHIVE  = join(ROOT, 'archive');
const STATE    = join(ROOT, 'state');

const pending = new Map(); // id → response
let client = null;         // one bookmarklet at a time

// ── WebSocket server ───────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('browser-bridge server running\n');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', ws => {
  if (client) client.terminate(); // replace stale connection
  client = ws;
  console.log('[bridge] bookmarklet connected');

  ws.on('message', raw => {
    try {
      const response = JSON.parse(raw);
      if (response?.id) pending.set(response.id, response);
    } catch {}
  });

  ws.on('close', () => {
    if (client === ws) { client = null; console.log('[bridge] bookmarklet disconnected'); }
  });

  ws.on('error', () => {});
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge] server listening on ws://localhost:${PORT}`);
  console.log(`[bridge] queue: ${ROOT}`);
  console.log(`[bridge] add the bookmarklet (bookmarklet.js) to your browser`);
});

// ── File queue ─────────────────────────────────────────────────────────────

async function ensureDirs() {
  for (const d of [REQUESTS, INFLIGHT, RESPONSES, ARCHIVE, STATE]) {
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

  if (!client || client.readyState !== 1 /* OPEN */) {
    await writeFile(join(RESPONSES, name), JSON.stringify({
      id: request.id, ok: false,
      createdAt: new Date().toISOString(),
      result: null,
      error: { message: 'No bookmarklet connected', code: 'NO_CLIENT' }
    }, null, 2) + '\n');
    await rename(path, join(ARCHIVE, name));
    return;
  }

  client.send(JSON.stringify(request));

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const res = pending.get(request.id);
    if (res) {
      pending.delete(request.id);
      await writeFile(join(RESPONSES, name), JSON.stringify(res, null, 2) + '\n');
      await rename(path, join(ARCHIVE, name));
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
  await rename(path, join(ARCHIVE, name));
}

async function loop() {
  await ensureDirs();
  while (true) {
    if (client) {
      for (const name of await claim()) await handle(name);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

loop().catch(err => {
  console.error('[bridge] fatal:', err.message);
  process.exit(1);
});
