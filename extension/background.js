/**
 * Privora Manifest V3 Background Service Worker
 * - Centralizes cross-tab audit log events and synchronizes extension security state.
 * - Monitors file downloads to detect when an encrypted document is saved and alerts for auto-restoration.
 */

let globalRecentManifests = [];

// Store audit events in chrome.storage.local
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'STORE_MANIFEST' && message.manifest) {
    globalRecentManifests.unshift(message.manifest);
    if (globalRecentManifests.length > 30) globalRecentManifests.length = 30;
    chrome.storage.local.get(['aegis_active_manifests', 'aegis_encrypted_manifests'], (res) => {
      const active = res.aegis_active_manifests || [];
      const filtered = active.filter(m => m.id !== message.manifest.id);
      filtered.unshift(message.manifest);
      chrome.storage.local.set({
        aegis_active_manifests: filtered.slice(0, 25),
        aegis_encrypted_manifests: filtered.slice(0, 25)
      }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.type === 'LOG_AUDIT_EVENT') {
    const event = message.event;
    event.id = 'ext_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    event.timestamp = Date.now();
    event.source = 'EXTENSION';

    chrome.storage.local.get(['aegis_audit_logs'], (res) => {
      const logs = res.aegis_audit_logs || [];
      logs.unshift(event);
      chrome.storage.local.set({ aegis_audit_logs: logs.slice(0, 200) }, () => {
        sendResponse({ success: true, eventId: event.id });
      });
    });
    return true;
  }

  if (message.type === 'GET_AUDIT_LOGS') {
    chrome.storage.local.get(['aegis_audit_logs'], (res) => {
      sendResponse({ logs: res.aegis_audit_logs || [] });
    });
    return true;
  }

  if (message.type === 'GET_MANIFESTS') {
    chrome.storage.local.get(['aegis_active_manifests', 'aegis_encrypted_manifests'], (res) => {
      const stored = [...(res.aegis_active_manifests || []), ...(res.aegis_encrypted_manifests || [])];
      const combined = [...globalRecentManifests];
      for (const m of stored) {
        if (!combined.some(c => c.id === m.id)) combined.push(m);
      }
      sendResponse({ manifests: combined });
    });
    return true;
  }

  if (message.type === 'FETCH_BLOB' && message.url) {
    fetch(message.url, { credentials: 'include' })
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ success: true, dataUrl: reader.result, mimeType: blob.type });
        };
        reader.readAsDataURL(blob);
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

// Monitor Completed Downloads silently for audit logging if matched
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'complete') {
      chrome.downloads.search({ id: delta.id }, (items) => {
        if (items && items.length > 0) {
          const item = items[0];
          const fileName = item.filename ? item.filename.split(/[\/\\]/).pop() : '';

          chrome.storage.local.get(['privora_shield_enabled', 'aegis_active_manifests', 'aegis_encrypted_manifests'], (res) => {
            if (res.privora_shield_enabled === false) {
              console.log('[Privora] Shield is OFF; skipping download retrace check.');
              return;
            }
            const manifests = [...(res.aegis_active_manifests || []), ...(res.aegis_encrypted_manifests || [])];
            const matched = manifests.find(m => {
              const mBase = (m.fileName || '').replace(/\.[^/.]+$/, '').toLowerCase();
              const fBase = fileName.replace(/\.[^/.]+$/, '').toLowerCase();
              return mBase && fBase && (fBase.includes(mBase) || mBase.includes(fBase));
            });

            if (matched) {
              console.log('[Privora] Downloaded file matched with active encryption record:', matched.fileName);
            }
          });
        }
      });
    }
  });
}
