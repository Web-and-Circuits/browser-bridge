import { stopMatrix } from './matrix.js';

const POLL_MS = 300;
const DB_NAME = 'browser-bridge';
const DB_STORE = 'handles';

const welcomeEl   = document.getElementById('welcome');
const activeEl    = document.getElementById('active');
const grantBtn    = document.getElementById('grant-btn');
const welcomeErr  = document.getElementById('welcome-error');
const dot         = document.getElementById('dot');
const statusText  = document.getElementById('status-text');
const resetLink      = document.getElementById('reset-link');
const resetConfirm   = document.getElementById('reset-confirm');
const resetCancel    = document.getElementById('reset-cancel');
const resetOk        = document.getElementById('reset-ok');
const logEl          = document.getElementById('log');

let rootHandle = null;
let pollTimer  = null;
const processing = new Set();

// ── IndexedDB ──────────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, 'root');
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

async function loadHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('root');
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function clearHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

// ── File helpers ───────────────────────────────────────────────────────────

async function getSubdir(root, name) {
  return root.getDirectoryHandle(name, { create: true });
}

async function writeJson(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w  = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2) + '\n');
  await w.close();
}

// ── UI ─────────────────────────────────────────────────────────────────────

function showWelcome() {
  welcomeEl.style.display = '';
  activeEl.classList.remove('visible');
}

function showActive() {
  stopMatrix();
  welcomeEl.style.display = 'none';
  activeEl.classList.add('visible');
}

function setStatus(state, text) {
  dot.className   = 'dot ' + state;
  statusText.textContent = text;
}

function log(msg, kind = '') {
  const el = document.createElement('div');
  el.className   = 'log-entry ' + kind;
  el.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  logEl.prepend(el);
  while (logEl.children.length > 200) logEl.lastChild.remove();
}

// ── Background bridge ──────────────────────────────────────────────────────

function sendToBackground(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ kind: 'request', request }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(response);
    });
  });
}

// ── Poll loop ──────────────────────────────────────────────────────────────

async function poll() {
  try {
    const requestsDir  = await getSubdir(rootHandle, 'requests');
    const responsesDir = await getSubdir(rootHandle, 'responses');

    for await (const [name] of requestsDir) {
      if (!name.endsWith('.json') || processing.has(name)) continue;
      processing.add(name);
      setStatus('active', 'processing…');
      log('← ' + name);

      try {
        const fh      = await requestsDir.getFileHandle(name);
        const file    = await fh.getFile();
        const request = JSON.parse(await file.text());
        const response = await sendToBackground(request);

        await writeJson(responsesDir, name, response);
        await requestsDir.removeEntry(name);
        log('→ ' + name + '  ok=' + response.ok, response.ok ? 'ok' : 'err');
      } catch (err) {
        log('✕ ' + name + '  ' + err.message, 'err');
        try {
          await writeJson(responsesDir, name, {
            id: name.replace('.json', ''),
            ok: false,
            createdAt: new Date().toISOString(),
            result: null,
            error: { message: err.message, code: 'SIDEPANEL_ERROR' }
          });
          await requestsDir.removeEntry(name).catch(() => {});
        } catch {}
      } finally {
        processing.delete(name);
        setStatus('ready', 'listening');
      }
    }
  } catch (err) {
    setStatus('error', err.message);
  }

  pollTimer = setTimeout(poll, POLL_MS);
}

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  poll();
}

// ── Activate ───────────────────────────────────────────────────────────────

async function activate(handle) {
  rootHandle = handle;
  await getSubdir(handle, 'requests');
  await getSubdir(handle, 'responses');
  showActive();
  setStatus('ready', 'listening');
  startPolling();
}

// ── Grant button (first run) ───────────────────────────────────────────────

grantBtn.addEventListener('click', async () => {
  welcomeErr.textContent = '';
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveHandle(handle);
    await activate(handle);
    log('ready — ' + handle.name, 'ok');
  } catch (err) {
    if (err.name !== 'AbortError') {
      welcomeErr.textContent = err.message;
    }
  }
});

// ── Reset (tucked away in corner) ─────────────────────────────────────────

resetLink.addEventListener('click', () => {
  resetConfirm.classList.add('visible');
});

resetCancel.addEventListener('click', () => {
  resetConfirm.classList.remove('visible');
});

resetOk.addEventListener('click', async () => {
  resetConfirm.classList.remove('visible');
  clearTimeout(pollTimer);
  await clearHandle();
  rootHandle = null;
  logEl.innerHTML = '';
  showWelcome();
});

// ── Init — restore saved handle ────────────────────────────────────────────

(async () => {
  try {
    const saved = await loadHandle();
    if (saved) {
      const perm = await saved.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        await activate(saved);
        log('restored — ' + saved.name, 'ok');
        return;
      }
    }
  } catch {}
  showWelcome();
})();
