/**
 * Privora Manifest V3 Background Service Worker
 * - Centralizes cross-tab audit log events and synchronizes extension security state.
 * - Monitors file downloads to detect when an encrypted document is saved and alerts for auto-restoration.
 */

// Store audit events in chrome.storage.local
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      sendResponse({ manifests: res.aegis_active_manifests || res.aegis_encrypted_manifests || [] });
    });
    return true;
  }
});

// Monitor Completed Downloads for Automatic Vault Matching & Tab Notification
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'complete') {
      chrome.downloads.search({ id: delta.id }, (items) => {
        if (items && items.length > 0) {
          const item = items[0];
          const fileName = item.filename ? item.filename.split(/[\/\\]/).pop() : '';

          chrome.storage.local.get(['aegis_active_manifests', 'aegis_encrypted_manifests'], (res) => {
            const manifests = [...(res.aegis_active_manifests || []), ...(res.aegis_encrypted_manifests || [])];
            const matched = manifests.find(m => {
              const mBase = (m.fileName || '').replace(/\.[^/.]+$/, '').toLowerCase();
              const fBase = fileName.replace(/\.[^/.]+$/, '').toLowerCase();
              return mBase && (fBase.includes(mBase) || mBase.includes(fBase));
            });

            if (matched) {
              console.log('[Privora] Downloaded file matched with active encryption record:', matched.fileName);
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0] && tabs[0].id) {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'PRIVORA_DOWNLOAD_MATCHED',
                    fileName,
                    manifest: matched,
                  }).catch(() => {});
                }
              });
            }
          });
        }
      });
    }
  });
}
