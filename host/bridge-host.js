#!/usr/bin/env node
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import os from 'node:os';

const ROOT     = resolve(process.env.BROWSER_BRIDGE_DIR || join(os.homedir(), '.browser-bridge'));
const REQUESTS = join(ROOT, 'requests');
const INFLIGHT = join(ROOT, 'requests-inflight');
const RESPONSES = join(ROOT, 'responses');
const STATE    = join(ROOT, 'state');

let buf = Buffer.alloc(0);
const pending = new Map();

async function ensureDirs() {
  for (const d of [REQUESTS, INFLIGHT, RESPONSES, STATE]) {
    await mkdir(d, { recursive: true });
  }
}

function send(msg) {
  const json = Buffer.from(JSON.stringify(msg));
  const hdr  = Buffer.alloc(4);
  hdr.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([hdr, json]));
}

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
    } catch {}
  }
});

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
