#!/usr/bin/env node
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import os from 'node:os';

const ROOT = resolve(process.env.BROWSER_BRIDGE_DIR || join(os.homedir(), '.browser-bridge'));
const REQUESTS = join(ROOT, 'requests');
const RESPONSES = join(ROOT, 'responses');
const INFLIGHT = join(ROOT, 'requests-inflight');
const STATE = join(ROOT, 'state');

let buffer = Buffer.alloc(0);
const pending = new Map();

async function ensureDirs() {
  await mkdir(REQUESTS, { recursive: true });
  await mkdir(RESPONSES, { recursive: true });
  await mkdir(INFLIGHT, { recursive: true });
  await mkdir(STATE, { recursive: true });
}

function sendNative(message) {
  const json = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const body = buffer.slice(4, 4 + len).toString('utf8');
    buffer = buffer.slice(4 + len);
    try {
      const message = JSON.parse(body);
      if (message.kind === 'response' && message.response?.id) {
        pending.set(message.response.id, message.response);
      }
    } catch {}
  }
});

async function writeResponseFile(response) {
  const path = join(RESPONSES, `${response.id}.json`);
  await writeFile(path, JSON.stringify(response, null, 2) + '\n');
}

async function claimRequests() {
  const names = (await readdir(REQUESTS)).filter(name => name.endsWith('.json')).sort();
  const claimed = [];
  for (const name of names) {
    const src = join(REQUESTS, name);
    const dst = join(INFLIGHT, name);
    try {
      await rename(src, dst);
      claimed.push(dst);
    } catch {}
  }
  return claimed;
}

async function handleRequestFile(path) {
  const request = JSON.parse(await readFile(path, 'utf8'));
  sendNative({ kind: 'request', request });

  const started = Date.now();
  while (Date.now() - started < 15000) {
    const found = pending.get(request.id);
    if (found) {
      pending.delete(request.id);
      await writeResponseFile(found);
      await rm(path, { force: true });
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  await writeResponseFile({
    id: request.id,
    ok: false,
    createdAt: new Date().toISOString(),
    result: null,
    error: { message: 'Timed out waiting for extension response', code: 'TIMEOUT' }
  });
  await rm(path, { force: true });
}

async function loop() {
  await ensureDirs();
  while (true) {
    const claimed = await claimRequests();
    for (const path of claimed) {
      await handleRequestFile(path);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

loop().catch(async error => {
  await ensureDirs();
  await writeFile(join(STATE, 'host-error.log'), `${new Date().toISOString()} ${error.stack || error.message}\n`, { flag: 'a' });
  process.exit(1);
});
