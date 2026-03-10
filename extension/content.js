function getVisibleText(maxChars = 10000) {
  const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '…';
}

function getLinks(maxLinks = 100) {
  return Array.from(document.querySelectorAll('a[href]'))
    .slice(0, maxLinks)
    .map(a => ({ text: (a.innerText || a.textContent || '').trim(), href: a.href }))
    .filter(link => link.href);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.action === 'snapshot') {
        sendResponse({
          ok: true,
          result: {
            title: document.title,
            url: location.href,
            selectionText: String(window.getSelection?.() || ''),
            visibleText: getVisibleText(),
            links: getLinks()
          }
        });
        return;
      }
      if (msg.action === 'run_js') {
        const value = Function(`"use strict"; return (${msg.args?.code || 'null'});`)();
        sendResponse({ ok: true, result: value });
        return;
      }
      sendResponse({ ok: false, error: { message: 'Unsupported action' } });
    } catch (error) {
      sendResponse({ ok: false, error: { message: error.message } });
    }
  })();
  return true;
});
