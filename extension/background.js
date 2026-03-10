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

// ── Tab operations ─────────────────────────────────────────────────────────

function wrapResponse(id, payload) {
  return {
    id,
    ok: Boolean(payload?.ok),
    createdAt: new Date().toISOString(),
    result: payload?.ok ? payload.result ?? null : null,
    error: payload?.ok ? null : (payload?.error ?? { message: 'Unknown error' })
  };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function handleRequest(request) {
  if (request.action === 'ping') {
    return wrapResponse(request.id, { ok: true, result: { pong: true } });
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    return wrapResponse(request.id, { ok: false, error: { message: 'No active tab', code: 'NO_ACTIVE_TAB' } });
  }

  if (request.action === 'get_active_tab') {
    return wrapResponse(request.id, {
      ok: true,
      result: { tabId: tab.id, title: tab.title, url: tab.url }
    });
  }

  if (request.action === 'snapshot') {
    const response = await chrome.tabs.sendMessage(tab.id, request);
    return wrapResponse(request.id, response);
  }

  if (request.action === 'run_js') {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: code => { try { return { ok: true, value: eval(code) } } catch(e) { return { ok: false, message: e.message } } },
      args: [request.args?.code || 'null']
    });
    const r = results[0]?.result;
    return r?.ok
      ? wrapResponse(request.id, { ok: true, result: r.value })
      : wrapResponse(request.id, { ok: false, error: { message: r?.message || 'eval failed' } });
  }

  return wrapResponse(request.id, {
    ok: false,
    error: { message: 'Unsupported action', code: 'UNSUPPORTED_ACTION' }
  });
}

// ── Native messaging ───────────────────────────────────────────────────────

function connect() {
  try {
    port = chrome.runtime.connectNative(HOST);
    connected = true;
    broadcast({ kind: 'status', connected: true });

    port.onMessage.addListener(async msg => {
      if (!msg || msg.kind !== 'request' || !msg.request) return;
      let response;
      try {
        response = await handleRequest(msg.request);
      } catch (err) {
        response = wrapResponse(msg.request.id, {
          ok: false,
          error: { message: err.message, code: 'BACKGROUND_ERROR' }
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
});

connect();
