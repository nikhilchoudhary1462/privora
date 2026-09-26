// Privora - Main World Clipboard & Network Interception Hook
// Runs in the page's execution context to intercept clipboard writes (e.g., ChatGPT Copy button)
(function() {
  function isOwnPrivoraApp() {
    try {
      if (document.documentElement && (
        document.documentElement.getAttribute('data-privora-app') === 'true' ||
        document.documentElement.hasAttribute('data-privora-app')
      )) {
        return true;
      }
      if (typeof window !== 'undefined' && (
        window.__IS_PRIVORA_APP__ === true ||
        window.__PRIVORA_CORE__ !== undefined ||
        window.__privoraIsNativeApp === true
      )) {
        return true;
      }
      if (document.querySelector && (
        document.querySelector('meta[name="privora-app"]') ||
        document.querySelector('#root[data-privora-app="true"]')
      )) {
        return true;
      }
      const host = window.location.hostname;
      const port = window.location.port;
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
        if (['5173', '4173', '3000', '8080', '5174', '5175'].includes(port)) {
          if (port === '5173' || port === '4173') return true;
          if (document.title && document.title.toLowerCase().includes('privora')) return true;
        }
      }
      if (document.title && document.title.toLowerCase().includes('privora') && (host === 'localhost' || host === '127.0.0.1' || host.includes('privora'))) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  if (isOwnPrivoraApp()) {
    console.log('[Privora] Native Privora Web Application detected in main world. Bypassing clipboard hook.');
    return;
  }

  if (window.__privoraMainHookInstalled) return;
  window.__privoraMainHookInstalled = true;

  function getVault() {
    if (window.__privoraCachedVault && Array.isArray(window.__privoraCachedVault) && window.__privoraCachedVault.length > 0) {
      return window.__privoraCachedVault;
    }
    let vault = [];
    try {
      const raw = document.documentElement.getAttribute('data-privora-vault');
      if (raw) vault = JSON.parse(raw);
    } catch (e) {}
    if (!vault || vault.length === 0) {
      try {
        const rawSes = sessionStorage.getItem('privora_token_vault');
        if (rawSes) vault = JSON.parse(rawSes);
      } catch (e) {}
    }
    return Array.isArray(vault) ? vault : [];
  }

  function restoreTokensInText(text) {
    if (!text || typeof text !== 'string') return text;
    const vault = getVault();
    let restored = text;
    let hits = 0;

    if (vault.length > 0) {
      for (const tok of vault) {
        if (tok && tok.synthetic && restored.includes(tok.synthetic)) {
          restored = restored.split(tok.synthetic).join(tok.original);
          hits++;
        }
      }
    }

    // Strip badge artifacts
    restored = restored.replace(/[\s\u00A0]*\uD83D\uDD12[\s\u00A0]*DECRYPTED/gi, '');
    restored = restored.replace(/[\s\u00A0]*\[\s*\uD83D\uDD12?\s*DECRYPTED\s*\]/gi, '');
    restored = restored.replace(/[\s\u00A0]*DECRYPTED/gi, '');

    // Convert [text](mailto:email) → just email
    restored = restored.replace(/\[([^\]]+)\]\(mailto:([^)]+)\)/g, '$2');
    // Convert [text](url) → just text
    restored = restored.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Strip markdown bold/italic: **text** → text, __text__ → text, *text* → text, _text_ → text
    restored = restored.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    restored = restored.replace(/___([^_]+)___/g, '$1');
    restored = restored.replace(/\*\*([^*]+)\*\*/g, '$1');
    restored = restored.replace(/__([^_]+)__/g, '$1');
    restored = restored.replace(/\*([^*\n]+)\*/g, '$1');
    restored = restored.replace(/_([^_\n]+)_/g, '$1');

    if (hits > 0) {
      try {
        window.postMessage({ type: 'PRIVORA_CLIPBOARD_RESTORED', hits }, '*');
      } catch (e) {}
    }
    return restored;
  }


  // Hook navigator.clipboard.writeText (used by ChatGPT, Claude, etc. on Copy button click)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async function(text) {
      try {
        const cleaned = restoreTokensInText(text);
        return await origWriteText(cleaned);
      } catch (err) {
        return await origWriteText(text);
      }
    };
  }

  // Hook navigator.clipboard.write for rich text clipboard writes
  if (navigator.clipboard && navigator.clipboard.write) {
    const origWrite = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = async function(items) {
      try {
        const newItems = [];
        for (const item of items) {
          if (item && item.types && item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            const text = await blob.text();
            const cleaned = restoreTokensInText(text);
            const data = {};
            for (const type of item.types) {
              if (type === 'text/plain') {
                data[type] = new Blob([cleaned], { type: 'text/plain' });
              } else {
                data[type] = await item.getType(type);
              }
            }
            newItems.push(new ClipboardItem(data));
          } else {
            newItems.push(item);
          }
        }
        return await origWrite(newItems);
      } catch (err) {
        return await origWrite(items);
      }
    };
  }

  // Listen for vault sync events from content script
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'PRIVORA_SYNC_VAULT' && Array.isArray(e.data.vault)) {
      window.__privoraCachedVault = e.data.vault;
    }
  });

  console.log('[Privora] Main world clipboard protection armed.');
})();
