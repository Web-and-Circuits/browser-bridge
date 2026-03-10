const POLL_MS = 300;
const DB_NAME = 'browser-bridge';
const DB_STORE = 'handles';
const SUBDIRS = ['requests', 'responses'];

const dot = document.getElementById('dot');
const statusText = document.getElementById('status-text');
const pickBtn = document.getElementById('pick-btn');
const dirPathEl = document.getElementById('dir-path');
const logEl = document.getElementById('log');

let rootHandle = null;
let pollTimer = null;
const processing = new Set();

// ── IndexedDB ──────────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function saveHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, 'root');
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

async function loadHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get('root');
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

// ── File System Access ─────────────────────────────────────────────────────

async function verifyPermission(handle) {
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  return perm === 'granted';
}

async function getSubdir(root, name) {
  return root.getDirectoryHandle(name, { create: true });
}

async function writeJson(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(data, null, 2) + '\n');
  await w.close();
}

// ── UI helpers ─────────────────────────────────────────────────────────────

function setStatus(state, text) {
  dot.className = 'dot ' + state;
  statusText.textContent = text;
}

function log(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'log-entry ' + kind;
  el.textContent = new Date().toLocaleTimeString() + '  ' + msg;
  logEl.prepend(el);
  while (logEl.children.length > 100) logEl.lastChild.remove();
}

// ── Poll loop ──────────────────────────────────────────────────────────────

async function poll() {
  try {
    const requestsDir = await getSubdir(rootHandle, 'requests');
    const responsesDir = await getSubdir(rootHandle, 'responses');

    for await (const [name] of requestsDir) {
      if (!name.endsWith('.json') || processing.has(name)) continue;
      processing.add(name);

      setStatus('active', 'Processing ' + name);
      log('← ' + name);

      try {
        const fh = await requestsDir.getFileHandle(name);
        const file = await fh.getFile();
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
      }
    }

    setStatus('ready', 'Listening — ' + rootHandle.name);
  } catch (err) {
    setStatus('error', 'Poll error: ' + err.message);
  }

  pollTimer = setTimeout(poll, POLL_MS);
}

function sendToBackground(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ kind: 'request', request }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(response);
    });
  });
}

function startPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  poll();
}

// ── Init ───────────────────────────────────────────────────────────────────

async function activate(handle) {
  rootHandle = handle;
  dirPathEl.textContent = handle.name;
  pickBtn.textContent = 'Change directory';
  for (const name of SUBDIRS) await getSubdir(handle, name);
  setStatus('ready', 'Listening — ' + handle.name);
  startPolling();
}

pickBtn.addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveHandle(handle);
    await activate(handle);
    log('Directory set: ' + handle.name, 'ok');
  } catch (err) {
    if (err.name !== 'AbortError') log('Directory pick failed: ' + err.message, 'err');
  }
});

// Restore saved handle on open
(async () => {
  try {
    const saved = await loadHandle();
    if (saved) {
      const granted = await verifyPermission(saved);
      if (granted) {
        await activate(saved);
        log('Restored: ' + saved.name, 'ok');
        return;
      }
    }
  } catch {}
  setStatus('', 'No directory selected');
})();
