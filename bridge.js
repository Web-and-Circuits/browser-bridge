#!/usr/bin/env node
/**
 * bridge.js — CLI for browser-bridge
 *
 * Write a request to .bridge/requests/, wait for the response in
 * .bridge/responses/, print the result.
 *
 * Usage:
 *   ./bridge.js <action> [args...] [flags]
 *
 * Actions:
 *   ping
 *   get_active_tab
 *   snapshot  [--selector <css>]  [--mode default|forms]
 *   run_js    <code>
 *   click     <selector>
 *   fill      <selector> <value>
 *   navigate  <url>
 *
 * Flags:
 *   --raw           print full response JSON
 *   --timeout <ms>  response timeout (default 15000)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT      = process.env.BROWSER_BRIDGE_DIR
               || join(dirname(fileURLToPath(import.meta.url)), '.bridge');
const REQUESTS  = join(ROOT, 'requests');
const RESPONSES = join(ROOT, 'responses');

const ACTIONS = ['ping', 'get_active_tab', 'snapshot', 'run_js', 'click', 'fill', 'navigate'];

function usage() {
  console.error(`
usage: bridge <action> [args] [flags]

actions:
  ping                              check the bridge is alive
  get_active_tab                    return tab id, title, url
  snapshot                          visible text + links from active tab
  snapshot --selector <css>         scope snapshot to a CSS selector
  snapshot --mode forms             extract all form inputs + labels
  run_js <code>                     evaluate JS expression in active tab
  click <selector>                  click an element by CSS selector
  fill <selector> <value>           set an input's value and fire input/change
  navigate <url>                    navigate the active tab to a URL

flags:
  --raw                             print full response JSON
  --timeout <ms>                    wait timeout in ms (default 15000)

examples:
  ./bridge.js ping
  ./bridge.js snapshot
  ./bridge.js snapshot --selector main
  ./bridge.js snapshot --mode forms
  ./bridge.js run_js "document.title"
  ./bridge.js run_js "document.querySelectorAll('h2').length"
  ./bridge.js click "#submit-btn"
  ./bridge.js fill "#email" "user@example.com"
  ./bridge.js navigate "https://example.com"
`.trim());
  process.exit(1);
}

// ── Parse args ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (!argv.length) usage();

const action = argv[0];
if (!ACTIONS.includes(action)) { console.error(`unknown action: ${action}`); usage(); }

const args   = {};
let raw      = false;
let timeout  = 15000;
const rest   = argv.slice(1);

for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--raw')      { raw = true; continue; }
  if (a === '--timeout')  { timeout = parseInt(rest[++i], 10); continue; }
  if (a === '--selector') { args.selector = rest[++i]; continue; }
  if (a === '--mode')     { args.mode = rest[++i]; continue; }
  if (!a.startsWith('--')) {
    if (action === 'run_js'   && !args.code)     { args.code     = a; continue; }
    if (action === 'click'    && !args.selector) { args.selector = a; continue; }
    if (action === 'navigate' && !args.url)      { args.url      = a; continue; }
    if (action === 'fill') {
      if (!args.selector) { args.selector = a; continue; }
      if (!args.value)    { args.value    = a; continue; }
    }
  }
}

// Validate required args
if (action === 'run_js'   && !args.code)     { console.error('run_js requires a code argument'); usage(); }
if (action === 'click'    && !args.selector) { console.error('click requires a selector');        usage(); }
if (action === 'fill'     && (!args.selector || args.value === undefined)) { console.error('fill requires <selector> <value>'); usage(); }
if (action === 'navigate' && !args.url)      { console.error('navigate requires a url');          usage(); }

// ── Write request ──────────────────────────────────────────────────────────

const id      = randomUUID();
const reqFile = join(REQUESTS, `${id}.json`);
const resFile = join(RESPONSES, `${id}.json`);

await mkdir(REQUESTS,  { recursive: true });
await mkdir(RESPONSES, { recursive: true });

await writeFile(reqFile, JSON.stringify({
  id,
  createdAt: new Date().toISOString(),
  target: 'active-tab',
  action,
  args
}, null, 2) + '\n');

// ── Poll for response ──────────────────────────────────────────────────────

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
      const result = response.result;
      if (result === null || result === undefined) {
        console.log('null');
      } else if (typeof result === 'object') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(result);
      }
    }
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 100));
}

console.error(`timeout: no response after ${timeout}ms`);
process.exit(1);
