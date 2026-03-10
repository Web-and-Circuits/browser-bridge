import { stopMatrix } from './matrix.js';

const waitingEl  = document.getElementById('waiting');
const waitingUI  = document.getElementById('waiting-ui');
const activeEl   = document.getElementById('active');
const dot        = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const logEl      = document.getElementById('log');
const modeDetail = document.getElementById('session-detail');
const promptInput = document.getElementById('prompt-input');
const promptSend  = document.getElementById('prompt-send');

// ── UI helpers ─────────────────────────────────────────────────────────────

function showWaiting() { activeEl.classList.remove('visible'); waitingEl.style.display = ''; }

function showActive() {
  stopMatrix();
  waitingEl.style.display = 'none';
  activeEl.classList.add('visible');
}

function setStatus(state, text) {
  dot.className = 'dot ' + state;
  statusText.textContent = text;
}

// ── Mode state ─────────────────────────────────────────────────────────────

let mode          = 'amnesia'; // amnesia | session | terminal
let sessionId     = null;      // current session-mode session ID
let terminalId    = '';        // pasted terminal session ID

const pills = document.querySelectorAll('.pill');

function renderModeDetail() {
  modeDetail.innerHTML = '';

  if (mode === 'session') {
    if (sessionId) {
      const label = document.createElement('span');
      label.textContent = 'id:';

      const val = document.createElement('span');
      val.id = 'session-id-val';
      val.title = sessionId;
      val.textContent = sessionId.slice(0, 8) + '…';

      const reset = document.createElement('button');
      reset.id = 'session-reset';
      reset.textContent = '×';
      reset.title = 'clear session (start fresh)';
      reset.addEventListener('click', () => {
        sessionId = null;
        chrome.runtime.sendMessage({ kind: 'reset-session' });
        renderModeDetail();
      });

      modeDetail.append(label, val, reset);
    } else {
      modeDetail.textContent = 'no session yet';
    }
  }

  if (mode === 'terminal') {
    const input = document.createElement('input');
    input.id = 'terminal-id-input';
    input.type = 'text';
    input.placeholder = 'paste claude session id…';
    input.value = terminalId;
    input.addEventListener('input', e => { terminalId = e.target.value.trim(); });
    modeDetail.appendChild(input);
  }
}

pills.forEach(pill => {
  pill.addEventListener('click', () => {
    mode = pill.dataset.mode;
    pills.forEach(p => p.classList.toggle('active', p === pill));
    renderModeDetail();
  });
});

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

function showInstructions() {
  logEl.innerHTML = `
    <div class="instructions">
      <div class="inst-head">how to use</div>
      <div class="inst-row"><span class="inst-label">1.</span> install &amp; start the host — see command above</div>
      <div class="inst-row"><span class="inst-label">2.</span> type a task below — claude will act on this tab</div>
      <div class="inst-row"><span class="inst-label">3.</span> or write JSON to <code>.bridge/requests/</code> directly</div>
      <div class="inst-head" style="margin-top:10px">modes</div>
      <div class="inst-row"><code>amnesia</code> — fresh context each prompt</div>
      <div class="inst-row"><code>session</code> — sidebar keeps a persistent conversation</div>
      <div class="inst-row"><code>terminal</code> — paste a session id to sync with a running claude</div>
    </div>`;
}

// ── Stream rendering ───────────────────────────────────────────────────────

const streams = new Map();

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
  thinking.textContent = 'thinking…';
  block.appendChild(thinking);

  logEl.prepend(block);
  streams.set(id, { block, thinkingEl: thinking, segments: new Map() });
}

function appendStream(id, chunk, streamType = 'text') {
  const s = streams.get(id);
  if (!s) return;

  if (s.thinkingEl) {
    s.thinkingEl.remove();
    s.thinkingEl = null;
  }

  // Each streamType gets its own segment element so they can be styled separately
  if (!s.segments.has(streamType)) {
    const seg = document.createElement('div');
    const cls = { text: '', 'tool-call': 'tool-call', 'tool-result': 'tool-result', error: 'error-text' };
    seg.className = 'claude-stream ' + (cls[streamType] || '');
    s.block.appendChild(seg);
    s.segments.set(streamType, seg);
  }

  // New segment if previous streamType was different (interleaved tool calls/text)
  const existing = s.segments.get(streamType);
  // Append a fresh segment if content type just switched (tool-call → text etc.)
  const lastSeg = s.block.lastElementChild;
  if (lastSeg && !lastSeg.classList.contains(streamType === 'text' ? 'claude-stream' : `claude-stream`) || lastSeg?.className.includes('tool-call') && streamType === 'text') {
    const seg = document.createElement('div');
    const cls = { text: '', 'tool-call': 'tool-call', 'tool-result': 'tool-result', error: 'error-text' };
    seg.className = 'claude-stream ' + (cls[streamType] || '');
    s.block.appendChild(seg);
    s.segments.set(streamType + '_' + s.block.children.length, seg);
    seg.textContent += chunk;
  } else {
    existing.textContent += chunk;
  }

  s.block.scrollIntoView({ block: 'nearest' });
}

function endStream(id, ok) {
  const s = streams.get(id);
  if (!s) return;
  if (s.thinkingEl) {
    s.thinkingEl.textContent = ok ? '(no output)' : '(failed)';
    s.thinkingEl.style.animationName = 'none';
  }
  streams.delete(id);
  setStatus('connected', 'connected');
}

// ── Prompt submit ──────────────────────────────────────────────────────────

function submitPrompt() {
  const message = promptInput.value.trim();
  if (!message) return;

  const id = crypto.randomUUID();
  promptInput.value = '';
  promptInput.style.height = '';
  promptSend.disabled = true;
  setStatus('active', 'claude');
  startStream(id, message);

  chrome.runtime.sendMessage({
    kind: 'prompt',
    id,
    message,
    mode,
    resumeId: mode === 'terminal' ? terminalId : null
  });
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

chrome.runtime.onMessage.addListener(msg => {
  if (msg.kind === 'status') {
    if (msg.connected) {
      if (!everConnected) {
        everConnected = true;
        showActive();
        showInstructions();
      }
      setStatus('connected', 'connected');
      promptSend.disabled = false;
    } else {
      setStatus('disconnected', 'host disconnected — retrying…');
      promptSend.disabled = true;
    }
  }

  if (msg.kind === 'activity') {
    if (logEl.querySelector('.instructions')) logEl.innerHTML = '';
    log(msg.action + ' → ' + (msg.ok ? 'ok' : 'err'), msg.ok ? 'ok' : 'err');
    setStatus('active', msg.action);
    setTimeout(() => setStatus('connected', 'connected'), 800);
  }

  if (msg.kind === 'stream') {
    appendStream(msg.id, msg.chunk, msg.streamType || 'text');
  }

  if (msg.kind === 'session-id') {
    if (mode === 'session' && !sessionId) {
      sessionId = msg.sessionId;
      renderModeDetail();
    }
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

const extId = chrome.runtime.id;
document.getElementById('waiting-cmd').textContent  = `./install.sh ${extId}`;
document.getElementById('ext-id').textContent       = extId;
document.getElementById('install-cmd').textContent  = `./install.sh ${extId}`;

setTimeout(() => waitingUI.classList.add('visible'), 1800);
