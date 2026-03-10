const HOST = 'com.webandcircuits.browser_bridge';

let port      = null;
let connected = false;

// ── Side panel opener ──────────────────────────────────────────────────────

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Broadcast to side panel (best-effort) ─────────────────────────────────

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Helpers ────────────────────────────────────────────────────────────────

function wrapResponse(id, payload) {
  return {
    id,
    ok: Boolean(payload?.ok),
    createdAt: new Date().toISOString(),
    result: payload?.ok ? payload.result ?? null : null,
    error:  payload?.ok ? null : (payload?.error ?? { message: 'Unknown error' })
  };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

function execInMain(tabId, func, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args
  }).then(r => r[0]?.result);
}

// ── Request handler ────────────────────────────────────────────────────────

async function handleRequest(request) {
  const { id, action, args = {} } = request;

  if (action === 'ping') {
    return wrapResponse(id, { ok: true, result: { pong: true } });
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    return wrapResponse(id, { ok: false, error: { message: 'No active tab', code: 'NO_ACTIVE_TAB' } });
  }

  if (action === 'get_active_tab') {
    return wrapResponse(id, { ok: true, result: { tabId: tab.id, title: tab.title, url: tab.url } });
  }

  if (action === 'snapshot') {
    const response = await chrome.tabs.sendMessage(tab.id, request);
    return wrapResponse(id, response);
  }

  if (action === 'run_js') {
    const r = await execInMain(tab.id,
      code => { try { return { ok: true, value: eval(code) } } catch(e) { return { ok: false, message: e.message } } },
      [args.code || 'null']
    );
    return r?.ok
      ? wrapResponse(id, { ok: true, result: r.value })
      : wrapResponse(id, { ok: false, error: { message: r?.message || 'eval failed' } });
  }

  if (action === 'click') {
    const r = await execInMain(tab.id,
      sel => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, message: `No element: ${sel}` };
        el.click();
        return { ok: true };
      },
      [args.selector]
    );
    return r?.ok
      ? wrapResponse(id, { ok: true, result: { clicked: args.selector } })
      : wrapResponse(id, { ok: false, error: { message: r?.message } });
  }

  if (action === 'fill') {
    const r = await execInMain(tab.id,
      (sel, val) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, message: `No element: ${sel}` };
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeInputSetter) nativeInputSetter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
      },
      [args.selector, args.value]
    );
    return r?.ok
      ? wrapResponse(id, { ok: true, result: { filled: args.selector } })
      : wrapResponse(id, { ok: false, error: { message: r?.message } });
  }

  if (action === 'navigate') {
    await chrome.tabs.update(tab.id, { url: args.url });
    return wrapResponse(id, { ok: true, result: { url: args.url } });
  }

  return wrapResponse(id, { ok: false, error: { message: 'Unsupported action', code: 'UNSUPPORTED_ACTION' } });
}

// ── Native messaging ───────────────────────────────────────────────────────

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
    connected = true;
    broadcast({ kind: 'status', connected: true });

    port.onMessage.addListener(async msg => {
      if (!msg) return;

      if (msg.kind === 'stream' || msg.kind === 'stream-end') {
        broadcast(msg);
        return;
      }

      if (!msg.request || msg.kind !== 'request') return;
      let response;
      try {
        response = await handleRequest(msg.request);
      } catch (err) {
        response = wrapResponse(msg.request.id, {
          ok: false, error: { message: err.message, code: 'BACKGROUND_ERROR' }
        });
      }
      port.postMessage({ kind: 'response', response });
      broadcast({ kind: 'activity', action: msg.request.action, id: msg.request.id, ok: response.ok });
    });

    port.onDisconnect.addListener(() => {
      connected = false;
      port = null;
      broadcast({ kind: 'status', connected: false });
      setTimeout(connect, 3000);
    });
  } catch {
    connected = false;
    setTimeout(connect, 3000);
  }
}

// ── Message handler (from side panel) ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.kind === 'getStatus') {
    sendResponse({ connected });
    return;
  }
  if (msg.kind === 'prompt' && port) {
    port.postMessage({ kind: 'prompt', id: msg.id, message: msg.message });
  }
});

connect();
