// Privora Shield Extension Popup Controller
// Synchronizes master ON/OFF toggle state, theme status, and links to web dashboard

const masterToggle = document.getElementById('shield-master-toggle');
const shieldBadge = document.getElementById('shield-badge');
const toggleStateText = document.getElementById('toggle-state-text');
const toggleStateDesc = document.getElementById('toggle-state-desc');
const statusLine = document.getElementById('status-line');
const statusDot = document.getElementById('status-dot');
const statusTitleText = document.getElementById('status-title-text');
const featUpload = document.getElementById('feat-upload');
const featPreview = document.getElementById('feat-preview');
const featClipboard = document.getElementById('feat-clipboard');
const featRetrace = document.getElementById('feat-retrace');
const protectedCountEl = document.getElementById('protected-count');

function updateUI(isEnabled) {
  if (masterToggle) masterToggle.checked = isEnabled;

  if (shieldBadge) {
    shieldBadge.textContent = isEnabled ? 'ACTIVE' : 'OFF';
    shieldBadge.className = `badge ${isEnabled ? 'badge-active' : 'badge-off'}`;
  }

  if (toggleStateText) {
    toggleStateText.textContent = isEnabled ? 'Privacy Shield ON' : 'Privacy Shield OFF';
  }

  if (toggleStateDesc) {
    toggleStateDesc.textContent = isEnabled
      ? 'Real-time uploads & paste protected'
      : 'Protection paused · interception disabled';
  }

  if (statusLine && statusDot && statusTitleText) {
    if (isEnabled) {
      statusLine.classList.remove('is-off');
      statusDot.classList.remove('is-off');
      statusTitleText.textContent = '100% On-Device Interceptor Active';
    } else {
      statusLine.classList.add('is-off');
      statusDot.classList.add('is-off');
      statusTitleText.textContent = 'Protection Paused (Standby)';
    }
  }

  const stateStr = isEnabled ? 'Enabled' : 'Paused';
  const activeStr = isEnabled ? 'Active' : 'Paused';
  if (featUpload) featUpload.textContent = activeStr;
  if (featPreview) featPreview.textContent = stateStr;
  if (featClipboard) featClipboard.textContent = stateStr;
  if (featRetrace) featRetrace.textContent = activeStr;
}

// 1. Initialize State from chrome.storage.local
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(
    ['privora_shield_enabled', 'aegis_active_manifests', 'aegis_encrypted_manifests'],
    (res) => {
      const isEnabled = res.privora_shield_enabled !== false; // default true
      updateUI(isEnabled);

      const manifests = res.aegis_active_manifests || res.aegis_encrypted_manifests || [];
      if (protectedCountEl) {
        protectedCountEl.textContent = `${manifests.length} File${manifests.length === 1 ? '' : 's'}`;
      }
    }
  );
}

// 2. Handle Master ON/OFF Switch
if (masterToggle) {
  masterToggle.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    updateUI(isEnabled);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ privora_shield_enabled: isEnabled }, () => {
        // Broadcast to all open tabs and background worker
        if (chrome.tabs && chrome.tabs.query) {
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                  type: 'PRIVORA_SHIELD_TOGGLED',
                  enabled: isEnabled,
                }).catch(() => {});
              }
            });
          });
        }
        if (chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'PRIVORA_SHIELD_TOGGLED',
            enabled: isEnabled,
          }).catch(() => {});
        }
      });
    }
  });
}

// 3. Open Web Dashboard button
document.getElementById('open-app-btn').addEventListener('click', () => {
  const targetUrl = 'http://localhost:5173';
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({}, (tabs) => {
      const existing = tabs.find((t) => t.url && t.url.includes('localhost:5173'));
      if (existing && existing.id) {
        chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId) {
          chrome.windows.update(existing.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
    });
  } else {
    window.open(targetUrl, '_blank');
  }
});

// 4. Open Test Tool Page button
const testBtn = document.getElementById('open-test-btn');
if (testBtn) {
  testBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const testUrl = chrome.runtime.getURL('test_page.html');
      chrome.tabs.create({ url: testUrl });
    } else {
      window.open('test_page.html', '_blank');
    }
  });
}
