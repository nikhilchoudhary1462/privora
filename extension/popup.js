document.getElementById('open-app-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://localhost:5173' });
});
