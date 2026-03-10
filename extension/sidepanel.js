import { stopMatrix } from './matrix.js';

const waitingEl  = document.getElementById('waiting');
const waitingUI  = document.getElementById('waiting-ui');
const activeEl   = document.getElementById('active');
const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const logEl      = document.getElementById('log');

// ── UI ─────────────────────────────────────────────────────────────────────

function showWaiting() {
  activeEl.classList.remove('visible');
  waitingEl.style.display = '';
}

function showActive() {
  stopMatrix();
  waitingEl.style.display = 'none';
  activeEl.classList.add('visible');
}

function setStatus(state, text) {
  dot.className      = 'dot ' + state;
  statusText.textContent = text;
}

// ── Log ────────────────────────────────────────────────────────────────────

const TALLY = ['', '|', '||', '|||', '||||', '|||| |', '|||| ||', '|||| |||', '|||| ||||'];
function tally(n) {
  if (n <= 1) return '';
  const groups = Math.floor((n - 1) / 5);
  const rem    = (n - 1) % 5;
  return '  ' + '|||| '.repeat(groups) + TALLY[rem + 1];
}

function log(msg, kind = '') {
  const first = logEl.firstChild;
  if (first && first.dataset.msg === msg) {
    const count = (parseInt(first.dataset.count, 10) || 1) + 1;
    first.dataset.count = count;
    first.textContent = new Date().toLocaleTimeString() + '  ' + msg + tally(count);
    return;
  }
  const el = document.createElement('div');
  el.className     = 'log-entry ' + kind;
  el.dataset.msg   = msg;
  el.dataset.count = '1';
  el.textContent   = new Date().toLocaleTimeString() + '  ' + msg;
  logEl.prepend(el);
  while (logEl.children.length > 200) logEl.lastChild.remove();
}

// ── Background messages ────────────────────────────────────────────────────

let everConnected = false;

function showInstructions() {
  logEl.innerHTML = `
    <div class="instructions">
      <div class="inst-head">how to use</div>
      <div class="inst-row"><span class="inst-label">1.</span> install &amp; start the host if you haven't — see the install command above</div>
      <div class="inst-row"><span class="inst-label">2.</span> write a JSON request to <code>.bridge/requests/</code></div>
      <div class="inst-row"><span class="inst-label">3.</span> responses land in <code>.bridge/responses/</code></div>
      <div class="inst-head" style="margin-top:12px">actions</div>
      <div class="inst-row"><code>ping</code> — check the bridge is alive</div>
      <div class="inst-row"><code>get_active_tab</code> — tab id, title, url</div>
      <div class="inst-row"><code>snapshot</code> — visible text + links</div>
      <div class="inst-row"><code>run_js</code> — evaluate JS in the tab</div>
    </div>`;
}

// ── Stream rendering ───────────────────────────────────────────────────────

const streams = new Map(); // id → { block, streamEl, thinkingEl }

function startStream(id, userMsg) {
  if (logEl.querySelector('.instructions')) logEl.innerHTML = '';

  const block = document.createElement('div');
  block.className = 'claude-block';

  const you = document.createElement('div');
  you.className = 'claude-you';
  you.textContent = '▸ ' + userMsg;
  block.appendChild(you);

  const thinking = document.createElement('div');
  thinking.className = 'claude-thinking';
  thinking.textContent = 'claude is thinking…';
  block.appendChild(thinking);

  logEl.prepend(block);

  streams.set(id, { block, thinkingEl: thinking, streamEl: null });
}

function appendStream(id, chunk, dim = false) {
  const s = streams.get(id);
  if (!s) return;

  if (s.thinkingEl) {
    s.thinkingEl.remove();
    s.thinkingEl = null;
    const streamEl = document.createElement('div');
    streamEl.className = 'claude-stream' + (dim ? ' dim' : '');
    s.block.appendChild(streamEl);
    s.streamEl = streamEl;
  }

  s.streamEl.textContent += chunk;
  s.streamEl.scrollIntoView({ block: 'nearest' });
}

function endStream(id, ok) {
  const s = streams.get(id);
  if (!s) return;
  if (s.thinkingEl) {
    s.thinkingEl.textContent = ok ? '(no output)' : '(failed)';
  }
  if (s.streamEl && !ok) {
    s.streamEl.classList.add('error');
  }
  streams.delete(id);
  setStatus('connected', 'connected');
}

// ── Prompt submit ──────────────────────────────────────────────────────────

const promptInput = document.getElementById('prompt-input');
const promptSend  = document.getElementById('prompt-send');

function submitPrompt() {
  const message = promptInput.value.trim();
  if (!message) return;
  const id = crypto.randomUUID();
  promptInput.value = '';
  promptInput.style.height = '';
  promptSend.disabled = true;
  setStatus('active', 'claude');
  startStream(id, message);
  chrome.runtime.sendMessage({ kind: 'prompt', id, message });
}

promptSend.addEventListener('click', submitPrompt);
promptInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitPrompt(); }
});
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
});

// ── Background messages ────────────────────────────────────────────────────

let everConnected = false;

function showInstructions() {
  logEl.innerHTML = `
    <div class="instructions">
      <div class="inst-head">how to use</div>
      <div class="inst-row"><span class="inst-label">1.</span> install &amp; start the host if you haven't — see the install command above</div>
      <div class="inst-row"><span class="inst-label">2.</span> type a task below to run claude on this page</div>
      <div class="inst-row"><span class="inst-label">3.</span> or write JSON requests directly to <code>.bridge/requests/</code></div>
      <div class="inst-head" style="margin-top:12px">actions</div>
      <div class="inst-row"><code>ping</code> — check the bridge is alive</div>
      <div class="inst-row"><code>get_active_tab</code> — tab id, title, url</div>
      <div class="inst-row"><code>snapshot</code> — visible text + links</div>
      <div class="inst-row"><code>run_js</code> — evaluate JS in the tab</div>
      <div class="inst-row"><code>click</code> · <code>fill</code> · <code>navigate</code> — act on page</div>
    </div>`;
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.kind === 'status') {
    if (msg.connected) {
      if (!everConnected) {
        everConnected = true;
        showActive();
        showInstructions();
      }
      setStatus('connected', 'connected');
    } else {
      setStatus('disconnected', 'host disconnected — retrying…');
      promptSend.disabled = false;
    }
  }

  if (msg.kind === 'activity') {
    if (logEl.querySelector('.instructions')) logEl.innerHTML = '';
    const label = msg.action + ' → ' + (msg.ok ? 'ok' : 'err');
    log(label, msg.ok ? 'ok' : 'err');
    setStatus('active', msg.action);
    setTimeout(() => setStatus('connected', 'connected'), 800);
  }

  if (msg.kind === 'stream') {
    appendStream(msg.id, msg.chunk, msg.dim);
  }

  if (msg.kind === 'stream-end') {
    promptSend.disabled = false;
    endStream(msg.id, msg.ok);
  }
});

// ── Init ───────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ kind: 'getStatus' }, response => {
  if (chrome.runtime.lastError) return;
  if (response?.connected) {
    everConnected = true;
    showActive();
    setStatus('connected', 'connected');
    showInstructions();
  } else {
    showWaiting();
  }
});

// Populate extension ID and install command in both screens
const id = chrome.runtime.id;
const cmdEl = document.getElementById('waiting-cmd');
if (cmdEl) cmdEl.textContent = `./install.sh ${id}`;
const extIdEl = document.getElementById('ext-id');
if (extIdEl) extIdEl.textContent = id;
const installCmdEl = document.getElementById('install-cmd');
if (installCmdEl) installCmdEl.textContent = `./install.sh ${id}`;

// fade in waiting UI after matrix has a moment to run
setTimeout(() => waitingUI.classList.add('visible'), 1800);
