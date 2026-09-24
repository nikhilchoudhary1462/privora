// Populate active manifests count from storage
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['aegis_active_manifests'], (res) => {
    const manifests = res.aegis_active_manifests || [];
    const countEl = document.getElementById('protected-count');
    if (countEl) {
      countEl.textContent = `${manifests.length} Doc${manifests.length === 1 ? '' : 's'}`;
    }
  });
}

document.getElementById('open-app-btn').addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      const existing = tabs.find(t => t.url && t.url.includes('localhost:5173'));
      if (existing && existing.id) {
        chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId) {
          chrome.windows.update(existing.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: 'https://localhost:5173' });
      }
    });
  } else {
    window.open('https://localhost:5173', '_blank');
  }
});
