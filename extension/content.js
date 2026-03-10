function getVisibleText(root, maxChars = 10000) {
  const text = (root?.innerText || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '…';
}

function getLinks(root, maxLinks = 100) {
  return Array.from(root.querySelectorAll('a[href]'))
    .slice(0, maxLinks)
    .map(a => ({ text: (a.innerText || a.textContent || '').trim(), href: a.href }))
    .filter(l => l.href);
}

function getForms(root) {
  return Array.from(root.querySelectorAll('input, textarea, select, button'))
    .map(el => ({
      tag:         el.tagName.toLowerCase(),
      type:        el.type || null,
      name:        el.name || null,
      id:          el.id   || null,
      placeholder: el.placeholder || null,
      value:       el.tagName === 'SELECT'
                     ? el.options[el.selectedIndex]?.text || null
                     : (el.value || null),
      label:       el.labels?.[0]?.textContent?.trim() || null,
      selector:    el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : el.tagName.toLowerCase()
    }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const root = msg.args?.selector
        ? document.querySelector(msg.args.selector) || document.body
        : document.body;

      if (msg.action === 'snapshot') {
        const mode = msg.args?.mode || 'default';
        const result = {
          title:         document.title,
          url:           location.href,
          selectionText: String(window.getSelection?.() || '')
        };

        if (mode === 'forms') {
          result.forms = getForms(root);
        } else {
          result.visibleText = getVisibleText(root);
          result.links       = getLinks(root);
        }

        sendResponse({ ok: true, result });
        return;
      }

      sendResponse({ ok: false, error: { message: 'Unsupported action' } });
    } catch (error) {
      sendResponse({ ok: false, error: { message: error.message } });
    }
  })();
  return true;
});
