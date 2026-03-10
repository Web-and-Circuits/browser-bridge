const HOST_NAME = 'com.webandcircuits.browser_bridge';

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

  if (request.action === 'snapshot' || request.action === 'run_js') {
    const response = await chrome.tabs.sendMessage(tab.id, request);
    return wrapResponse(request.id, response);
  }

  return wrapResponse(request.id, { ok: false, error: { message: 'Unsupported action', code: 'UNSUPPORTED_ACTION' } });
}

function connectNative() {
  try {
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener(async message => {
      if (!message || message.kind !== 'request' || !message.request) return;
      const response = await handleRequest(message.request);
      port.postMessage({ kind: 'response', response });
    });
    port.onDisconnect.addListener(() => {
      setTimeout(connectNative, 2000);
    });
  } catch {
    setTimeout(connectNative, 4000);
  }
}

connectNative();
