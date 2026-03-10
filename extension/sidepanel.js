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

chrome.runtime.onMessage.addListener(msg => {
  if (msg.kind === 'status') {
    if (msg.connected) {
      showActive();
      setStatus('connected', 'connected');
      log('host connected', 'ok');
    } else {
      setStatus('disconnected', 'host disconnected — retrying…');
      log('host disconnected', 'err');
    }
  }

  if (msg.kind === 'activity') {
    const label = msg.action + ' → ' + (msg.ok ? 'ok' : 'err');
    log(label, msg.ok ? 'ok' : 'err');
    setStatus('active', msg.action);
    setTimeout(() => setStatus('connected', 'connected'), 800);
  }
});

// ── Init ───────────────────────────────────────────────────────────────────

chrome.runtime.sendMessage({ kind: 'getStatus' }, response => {
  if (chrome.runtime.lastError) return;
  if (response?.connected) {
    showActive();
    setStatus('connected', 'connected');
  } else {
    showWaiting();
  }
});

// Populate install command with real extension ID
const cmdEl = document.getElementById('waiting-cmd');
if (cmdEl) cmdEl.textContent = `./install.sh ${chrome.runtime.id}`;

// fade in waiting UI after matrix has a moment to run
setTimeout(() => waitingUI.classList.add('visible'), 1800);
