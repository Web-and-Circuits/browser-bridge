// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

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

// Side panel sends requests here for tab-level operations
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.kind === 'request' && message.request) {
    handleRequest(message.request).then(sendResponse);
    return true; // keep channel open for async response
  }
});
