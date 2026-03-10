#!/usr/bin/env node
import { mkdir, readFile, watch, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT      = process.env.BROWSER_BRIDGE_DIR || join(dirname(fileURLToPath(import.meta.url)), '.bridge');
const REQUESTS  = join(ROOT, 'requests');
const RESPONSES = join(ROOT, 'responses');
const TIMEOUT   = 15000;

const ACTIONS = ['ping', 'get_active_tab', 'snapshot', 'run_js'];

function usage() {
  console.error(`
usage: bridge <action> [options]

actions:
  ping                        check the bridge is alive
  get_active_tab              tab id, title, url
  snapshot                    visible text + links from active tab
  run_js <code>               evaluate JS in the active tab

options:
  --timeout <ms>              response timeout (default 15000)
  --raw                       print full response JSON
  --pretty                    print result only, formatted (default)

examples:
  bridge ping
  bridge snapshot
  bridge run_js "document.title"
  bridge run_js "document.querySelectorAll('h1').length"
`.trim());
  process.exit(1);
}

// ── Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (!args.length) usage();

const action = args[0];
if (!ACTIONS.includes(action)) {
  console.error(`unknown action: ${action}`);
  usage();
}

let code     = null;
let raw      = false;
let timeout  = TIMEOUT;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--raw')     { raw = true; continue; }
  if (args[i] === '--pretty')  { raw = false; continue; }
  if (args[i] === '--timeout') { timeout = parseInt(args[++i], 10); continue; }
  if (action === 'run_js' && !args[i].startsWith('--')) { code = args[i]; continue; }
}

if (action === 'run_js' && !code) {
  console.error('run_js requires a code argument');
  usage();
}

// ── Request ────────────────────────────────────────────────────────────────

const id      = randomUUID();
const reqFile = join(REQUESTS, `${id}.json`);
const resFile = join(RESPONSES, `${id}.json`);

const request = {
  id,
  createdAt: new Date().toISOString(),
  target: 'active-tab',
  action,
  args: code ? { code } : {}
};

await mkdir(REQUESTS,  { recursive: true });
await mkdir(RESPONSES, { recursive: true });
await writeFile(reqFile, JSON.stringify(request, null, 2) + '\n');

// ── Wait for response ──────────────────────────────────────────────────────

const deadline = Date.now() + timeout;

while (Date.now() < deadline) {
  if (existsSync(resFile)) {
    const response = JSON.parse(await readFile(resFile, 'utf8'));
    if (raw) {
      console.log(JSON.stringify(response, null, 2));
    } else if (!response.ok) {
      console.error('error:', response.error?.message || 'unknown');
      process.exit(1);
    } else {
      console.log(JSON.stringify(response.result, null, 2));
    }
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 100));
}

console.error(`timeout: no response after ${timeout}ms`);
process.exit(1);
