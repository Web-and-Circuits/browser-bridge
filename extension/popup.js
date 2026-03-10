const dot = document.getElementById('dot');
const label = document.getElementById('label');
const urlEl = document.getElementById('url');

async function refresh() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (tab) {
      label.textContent = 'Bridge active';
      urlEl.textContent = tab.url || '';
    } else {
      dot.classList.add('err');
      label.textContent = 'No active tab';
    }
  } catch (err) {
    dot.classList.add('err');
    label.textContent = 'Error';
    urlEl.textContent = err.message;
  }
}

refresh();
