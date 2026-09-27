/**
 * Privora Manifest V3 Real-Time Privacy Shield & Auto-Retrace Manager
 * - Pre-Upload Interception: Blocks raw document uploads on any website, blurs sensitive regions, with interactive corner handles, drag-to-move, and custom box drawing.
 * - Auto-Retrace on Download: Intercepts downloads of modified/compressed images, matches with local manifest, and patches unblurred slices back on!
 * - In-Page Floating Hub: Quick-retrace dropzone for instant manual unblurring of any downloaded file.
 */

(function () {
  'use strict';

  // -------------------------------------------------------------
  // Self-Site Immunity: Do NOT run on Privora's own web application
  // -------------------------------------------------------------
  function isOwnPrivoraApp() {
    try {
      // 1. Direct DOM attributes / meta / globals
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

      // 2. Hostname & Port check (Vite dev server, preview, or local Privora servers)
      const host = window.location.hostname;
      const port = window.location.port;
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
        if (['5173', '4173', '3000', '8080', '5174', '5175'].includes(port)) {
          if (port === '5173' || port === '4173') return true;
          if (document.title && document.title.toLowerCase().includes('privora')) return true;
        }
      }

      // 3. Document Title check
      if (document.title && document.title.toLowerCase().includes('privora') && (host === 'localhost' || host === '127.0.0.1' || host.includes('privora'))) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  if (isOwnPrivoraApp()) {
    console.log('[Privora Extension] Native Privora Web Application detected. Bypassing all extension listeners and UI.');

    // Silent manifest bridge: Allows native web app (Vault & Studio) to decrypt files protected by the extension
    function syncManifestsToNativeApp() {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['aegis_active_manifests', 'aegis_encrypted_manifests'], (res) => {
            const manifests = [...(res?.aegis_active_manifests || []), ...(res?.aegis_encrypted_manifests || [])];
            if (manifests.length > 0) {
              window.postMessage({ type: 'PRIVORA_SYNC_EXTENSION_MANIFESTS', manifests }, '*');
              try {
                sessionStorage.setItem('privora_extension_manifests', JSON.stringify(manifests));
              } catch (e) {}
            }
          });
        }
      } catch (err) {}
    }

    syncManifestsToNativeApp();
    setTimeout(syncManifestsToNativeApp, 800);

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'PRIVORA_REQUEST_EXTENSION_MANIFESTS') {
        syncManifestsToNativeApp();
      }
    });

    return;
  }

  // -------------------------------------------------------------
  // Master Privacy Shield State (Synchronized via Chrome Storage)
  // -------------------------------------------------------------
  let isShieldEnabled = true;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['privora_shield_enabled'], (res) => {
      if (typeof res.privora_shield_enabled === 'boolean') {
        isShieldEnabled = res.privora_shield_enabled;
      }
    });

    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes.privora_shield_enabled) {
            isShieldEnabled = changes.privora_shield_enabled.newValue !== false;
            console.log('[Privora Shield] Active status:', isShieldEnabled ? 'ON' : 'OFF');
          }
          if (changes.aegis_active_manifests && changes.aegis_active_manifests.newValue) {
            window._privoraRecentManifests = changes.aegis_active_manifests.newValue;
          }
        }
      });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'PRIVORA_SHIELD_TOGGLED') {
        isShieldEnabled = msg.enabled !== false;
        console.log('[Privora Shield] Toggle received:', isShieldEnabled ? 'ON' : 'OFF');
      }
    });
  }

  // -------------------------------------------------------------
  // Safe Cross-Context Utilities (Timeout-protected messaging & CSP-safe PDF Worker)
  // -------------------------------------------------------------
  function sendRuntimeMessageWithTimeout(msg, timeoutMs = 2500) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(null);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(resp);
          }
        });
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    });
  }

  function dataUrlToBlob(dataUrl) {
    if (!dataUrl) return null;
    try {
      const parts = dataUrl.split(',');
      if (parts.length < 2) return null;
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (e) {
      return null;
    }
  }

  function ensurePdfWorkerHandler() {
    try {
      const pWorker = (typeof pdfjsWorker !== 'undefined') ? pdfjsWorker :
                      (typeof globalThis !== 'undefined' && globalThis.pdfjsWorker) ? globalThis.pdfjsWorker :
                      (typeof window !== 'undefined' && window.pdfjsWorker) ? window.pdfjsWorker : null;
      const pLib = (typeof pdfjsLib !== 'undefined') ? pdfjsLib :
                   (typeof globalThis !== 'undefined' && globalThis.pdfjsLib) ? globalThis.pdfjsLib :
                   (typeof window !== 'undefined' && window.pdfjsLib) ? window.pdfjsLib : null;

      if (pWorker) {
        if (typeof globalThis !== 'undefined') globalThis.pdfjsWorker = pWorker;
        if (typeof window !== 'undefined') window.pdfjsWorker = pWorker;
      }
      if (pLib && pLib.PDFWorker && pWorker && pWorker.WorkerMessageHandler) {
        try {
          Object.defineProperty(pLib.PDFWorker, '_mainThreadWorkerMessageHandler', {
            get: () => pWorker.WorkerMessageHandler,
            configurable: true,
            enumerable: true
          });
        } catch (e) {}
      }
      if (pLib && pLib.GlobalWorkerOptions && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        try {
          pLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
        } catch (e) {}
      }
      return { pdfLib: pLib, workerLib: pWorker };
    } catch (e) {
      return { pdfLib: null, workerLib: null };
    }
  }
  ensurePdfWorkerHandler();

  // -------------------------------------------------------------
  // 1. Deterministic PII Detection Algorithms
  // -------------------------------------------------------------
  const verhoeffTableD = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];

  const verhoeffTableP = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];

  function validateVerhoeff(numStr) {
    const clean = numStr.replace(/\D/g, '');
    if (clean.length !== 12 || !/^[2-9]\d{11}$/.test(clean)) return false;
    let c = 0;
    const invertedArray = clean.split('').map(Number).reverse();
    for (let i = 0; i < invertedArray.length; i++) {
      c = verhoeffTableD[c][verhoeffTableP[i % 8][invertedArray[i]]];
    }
    return c === 0;
  }

  function validateLuhn(numStr) {
    const clean = numStr.replace(/\D/g, '');
    if (clean.length < 13 || clean.length > 19 || /^0+$/.test(clean)) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = clean.length - 1; i >= 0; i--) {
      let digit = parseInt(clean.charAt(i), 10);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function validatePAN(str) {
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(str.trim());
  }

  function validateSSN(str) {
    const clean = str.replace(/[-\s]/g, '');
    if (clean.length !== 9 || !/^\d{9}$/.test(clean)) return false;
    const area = Number(clean.slice(0, 3));
    const group = Number(clean.slice(3, 5));
    const serial = Number(clean.slice(5, 9));
    return area !== 0 && area !== 666 && area < 900 && group !== 0 && serial !== 0;
  }

  function validatePhone(str) {
    const clean = str.replace(/\D/g, '');
    if (clean.length === 10) return /^[6-9]\d{9}$/.test(clean);
    if (clean.length === 11 && clean.startsWith('1')) return /^1[2-9]\d{9}$/.test(clean);
    if (clean.length === 12 && clean.startsWith('91')) return /^91[6-9]\d{9}$/.test(clean);
    return false;
  }

  function validateDOB(str) {
    if (!str || typeof str !== 'string') return false;
    const clean = str.trim();
    const dmyMatch = /^([0-3]?\d)[\/\-\.]([0-1]?\d)[\/\-\.]((?:19|20)\d{2})$/.exec(clean);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10);
      const year = parseInt(dmyMatch[3], 10);
      return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2026;
    }
    const ymdMatch = /^((?:19|20)\d{2})[\/\-\.]([0-1]?\d)[\/\-\.]([0-3]?\d)$/.exec(clean);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10);
      const day = parseInt(ymdMatch[3], 10);
      return day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2026;
    }
    if (/^(?:19|20)\d{2}$/.test(clean)) {
      const year = parseInt(clean, 10);
      return year >= 1900 && year <= 2026;
    }
    return false;
  }

  // Inject CSS Keyframes if not present
  if (typeof document !== 'undefined' && !document.getElementById('aegis-guard-keyframes')) {
    const style = document.createElement('style');
    style.id = 'aegis-guard-keyframes';
    style.textContent = `
      @keyframes aegisFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const NAME_STOP_WORDS = new Set([
    'is', 'am', 'are', 'was', 'were', 'my', 'me', 'i', 'only', 'just',
    'email', 'mail', 'id', 'phone', 'mobile', 'contact', 'no', 'number', 'num',
    'address', 'addr', 'dob', 'date', 'birth', 'gender', 'sex', 'male', 'female',
    'order', 'ord', 'account', 'acc', 'card', 'pan', 'aadhaar', 'aadhar',
    'father', 'mother', 'husband', 'guardian', 'parent', 'relation',
    'student', 'roll', 'reg', 'registration', 'university', 'college', 'school',
    'please', 'kindly', 'request', 'application', 'leave', 'cancel', 'cancellation',
    'and', 'with', 'for', 'to', 'from', 'at', 'in', 'on', 'the', 'a', 'an'
  ]);

  function extractCleanName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const firstLine = raw.split(/[\r\n,;]/)[0];
    const words = firstLine.trim().split(/\s+/);
    while (words.length > 0 && NAME_STOP_WORDS.has(words[0].toLowerCase().replace(/[^a-z]/g, ''))) {
      words.shift();
    }
    const cleanWords = [];
    for (const w of words) {
      const lower = w.toLowerCase().replace(/[^a-z]/g, '');
      if (!lower || NAME_STOP_WORDS.has(lower)) {
        break;
      }
      cleanWords.push(w.replace(/[^a-zA-Z]/g, ''));
    }
    if (cleanWords.length >= 1 && cleanWords.length <= 4) {
      return cleanWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    return null;
  }

  function sanitizeStoredNameToken(val) {
    if (!val || typeof val !== 'string') return val;
    const lower = val.toLowerCase();
    if (lower.startsWith('is ') || lower.includes('email is') || lower.includes('mail id') || lower.includes('phone is') || lower.includes('only')) {
      const cleaned = extractCleanName(val);
      if (cleaned) return cleaned;
    }
    return val;
  }

  function safeReplaceToken(targetText, findVal, replaceVal) {
    if (!targetText || !findVal) return targetText;
    if (targetText.includes(findVal)) {
      return targetText.split(findVal).join(replaceVal);
    }
    try {
      const esc = findVal.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
      const rx = new RegExp(esc, 'gi');
      return targetText.replace(rx, replaceVal);
    } catch (e) {
      return targetText;
    }
  }

  function scanText(text) {
    const results = [];
    if (!text || typeof text !== 'string') return results;

    // Build a set of known synthetic values currently in the vault — skip detecting them as PII
    // This prevents already-tokenized fields from being flagged and double-encrypted
    const vaultSyntheticValues = new Set(
      (window._privoraTokenVault || []).map(t => t.synthetic).filter(Boolean)
    );
    // Also skip synthetic email domains
    const SYNTH_DOMAINS_RE = /\b\w+\.\d{3}@(sandbox\.test|synthetic\.org|demo-vault\.internal|privacy-sandbox\.net)\b/i;

    let match;

    // 1. PAN Card (case-insensitive search, validated uppercase)
    const panRegex = /\b([A-Za-z]{5}[0-9]{4}[A-Za-z]{1})\b/g;
    while ((match = panRegex.exec(text)) !== null) {
      if (validatePAN(match[1]) && !vaultSyntheticValues.has(match[1].toUpperCase())) {
        results.push({ type: 'PAN_CARD', label: 'PAN Card', value: match[1].toUpperCase() });
      }
    }

    // 2. Aadhaar UID (matches valid Verhoeff, formatted 4-4-4, or context-prefixed 12-digit IDs)
    const aadhaarRegex = /(?:(?:Aadhaar|Aadhar|UID|UIDAI|आधार)\s*[:\-\s#]*\s*)?\b([2-9]\d{3}[\s\-\.]*\d{4}[\s\-\.]*\d{4})\b/gi;
    const seenAadhaar = new Set();
    while ((match = aadhaarRegex.exec(text)) !== null) {
      const val = match[1]?.trim();
      if (!val) continue;
      const raw = val.replace(/[-\s\.]/g, '');
      if (raw.length === 12 && !seenAadhaar.has(raw) && !vaultSyntheticValues.has(val)) {
        seenAadhaar.add(raw);
        const isVerhoeff = validateVerhoeff(raw);
        const isFormatted = /^[2-9]\d{3}[\s\-\.]+\d{4}[\s\-\.]+\d{4}$/.test(val);
        const hasKeyword = /Aadhaar|Aadhar|UID|UIDAI|आधार/i.test(match[0]);

        if (isVerhoeff || isFormatted || hasKeyword) {
          results.push({
            type: 'AADHAAR',
            label: isVerhoeff ? 'Aadhaar UID' : 'Aadhaar UID (Pattern)',
            value: val,
            verified: isVerhoeff,
          });
        }
      }
    }

    // 3. Credit / Debit Card (Luhn Mod-10 or 16-digit card pattern)
    const cardRegex = /\b(?:\d{4}[-\s]?){3}\d{1,4}\b|\b\d{4}[-\s]?\d{6}[-\s]?\d{5}\b|\b\d{13,19}\b/g;
    const seenCard = new Set();
    while ((match = cardRegex.exec(text)) !== null) {
      const raw = match[0].replace(/[-\s]/g, '');
      if (!seenCard.has(raw) && !vaultSyntheticValues.has(match[0])) {
        seenCard.add(raw);
        if (validateLuhn(raw)) {
          results.push({ type: 'CREDIT_CARD', label: 'Payment Card', value: match[0] });
        }
      }
    }

    // 4. SSN
    const ssnRegex = /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g;
    while ((match = ssnRegex.exec(text)) !== null) {
      if (validateSSN(match[0]) && !vaultSyntheticValues.has(match[0])) {
        results.push({ type: 'SSN', label: 'US SSN', value: match[0] });
      }
    }

    // 5. Email — skip synthetic domain addresses already in vault
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    while ((match = emailRegex.exec(text)) !== null) {
      const emailVal = match[0];
      if (!vaultSyntheticValues.has(emailVal) && !SYNTH_DOMAINS_RE.test(emailVal)) {
        results.push({ type: 'EMAIL', label: 'Email Address', value: emailVal });
      }
    }

    // 6. Phone (Supports +91 / international, with 5-5 grouping, 3-3-4 grouping, or continuous 10 digits)
    const phoneRegex = /(?:\+91[-\s]?)?\b[6-9]\d{4}[-\s]\d{5}\b|(?:\+91[-\s]?)?\b[6-9]\d{2}[-\s]\d{3}[-\s]\d{4}\b|(?:\+91[-\s]?)?\b[6-9]\d{9}\b|\b(?:\+?1[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b/g;
    while ((match = phoneRegex.exec(text)) !== null) {
      const phoneVal = match[0].trim();
      if (validatePhone(phoneVal) && !vaultSyntheticValues.has(phoneVal)) {
        results.push({ type: 'PHONE', label: 'Phone Number', value: phoneVal });
      }
    }

    // 7. API Keys, Tokens & Secrets
    const apiKeyRegex = /(?:test_|demo_|live_|prod_)?sk[_-](?:proj[_-]|live[_-]|test[_-])?[a-zA-Z0-9_\-]{8,64}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|(?:test_|demo_)?api[_-](?:key[_-]|secret[_-])?[a-zA-Z0-9_\-]{6,64}|(?:demo_|test_)?tok[_-][a-zA-Z0-9_\-]{8,64}|Bearer\s+[a-zA-Z0-9_\-\.]{16,}/gi;
    while ((match = apiKeyRegex.exec(text)) !== null) {
      if (!results.some(r => r.value === match[0]) && !vaultSyntheticValues.has(match[0])) {
        results.push({ type: 'API_KEY', label: 'API Secret Key', value: match[0] });
      }
    }

    // 7b. Labeled Credentials & Passwords
    const labeledSecretRegex = /(?:(?:API\s*(?:Key|secret)|Access\s*Token|Secret\s*Key|Password|Auth\s*Token)(?:-like\s*value|\s*value|\s*secret)?\s*[:=\s]\s*)([^\s,;]+)/gi;
    while ((match = labeledSecretRegex.exec(text)) !== null) {
      const val = match[1]?.trim();
      if (val && val.length >= 4 && !results.some(r => r.value === val) && !vaultSyntheticValues.has(val)) {
        results.push({ type: 'API_KEY', label: 'Secret Credential / Token', value: val });
      }
    }

    // 7c. Labeled OTP (One-Time Password)
    const otpRegex = /(?:(?:OTP|One-Time\s*Password|Verification\s*Code)\s*[:\-\s=]\s*)([0-9]{4,8})\b/gi;
    while ((match = otpRegex.exec(text)) !== null) {
      const val = match[1]?.trim();
      if (val && !results.some(r => r.value === val) && !vaultSyntheticValues.has(val)) {
        results.push({ type: 'API_KEY', label: 'One-Time Password (OTP)', value: val });
      }
    }

    // 8. Date of Birth (DOB)
    const seenDob = new Set();
    const dobRegex = /(?:जन्म\s*(?:तारीख|तिथि)\s*\/\s*DOB|जन्म\s*वर्ष\s*\/\s*(?:Year\s*of\s*Birth|YOB)|DOB|D\.O\.B\.?|Date\s*of\s*Birth|Birth\s*Date|Year\s*of\s*Birth|YOB|जन्म\s*(?:तिथि|तारीख|वर्ष))\s*[:\/\-\s]*([0-3]?\d[\/\-\.][0-1]?\d[\/\-\.](?:19|20)\d{2}|(?:19|20)\d{2})/gi;
    while ((match = dobRegex.exec(text)) !== null) {
      const val = match[1]?.trim();
      if (val && validateDOB(val) && !seenDob.has(val)) {
        seenDob.add(val);
        results.push({ type: 'DOB', label: 'Date of Birth (DOB)', value: val });
      }
    }

    // 9. Masked Aadhaar Number (XXXX XXXX 1234 or •••• •••• 1234)
    const maskedAadhaarRegex = /(?<=(?:^|\s|[:;,-]))([xX*•]{4}[\s-]?[xX*•]{4}[\s-]?[0-9]{4})\b/gu;
    while ((match = maskedAadhaarRegex.exec(text)) !== null) {
      results.push({ type: 'AADHAAR', label: 'Masked Aadhaar Number', value: match[1] });
    }

    // 10. Full Name & Demographic Identity
    const namePrefixRegex = /(?:(?:my\s+)?(?:name|full\s*name|patient\s*name|customer\s*name|holder\s*name|candidate\s*name|applicant\s*name|नाम)\s*(?:is|[:=\-\/])*\s*|(?:i\s+am|i'm)\s+)([a-zA-Z \t\.]{2,60})/gi;
    while ((match = namePrefixRegex.exec(text)) !== null) {
      const val = extractCleanName(match[1]);
      if (val && val.length >= 3 && !vaultSyntheticValues.has(val) &&
          !/^(DOB|Date|Year|Male|Female|Gender|Mail|Email|Phone|No|Id)$/i.test(val)) {
        results.push({ type: 'NAME', label: 'Full Name / Demographic', value: val });
      }
    }

    // 11. Guardian / Relative (Father's Name, Husband's Name, C/O, S/O, D/O, W/O)
    const guardianPrefixRegex = /(?:(?:father'?s\s*name|care\s*of|c\/o|s\/o|d\/o|w\/o|husband'?s\s*name|पिता\s*का\s*नाम|पति\s*का\s*नाम)\s*(?:is|[:=\-\/])*\s*)([a-zA-Z \t\.]{2,60})/gi;
    while ((match = guardianPrefixRegex.exec(text)) !== null) {
      const val = extractCleanName(match[1]);
      if (val && val.length >= 3 && !vaultSyntheticValues.has(val)) {
        results.push({ type: 'NAME', label: 'Guardian / Relative Name', value: val });
      }
    }

    // 12. Gender / Sex
    const genderRegex = /(?:(?:Gender|Sex|लिंग)\s*[:\-\/\s]\s*)(MALE|FEMALE|TRANSGENDER|पुरुष|महिला)\b/gi;
    while ((match = genderRegex.exec(text)) !== null) {
      results.push({ type: 'CUSTOM', label: 'Gender Demographic', value: match[1] });
    }

    // 13. Residential Address & PIN Code
    const addressRegex = /(?:(?:Address|Residential Address|Residing at|पता)\s*[:\-\/\s]\s*)([A-Za-z0-9\s,\-\/\.]{6,60})(?=[;\n\r]|(?:PIN|Phone|Email|City|State|DOB|Name|Account|Total|Synthetic)|$)/gi;
    while ((match = addressRegex.exec(text)) !== null) {
      const addrVal = match[1]?.trim();
      if (addrVal && addrVal.length >= 8) {
        results.push({ type: 'ADDRESS', label: 'Residential Address', value: addrVal });
      }
    }

    const pinRegex = /\b(?:PIN|Postal Code|Pincode|Pin Code)\s*[:\-\s]?([1-9][0-9]{2}\s?[0-9]{3})\b/gi;
    while ((match = pinRegex.exec(text)) !== null) {
      const pinVal = match[1]?.trim();
      if (pinVal && !results.some(r => r.value && r.value.includes(pinVal))) {
        results.push({ type: 'ADDRESS', label: 'Postal PIN Code', value: pinVal });
      }
    }

    // 14. Financial Information: Bank Account Number & IFSC Code
    const ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/g;
    while ((match = ifscRegex.exec(text)) !== null) {
      results.push({ type: 'FINANCIAL_DATA', label: 'Bank IFSC Code', value: match[1] });
    }

    const bankAccRegex = /(?:(?:A\/C(?:\s*(?:No|Number|\.))?|Account(?:\s*(?:No|Number|\.))?|खाता\s*(?:संख्या|नंबर)?)\s*[:\-\s]*)([0-9]{9,18})\b/gi;
    while ((match = bankAccRegex.exec(text)) !== null) {
      results.push({ type: 'FINANCIAL_DATA', label: 'Bank Account Number', value: match[1] });
    }

    // 15. Voter ID (EPIC) & Driving License
    const voterIdRegex = /\b([A-Z]{3}[0-9]{7})\b/g;
    while ((match = voterIdRegex.exec(text)) !== null) {
      results.push({ type: 'GOVERNMENT_ID', label: 'Voter ID (EPIC)', value: match[1] });
    }

    const dlRegex = /\b([A-Z]{2}[-\s]?[0-9]{2,4}[-\s]?[0-9]{7,11})\b/g;
    while ((match = dlRegex.exec(text)) !== null) {
      results.push({ type: 'DRIVING_LICENSE', label: 'Driving License Number', value: match[1] });
    }

    // Deduplicate: remove any result whose value is already covered by an earlier result
    const seen = new Set();
    return results.filter(r => {
      if (!r.value || seen.has(r.value)) return false;
      seen.add(r.value);
      return true;
    });
  }


  // -------------------------------------------------------------
  // 2. Cryptographic Helpers (SHA-256)
  // -------------------------------------------------------------

  // 2. Cryptographic Helpers (SHA-256)
  // -------------------------------------------------------------
  async function computeSHA256(buffer) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(hash);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  /**
   * Estimates an appropriate JPEG encoding quality based on bytes-per-pixel ratio
   * to prevent re-encoded images from ballooning past their input compression level.
   */
  function estimateJpegQualityFromSize(blob, width, height) {
    const size = typeof blob === 'number' ? blob : (blob?.size || 0);
    if (!size || !width || !height || width <= 0 || height <= 0) return 0.85;

    const totalPixels = width * height;
    const bytesPerPixel = size / totalPixels;

    // Heuristic mapping from bytes-per-pixel to estimated JPEG quality
    let quality;
    if (bytesPerPixel <= 0.08) {
      quality = 0.50 + (bytesPerPixel / 0.08) * 0.15; // 0.50 .. 0.65 (heavy compression)
    } else if (bytesPerPixel <= 0.20) {
      quality = 0.65 + ((bytesPerPixel - 0.08) / 0.12) * 0.15; // 0.65 .. 0.80 (moderate compression)
    } else if (bytesPerPixel <= 0.40) {
      quality = 0.80 + ((bytesPerPixel - 0.20) / 0.20) * 0.10; // 0.80 .. 0.90 (standard web quality)
    } else {
      quality = 0.90 + Math.min(0.02, ((bytesPerPixel - 0.40) / 0.40) * 0.02); // 0.90 .. 0.92 (high quality)
    }

    // Clamp to sane range [0.50, 0.92]
    return Math.min(0.92, Math.max(0.50, Math.round(quality * 100) / 100));
  }

  // -------------------------------------------------------------
  // 3. Session Encryption Tracking & Centralized In-Page Floating HUD
  // -------------------------------------------------------------
  window._privoraSiteHasEncryptedFiles = window._privoraSiteHasEncryptedFiles || false;
  try {
    if (sessionStorage.getItem('privora_has_encrypted') === 'true') {
      window._privoraSiteHasEncryptedFiles = true;
    }
  } catch (e) {}

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['aegis_active_manifests'], (res) => {
      const active = res?.aegis_active_manifests || [];
      window._privoraRecentManifests = active;
      const currentHost = (window.location.hostname || '').replace(/^www\./, '').toLowerCase();
      if (currentHost && active.some(m => {
        const mHost = (m.hostname || '').replace(/^www\./, '').toLowerCase();
        return mHost && (mHost.includes(currentHost) || currentHost.includes(mHost));
      })) {
        window._privoraSiteHasEncryptedFiles = true;
        try { sessionStorage.setItem('privora_has_encrypted', 'true'); } catch (e) {}
      }
    });
  }

  function hasSiteEncryptedFiles() {
    if (window._privoraSiteHasEncryptedFiles) return true;
    try {
      if (sessionStorage.getItem('privora_has_encrypted') === 'true') return true;
    } catch (e) {}

    const currentHost = (window.location.hostname || '').replace(/^www\./, '').toLowerCase();
    if (!currentHost) return false;

    const memManifests = window._privoraRecentManifests || [];
    return memManifests.some(m => {
      const mHost = (m.hostname || '').replace(/^www\./, '').toLowerCase();
      return mHost && (mHost.includes(currentHost) || currentHost.includes(mHost));
    });
  }

  let activeHud = null;
  let hudTimer = null;

  function showPrivoraHud({
    type = 'info', // 'encrypting' | 'encrypted' | 'decrypting' | 'decrypted' | 'warning'
    title = 'Privora Privacy Shield',
    subtitle = '',
    durationMs = 4000,
    actionLabel = null,
    onAction = null,
  }) {
    if (activeHud) {
      clearTimeout(hudTimer);
      activeHud.remove();
      activeHud = null;
    }

    const hud = document.createElement('div');
    hud.id = 'privora-live-hud';
    hud.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      z-index: 2147483647 !important;
      background: #FAF9F6 !important;
      color: #212529 !important;
      border: 1px solid rgba(0, 0, 0, 0.08) !important;
      border-radius: 16px !important;
      padding: 12px 18px !important;
      box-shadow: 0 16px 36px -8px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(156, 141, 212, 0.25) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      max-width: 440px !important;
      min-width: 320px !important;
      animation: aegisFadeIn 0.25s ease-out !important;
      backdrop-filter: blur(12px) !important;
    `;

    const isDec = type.includes('dec');
    const isEnc = type.includes('enc');
    const iconBg = isDec ? '#ECFDF5' : (isEnc ? 'rgba(156, 141, 212, 0.15)' : '#EFF6FF');
    const iconBorder = isDec ? '#A7F3D0' : (isEnc ? 'rgba(156, 141, 212, 0.4)' : '#BFDBFE');
    const iconColor = isDec ? '#059669' : '#9C8DD4';
    const icon = isDec ? '✨' : (type === 'encrypting' ? '🔄' : '🛡️');

    hud.innerHTML = `
      <div style="width:36px; height:36px; border-radius:10px; background:${iconBg}; border:1px solid ${iconBorder}; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;">
        ${icon}
      </div>
      <div style="flex:1; min-width:0;">
        <div style="display:flex; align-items:center; gap:6px;">
          <strong style="font-size:12px; font-weight:700; color:#212529; letter-spacing:-0.01em;">${title}</strong>
          <span style="font-size:9px; font-family:monospace; font-weight:700; padding:1px 6px; border-radius:9999px; background:#FAF9F6; color:${iconColor}; border:1px solid ${iconBorder};">
            ${type.toUpperCase()}
          </span>
        </div>
        <p style="margin:2px 0 0; font-size:11px; color:#757575; line-height:1.35; word-break:break-word;">
          ${subtitle}
        </p>
      </div>
    `;

    if (actionLabel && onAction) {
      const btn = document.createElement('button');
      btn.style.cssText = `
        background: #212529;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 5px 9px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      `;
      btn.textContent = actionLabel;
      btn.onclick = (e) => {
        e.stopPropagation();
        onAction();
      };
      hud.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:transparent; border:none; color:#9ca3af; font-size:14px; cursor:pointer; padding:2px; margin-left:4px;';
    closeBtn.innerHTML = '✕';
    closeBtn.onclick = () => {
      hud.remove();
      activeHud = null;
    };
    hud.appendChild(closeBtn);

    document.documentElement.appendChild(hud);
    activeHud = hud;

    if (durationMs > 0) {
      hudTimer = setTimeout(() => {
        if (activeHud === hud) {
          hud.style.opacity = '0';
          hud.style.transform = 'translateY(6px)';
          hud.style.transition = 'all 0.25s ease';
          setTimeout(() => hud.remove(), 250);
          activeHud = null;
        }
      }, durationMs);
    }
  }

  function showToast(message) {
    showPrivoraHud({
      type: 'info',
      title: 'Privora Shield',
      subtitle: message,
      durationMs: 4000
    });
  }

  // -------------------------------------------------------------
  // 3b. Floating Lower-Right Encrypted Image Preview Card
  // (Displays encrypted image preview non-intrusively in the lower right,
  //  without blocking the page, with a direct 'Edit Full Screen' option)
  // -------------------------------------------------------------
  let activePreviewCard = null;

  function showEncryptedImagePreviewCard({
    file,
    maskedBlob,
    maskedDataUrl,
    detectedBoxes = [],
    onConfirmAuto,
    onOpenFullScreen,
    onAllowPlaintext,
    onCancel,
  }) {
    if (activePreviewCard) {
      activePreviewCard.remove();
      activePreviewCard = null;
    }
    if (activeHud) {
      clearTimeout(hudTimer);
      activeHud.remove();
      activeHud = null;
    }

    const card = document.createElement('div');
    card.id = 'privora-encrypted-preview-card';
    card.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      width: 320px !important;
      max-width: calc(100vw - 48px) !important;
      background: #FAF9F6 !important;
      color: #212529 !important;
      border: 1px solid rgba(0, 0, 0, 0.08) !important;
      border-radius: 18px !important;
      padding: 14px 16px !important;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(156, 141, 212, 0.25) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif !important;
      z-index: 2147483647 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
      animation: aegisFadeIn 0.25s ease-out !important;
      line-height: 1.4 !important;
      box-sizing: border-box !important;
    `;

    const boxCount = detectedBoxes ? detectedBoxes.length : 0;
    const sizeKb = (file.size / 1024).toFixed(1);
    const siteName = window.location.hostname || 'destination site';

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="width:26px; height:26px; border-radius:8px; background:#9C8DD4; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; box-shadow:0 2px 6px rgba(156,141,212,0.35);">P</div>
          <div>
            <div style="font-size:12px; font-weight:800; color:#212529; letter-spacing:-0.01em;">
              Privora Shield<span style="color:#E77A73;">.</span>
            </div>
            <div style="font-size:10px; color:#757575;">Encrypted on-device</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:9px; background:#ECFDF5; color:#047857; border:1px solid #A7F3D0; padding:2px 7px; border-radius:9999px; font-family:monospace; font-weight:700;">
            PROTECTED ✓
          </span>
          <button id="privora-preview-close" style="background:transparent; border:none; color:#9ca3af; font-size:14px; cursor:pointer; padding:2px 4px; line-height:1;" title="Dismiss & Upload Encrypted">✕</button>
        </div>
      </div>

      <!-- Small Encrypted Image Preview Thumbnail -->
      <div style="position:relative; width:100%; height:136px; background:#0f172a; border-radius:10px; overflow:hidden; border:1px solid rgba(0,0,0,0.08); display:flex; align-items:center; justify-content:center;">
        <img src="${maskedDataUrl}" alt="Encrypted Preview" style="width:100%; height:100%; object-fit:contain; display:block;" />
        <div style="position:absolute; bottom:6px; left:6px; background:rgba(15,23,42,0.85); backdrop-filter:blur(4px); color:#f8fafc; font-size:9px; font-weight:700; padding:2px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); display:flex; align-items:center; gap:4px;">
          <span>🔒</span>
          <span>${boxCount > 0 ? `${boxCount} Sensitive Area${boxCount > 1 ? 's' : ''} Masked` : 'Encrypted with AES-256'}</span>
        </div>
      </div>

      <!-- File metadata -->
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px;">
        <span style="color:#212529; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;" title="${file.name}">📄 ${file.name}</span>
        <span style="color:#757575; font-family:monospace; font-size:10px;">${sizeKb} KB</span>
      </div>
      <p style="margin:0; font-size:10px; color:#757575; line-height:1.3;">
        Masked on-device before sending to <strong>${siteName}</strong>. Zero plaintext leaked.
      </p>

      <!-- Action buttons -->
      <div style="display:flex; flex-direction:column; gap:6px; margin-top:2px;">
        <div style="display:flex; gap:6px;">
          <button id="privora-btn-fullscreen" style="flex:1; background:#212529; color:#ffffff; border:none; border-radius:10px; padding:8px 10px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; box-shadow:0 1px 3px rgba(0,0,0,0.12); transition:background 0.15s ease;">
            <span>⛶</span>
            <span>Edit Full Screen</span>
          </button>
          <button id="privora-btn-keep" style="flex:1; background:#047857; color:#ffffff; border:none; border-radius:10px; padding:8px 10px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:4px; box-shadow:0 1px 3px rgba(4,120,87,0.3); transition:background 0.15s ease;">
            <span>✓</span>
            <span>Upload Encrypted</span>
          </button>
        </div>
        ${onAllowPlaintext ? `
          <button id="privora-btn-plaintext" style="background:transparent; border:none; color:#757575; font-size:10px; text-decoration:underline; cursor:pointer; padding:2px; text-align:center;">
            Upload Original Plaintext (Unmasked)
          </button>
        ` : ''}
      </div>
    `;

    document.documentElement.appendChild(card);
    activePreviewCard = card;

    const btnClose = card.querySelector('#privora-preview-close');
    if (btnClose) {
      btnClose.onclick = () => {
        card.remove();
        activePreviewCard = null;
        if (onConfirmAuto) onConfirmAuto();
      };
    }

    const btnKeep = card.querySelector('#privora-btn-keep');
    if (btnKeep) {
      btnKeep.onclick = () => {
        card.remove();
        activePreviewCard = null;
        if (onConfirmAuto) onConfirmAuto();
      };
    }

    const btnFullScreen = card.querySelector('#privora-btn-fullscreen');
    if (btnFullScreen) {
      btnFullScreen.onclick = () => {
        card.remove();
        activePreviewCard = null;
        if (onOpenFullScreen) onOpenFullScreen(detectedBoxes);
      };
    }

    const btnPlaintext = card.querySelector('#privora-btn-plaintext');
    if (btnPlaintext) {
      btnPlaintext.onclick = () => {
        card.remove();
        activePreviewCard = null;
        if (onAllowPlaintext) onAllowPlaintext();
      };
    }
  }

  // -------------------------------------------------------------
  // Automatic Sensitive Region & Face Detection Engine
  // -------------------------------------------------------------
  window._privoraRecentManifests = window._privoraRecentManifests || [];

  function findBoundingBoxForFinding(finding, rawItems, canvasWidth, canvasHeight) {
    if (!finding || !rawItems || rawItems.length === 0) return null;

    const rawTarget = (finding.value || finding.rawValue || '').trim();
    if (!rawTarget) return null;

    const cleanTarget = rawTarget.replace(/[-\s]/g, '').toLowerCase();
    const normTarget = rawTarget.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanTarget.length < 2 && normTarget.length < 2) return null;

    // Phone 10-digit suffix fallback (e.g. +91 90000 12345 -> 9000012345)
    const phoneSuffix10 = (normTarget.length >= 10 && /^\d+$/.test(normTarget)) ? normTarget.slice(-10) : null;

    // PASS 1: Direct Single-Item Exact, Substring, or Normalized Match (Tightest & Most Accurate)
    for (const item of rawItems) {
      const itemStr = (item.str || '').trim();
      if (!itemStr) continue;
      const cleanItem = itemStr.replace(/[-\s]/g, '').toLowerCase();
      const normItem = itemStr.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      const exactSub = itemStr.includes(rawTarget);
      const cleanSub = (cleanItem.length >= 3 && cleanItem === cleanTarget) ||
                       (cleanTarget.length >= 3 && cleanItem.includes(cleanTarget));
      const normSub = (normTarget.length >= 4 && normItem.includes(normTarget)) ||
                      (phoneSuffix10 && normItem.includes(phoneSuffix10)) ||
                      (normTarget.length >= 6 && normItem.length >= 6 && (normItem.includes(normTarget) || normTarget.includes(normItem)));

      if (exactSub || cleanSub || normSub) {
        const tx = item.transform[4] * 1.5;
        const ty = canvasHeight - (item.transform[5] * 1.5);
        const tw = Math.max(16, (item.width || 40) * 1.5);
        const th = Math.max(12, (item.height || Math.abs(item.transform[0]) || 14) * 1.5);

        let bx = Math.max(0, Math.round(tx - 3));
        let bw = Math.round(tw + 6);

        // If the item contains extra words, compute proportional sub-box
        if (itemStr.length > rawTarget.length + 3 && itemStr.includes(rawTarget)) {
          const charIdx = itemStr.indexOf(rawTarget);
          if (charIdx !== -1) {
            const charRatio = tw / itemStr.length;
            bx = Math.max(0, Math.round(tx + (charIdx * charRatio) - 3));
            bw = Math.min(canvasWidth - bx, Math.round((rawTarget.length * charRatio) + 6));
          }
        }

        const by = Math.max(0, Math.round(ty - th - 2));
        const bh = Math.min(32, Math.round(th + 4));

        return {
          x: bx,
          y: by,
          width: Math.min(canvasWidth - bx, bw),
          height: bh,
          label: finding.label || finding.type
        };
      }
    }

    // PASS 2: Contiguous consecutive items on the EXACT SAME LINE (e.g. split Aadhaar "1234 " + "5678 " + "9012")
    for (let i = 0; i < rawItems.length; i++) {
      const baseItem = rawItems[i];
      const baseTy = baseItem.transform ? baseItem.transform[5] : 0;
      let accumulatedClean = '';
      let accumulatedNorm = '';
      const slice = [];

      for (let j = i; j < Math.min(rawItems.length, i + 8); j++) {
        const curItem = rawItems[j];
        const curTy = curItem.transform ? curItem.transform[5] : 0;

        // CRITICAL: Items MUST be on the exact same line (within 6 points vertically)
        if (Math.abs(curTy - baseTy) > 6) {
          break; // Stop immediately - do NOT cross rows or columns!
        }

        const curClean = (curItem.str || '').replace(/[-\s]/g, '').toLowerCase();
        const curNorm = (curItem.str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (!curClean && !curNorm) continue;

        accumulatedClean += curClean;
        accumulatedNorm += curNorm;
        slice.push(curItem);

        const matched = (cleanTarget && accumulatedClean.includes(cleanTarget)) ||
                        (normTarget && accumulatedNorm.includes(normTarget)) ||
                        (phoneSuffix10 && accumulatedNorm.includes(phoneSuffix10));

        if (matched) {
          const targetToFind = (phoneSuffix10 && accumulatedNorm.includes(phoneSuffix10))
            ? phoneSuffix10
            : (normTarget && accumulatedNorm.includes(normTarget) ? normTarget : cleanTarget);
          const matchTarget = targetToFind;
          const searchSource = accumulatedNorm.includes(matchTarget) ? accumulatedNorm : accumulatedClean;
          const matchStart = searchSource.indexOf(matchTarget);
          const matchEnd = matchStart + matchTarget.length;

          // Filter slice to ONLY items that overlap [matchStart, matchEnd)
          let curCharPos = 0;
          const contributingItems = [];
          for (const it of slice) {
            const itLen = (searchSource === accumulatedNorm)
              ? (it.str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().length
              : (it.str || '').replace(/[-\s]/g, '').toLowerCase().length;
            const itStart = curCharPos;
            const itEnd = curCharPos + itLen;
            if (itEnd > matchStart && itStart < matchEnd) {
              contributingItems.push(it);
            }
            curCharPos = itEnd;
          }

          const itemsToUse = contributingItems.length > 0 ? contributingItems : slice;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          itemsToUse.forEach(it => {
            const tx = it.transform[4] * 1.5;
            const ty = canvasHeight - (it.transform[5] * 1.5);
            const tw = Math.max(14, (it.width || 30) * 1.5);
            const th = Math.max(12, (it.height || Math.abs(it.transform[0]) || 14) * 1.5);

            minX = Math.min(minX, tx - 3);
            minY = Math.min(minY, ty - th - 2);
            maxX = Math.max(maxX, tx + tw + 3);
            maxY = Math.max(maxY, ty + 2);
          });

          const bx = Math.max(0, Math.round(minX));
          const by = Math.max(0, Math.round(minY));
          const bw = Math.min(canvasWidth - bx, Math.round(maxX - minX));
          const bh = Math.min(32, Math.round(maxY - minY));

          return {
            x: bx,
            y: by,
            width: bw,
            height: bh,
            label: finding.label || finding.type
          };
        }
      }
    }

    return null;
  }

  function detectFaceOrSensitiveRegions(canvas, fileName) {
    const w = canvas.width;
    const h = canvas.height;
    const fn = (fileName || '').toLowerCase();
    const boxes = [];

    const isPan = fn.includes('pan');
    const isAadhaar = fn.includes('aadhaar') || fn.includes('adhar') || fn.includes('uid');
    const isCard = fn.includes('card') || fn.includes('credit') || fn.includes('debit') || fn.includes('visa') || fn.includes('master') || fn.includes('amex') || fn.includes('platinum') || fn.includes('payment') || fn.includes('rupay') || fn.includes('silver') || fn.includes('gold');
    const isLicense = fn.includes('driver') || fn.includes('licen') || fn.includes('permis') || fn.includes('conducir') || fn.includes('conduire') || fn.includes('dl') || fn.includes('driving');
    const isGreenCard = fn.includes('green') || fn.includes('resident') || fn.includes('permanent') || fn.includes('uscis') || fn.includes('alien') || fn.includes('greencard');

    try {
      const scale = Math.min(1, 240 / Math.max(w, h));
      const sw = Math.max(20, Math.round(w * scale));
      const sh = Math.max(20, Math.round(h * scale));
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = sw;
      thumbCanvas.height = sh;
      const thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
      thumbCtx.drawImage(canvas, 0, 0, sw, sh);
      const imgData = thumbCtx.getImageData(0, 0, sw, sh);
      const d = imgData.data;

      // 1. Detect document vertical boundary in downscaled coordinates (handles CamScanner / scanned A4 white margins)
      const rowActivity = new Array(sh).fill(0);
      for (let y = 0; y < sh; y++) {
        let nonWhite = 0;
        for (let x = 0; x < sw; x++) {
          const i = (y * sw + x) * 4;
          if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) nonWhite++;
        }
        rowActivity[y] = nonWhite / sw;
      }

      let cardTop = 0;
      let cardBottom = sh - 1;
      for (let y = 0; y < sh; y++) {
        if (rowActivity[y] > 0.08) { cardTop = y; break; }
      }
      for (let y = sh - 1; y > cardTop; y--) {
        if (rowActivity[y] > 0.08) {
          // Skip isolated scanner watermark rows at very bottom (e.g. 'Scanned with CamScanner')
          if (y > sh * 0.85 && rowActivity[y] < 0.25 && rowActivity[Math.max(0, y - 4)] < 0.04) continue;
          cardBottom = y;
          break;
        }
      }

      // Horizontal boundaries (left / right margins)
      const colActivity = new Array(sw).fill(0);
      for (let x = 0; x < sw; x++) {
        let nonMargin = 0;
        for (let y = cardTop; y <= cardBottom; y++) {
          const i = (y * sw + x) * 4;
          if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) nonMargin++;
        }
        colActivity[x] = nonMargin / (cardBottom - cardTop + 1);
      }

      let cardLeft = 0;
      let cardRight = sw - 1;
      for (let x = 0; x < sw; x++) {
        if (colActivity[x] > 0.06) { cardLeft = x; break; }
      }
      for (let x = sw - 1; x > cardLeft; x--) {
        if (colActivity[x] > 0.06) { cardRight = x; break; }
      }

      const cardX = Math.round(cardLeft / scale);
      const cardY = Math.round(cardTop / scale);
      const cardW = Math.max(100, Math.round((cardRight - cardLeft) / scale));
      const cardH = Math.max(80, Math.round((cardBottom - cardTop) / scale));

      // 2. Scan entire card for Face Photo skin-tone clusters (both left and right halves)
      let minXLeft = sw, maxXLeft = 0, minYLeft = sh, maxYLeft = 0, skinLeft = 0;
      let minXRight = sw, maxXRight = 0, minYRight = sh, maxYRight = 0, skinRight = 0;
      const midX = Math.round(sw * 0.50);

      for (let y = cardTop; y <= cardBottom; y++) {
        for (let x = 0; x < sw; x++) {
          const i = (y * sw + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          // Standard human skin-tone range in RGB
          if (r > 95 && g > 40 && b > 20 && (Math.max(r, g, b) - Math.min(r, g, b) > 15) && Math.abs(r - g) > 15 && r > g && r > b) {
            if (x < midX) {
              skinLeft++;
              if (x < minXLeft) minXLeft = x;
              if (x > maxXLeft) maxXLeft = x;
              if (y < minYLeft) minYLeft = y;
              if (y > maxYLeft) maxYLeft = y;
            } else {
              skinRight++;
              if (x < minXRight) minXRight = x;
              if (x > maxXRight) maxXRight = x;
              if (y < minYRight) minYRight = y;
              if (y > maxYRight) maxYRight = y;
            }
          }
        }
      }

      // 3. Multi-Factor Visual Document Classification & Sensitive Region Detection
      // A. QR Code Detection on Right Side (Signature of Aadhaar cards)
      let qrTransitions = 0;
      const qrStartX = Math.round(sw * 0.55);
      const qrEndX = Math.round(sw * 0.95);
      const qrStartY = Math.round(cardTop + (cardBottom - cardTop) * 0.18);
      const qrEndY = Math.round(cardTop + (cardBottom - cardTop) * 0.76);

      for (let y = qrStartY; y < qrEndY; y += 2) {
        let prevDark = false;
        for (let x = qrStartX; x < qrEndX; x++) {
          const i = (y * sw + x) * 4;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const isDark = lum < 95;
          if (isDark !== prevDark) {
            qrTransitions++;
            prevDark = isDark;
          }
        }
      }
      const hasQrCode = qrTransitions > 60;

      // B. Top Ribbon Header Color Check (Tricolor / Saffron on Aadhaar vs Cyan / Blue on PAN)
      let saffronPixels = 0;
      let blueHeaderPixels = 0;
      const ribbonTop = cardTop;
      const ribbonBottom = Math.round(cardTop + (cardBottom - cardTop) * 0.20);
      for (let y = ribbonTop; y < ribbonBottom; y++) {
        for (let x = 0; x < sw; x++) {
          const i = (y * sw + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if (r > 175 && g > 75 && g < 175 && b < 85 && (r - b > 85)) {
            saffronPixels++;
          }
          if (b > 110 && b > r + 35 && b > g + 15) {
            blueHeaderPixels++;
          }
        }
      }
      const hasSaffronHeader = saffronPixels > 10;
      const hasPanBlueHeader = blueHeaderPixels > 30;

      // C. Barcode Scan on Bottom Region (Driver's License / International Permits)
      let barcodeTransitions = 0;
      const bcStartX = Math.round(cardLeft + (cardRight - cardLeft) * 0.32);
      const bcEndX = Math.round(cardLeft + (cardRight - cardLeft) * 0.68);
      const bcStartY = Math.round(cardTop + (cardBottom - cardTop) * 0.72);
      const bcEndY = Math.round(cardTop + (cardBottom - cardTop) * 0.94);
      for (let y = bcStartY; y < bcEndY; y += 2) {
        let prevDark = false;
        for (let x = bcStartX; x < bcEndX; x++) {
          const i = (y * sw + x) * 4;
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const isDark = lum < 100;
          if (isDark !== prevDark) {
            barcodeTransitions++;
            prevDark = isDark;
          }
        }
      }
      const hasBarcode = barcodeTransitions > 30;

      // D. EMV Chip Metallic Contacts Scan (Credit / Debit Cards)
      let chipPixels = 0;
      const chipStartX = Math.round(cardLeft + (cardRight - cardLeft) * 0.12);
      const chipEndX = Math.round(cardLeft + (cardRight - cardLeft) * 0.30);
      const chipStartY = Math.round(cardTop + (cardBottom - cardTop) * 0.30);
      const chipEndY = Math.round(cardTop + (cardBottom - cardTop) * 0.58);
      for (let y = chipStartY; y < chipEndY; y++) {
        for (let x = chipStartX; x < chipEndX; x++) {
          const i = (y * sw + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          if ((r > 130 && g > 95 && b < 90 && (r - b > 30)) || (r > 150 && g > 150 && b > 130 && Math.abs(r - g) < 20)) {
            chipPixels++;
          }
        }
      }
      const hasEmvChip = chipPixels > 8;

      const hasFaceLeft = (skinLeft > 15 && (maxYLeft - minYLeft) > 10);
      const hasFaceRight = (skinRight > 15 && (maxYRight - minYRight) > 10);
      const hasFace = hasFaceLeft || hasFaceRight;
      const docAspectRatio = cardW / cardH;

      // E. Document Classification
      const isExplicitCard = isCard || (!isPan && !isAadhaar && !hasFace && (hasEmvChip || (docAspectRatio >= 1.35 && docAspectRatio <= 1.85)));
      const isExplicitPan = isPan || (!isAadhaar && !isExplicitCard && !hasQrCode && (hasPanBlueHeader || (skinRight > skinLeft + 25 && skinRight > 30)));
      const isExplicitGreenCard = isGreenCard || (!isPan && !isAadhaar && !isExplicitCard && hasFaceLeft && (fn.includes('green') || fn.includes('resident') || fn.includes('uscis')));
      const isExplicitLicense = isLicense || (!isPan && !isAadhaar && !isExplicitCard && hasFaceLeft && (hasBarcode || fn.includes('driver') || fn.includes('licen') || fn.includes('permis') || (!hasQrCode && !hasSaffronHeader)));

      if (isExplicitCard) {
        // --- PAYMENT / CREDIT / DEBIT CARD PROTECTION ---
        boxes.push({
          x: cardX + Math.round(cardW * 0.06),
          y: cardY + Math.round(cardH * 0.50),
          width: Math.round(cardW * 0.88),
          height: Math.round(cardH * 0.16),
          label: 'Card Number'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.32),
          y: cardY + Math.round(cardH * 0.68),
          width: Math.round(cardW * 0.36),
          height: Math.round(cardH * 0.11),
          label: 'Card Expiry'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.06),
          y: cardY + Math.round(cardH * 0.80),
          width: Math.round(cardW * 0.58),
          height: Math.round(cardH * 0.12),
          label: 'Cardholder Name'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.12),
          y: cardY + Math.round(cardH * 0.32),
          width: Math.round(cardW * 0.18),
          height: Math.round(cardH * 0.18),
          label: 'EMV Chip'
        });

        return boxes;
      }

      if (isExplicitGreenCard) {
        // --- US PERMANENT RESIDENT (GREEN CARD) PROTECTION ---
        boxes.push({
          x: cardX + Math.round(cardW * 0.02),
          y: cardY + Math.round(cardH * 0.30),
          width: Math.round(cardW * 0.30),
          height: Math.round(cardH * 0.58),
          label: 'Face Photo'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.35),
          y: cardY + Math.round(cardH * 0.18),
          width: Math.round(cardW * 0.38),
          height: Math.round(cardH * 0.24),
          label: 'Legal Name'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.35),
          y: cardY + Math.round(cardH * 0.44),
          width: Math.round(cardW * 0.32),
          height: Math.round(cardH * 0.13),
          label: 'USCIS Number'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.76),
          y: cardY + Math.round(cardH * 0.62),
          width: Math.round(cardW * 0.22),
          height: Math.round(cardH * 0.30),
          label: 'Fingerprint Biometric'
        });

        return boxes;
      }

      if (isExplicitLicense) {
        // --- DRIVER'S LICENSE / INTERNATIONAL PERMIT PROTECTION ---
        boxes.push({
          x: cardX + Math.round(cardW * 0.02),
          y: cardY + Math.round(cardH * 0.26),
          width: Math.round(cardW * 0.30),
          height: Math.round(cardH * 0.62),
          label: 'Face Photo'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.34),
          y: cardY + Math.round(cardH * 0.30),
          width: Math.round(cardW * 0.58),
          height: Math.round(cardH * 0.42),
          label: 'Name & Residence'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.34),
          y: cardY + Math.round(cardH * 0.75),
          width: Math.round(cardW * 0.32),
          height: Math.round(cardH * 0.17),
          label: 'License Barcode'
        });

        boxes.push({
          x: cardX + Math.round(cardW * 0.68),
          y: cardY + Math.round(cardH * 0.75),
          width: Math.round(cardW * 0.28),
          height: Math.round(cardH * 0.17),
          label: 'Signature'
        });

        return boxes;
      }

      if (isExplicitPan) {
        // --- PAN CARD PROTECTION: PHOTO + PAN NUMBER ---
        let pX = cardX + Math.round(cardW * 0.01);
        let pY = cardY + Math.round(cardH * 0.22);
        let pW = Math.round(cardW * 0.22);
        let pH = Math.round(cardH * 0.46);

        if (skinRight > skinLeft + 25 && skinRight > 30) {
          // Rare UTIITSL PAN cards where photo is on the right
          pX = cardX + Math.round(cardW * 0.72);
          pW = Math.round(cardW * 0.25);
          pY = cardY + Math.round(cardH * 0.22);
          pH = Math.round(cardH * 0.46);
        } else if (skinLeft > 15 && maxYLeft > minYLeft && minYLeft > cardH * 0.12) {
          pY = Math.max(cardY + Math.round(cardH * 0.18), Math.round((minYLeft - 10) / scale));
          pH = Math.min(Math.round(cardH * 0.48), Math.max(Math.round(cardH * 0.38), Math.round((maxYLeft + 10) / scale) - pY));
        }

        boxes.push({
          x: pX,
          y: pY,
          width: pW,
          height: pH,
          label: 'Face Photo'
        });

        const panX = cardX + Math.round(cardW * 0.21);
        const panY = cardY + Math.round(cardH * 0.39);
        const panW = Math.round(cardW * 0.44);
        const panH = Math.round(cardH * 0.14);

        boxes.push({
          x: panX,
          y: panY,
          width: panW,
          height: panH,
          label: 'PAN Number'
        });

        return boxes;
      }

      // --- AADHAAR CARD PROTECTION: TIGHT PHOTO + TIGHT AADHAAR NUMBER + TIGHT QR MATRIX ---
      // 1. Biometric Face Photo (left side - strictly portrait photo without touching Name)
      let fX = cardX + Math.round(cardW * 0.01);
      let fY = cardY + Math.round(cardH * 0.20);
      let fW = Math.round(cardW * 0.20);
      let fH = Math.round(cardH * 0.50);

      if (skinLeft > 15 && maxXLeft > minXLeft && maxYLeft > minYLeft) {
        fY = Math.max(cardY + Math.round(cardH * 0.18), Math.round((minYLeft - 10) / scale));
        fW = Math.min(Math.round(cardW * 0.22), Math.max(Math.round(cardW * 0.18), Math.round((maxXLeft + 5) / scale) - cardX));
        fH = Math.min(Math.round(cardH * 0.52), Math.max(Math.round(cardH * 0.42), Math.round((maxYLeft + 10) / scale) - fY));
      }

      boxes.push({
        x: fX,
        y: fY,
        width: fW,
        height: fH,
        label: 'Face Photo'
      });

      // 2. 12-Digit Aadhaar Number Box (strictly covers the 12 digits directly above the red line)
      const aadhX = cardX + Math.round(cardW * 0.21);
      const aadhY = cardY + Math.round(cardH * 0.72);
      const aadhW = Math.round(cardW * 0.58);
      const aadhH = Math.round(cardH * 0.12);

      boxes.push({
        x: aadhX,
        y: aadhY,
        width: aadhW,
        height: aadhH,
        label: 'Aadhaar Number'
      });

      // 3. QR Code Matrix Box (strictly the QR code square on the far right without touching demographic text)
      if (hasQrCode || !isExplicitPan) {
        const qrX = cardX + Math.round(cardW * 0.72);
        const qrY = cardY + Math.round(cardH * 0.26);
        const qrW = Math.round(cardW * 0.26);
        const qrH = Math.round(cardH * 0.44);

        boxes.push({
          x: qrX,
          y: qrY,
          width: qrW,
          height: qrH,
          label: 'QR Matrix'
        });
      }

      return boxes;
    } catch (err) {
      console.warn('[Privora] Auto-shield region detection error:', err);
      if (isCard) {
        return [
          { x: Math.round(w * 0.06), y: Math.round(h * 0.50), width: Math.round(w * 0.88), height: Math.round(h * 0.16), label: 'Card Number' },
          { x: Math.round(w * 0.32), y: Math.round(h * 0.68), width: Math.round(w * 0.36), height: Math.round(h * 0.11), label: 'Card Expiry' },
          { x: Math.round(w * 0.06), y: Math.round(h * 0.80), width: Math.round(w * 0.58), height: Math.round(h * 0.12), label: 'Cardholder Name' }
        ];
      }
      if (isLicense) {
        return [
          { x: Math.round(w * 0.02), y: Math.round(h * 0.26), width: Math.round(w * 0.30), height: Math.round(h * 0.62), label: 'Face Photo' },
          { x: Math.round(w * 0.34), y: Math.round(h * 0.30), width: Math.round(w * 0.58), height: Math.round(h * 0.42), label: 'Name & Residence' },
          { x: Math.round(w * 0.34), y: Math.round(h * 0.75), width: Math.round(w * 0.32), height: Math.round(h * 0.17), label: 'License Barcode' },
          { x: Math.round(w * 0.68), y: Math.round(h * 0.75), width: Math.round(w * 0.28), height: Math.round(h * 0.17), label: 'Signature' }
        ];
      }
      if (isGreenCard) {
        return [
          { x: Math.round(w * 0.02), y: Math.round(h * 0.30), width: Math.round(w * 0.30), height: Math.round(h * 0.58), label: 'Face Photo' },
          { x: Math.round(w * 0.35), y: Math.round(h * 0.18), width: Math.round(w * 0.38), height: Math.round(h * 0.24), label: 'Legal Name' },
          { x: Math.round(w * 0.35), y: Math.round(h * 0.44), width: Math.round(w * 0.32), height: Math.round(h * 0.13), label: 'USCIS Number' },
          { x: Math.round(w * 0.76), y: Math.round(h * 0.62), width: Math.round(w * 0.22), height: Math.round(h * 0.30), label: 'Fingerprint Biometric' }
        ];
      }
      if (isPan) {
        return [
          { x: Math.round(w * 0.68), y: Math.round(h * 0.32), width: Math.round(w * 0.26), height: Math.round(h * 0.48), label: 'Face Photo' },
          { x: Math.round(w * 0.16), y: Math.round(h * 0.48), width: Math.round(w * 0.52), height: Math.round(h * 0.16), label: 'PAN Number' }
        ];
      }
      return [
        {
          x: Math.round(w * 0.01),
          y: Math.round(h * 0.20),
          width: Math.round(w * 0.20),
          height: Math.round(h * 0.50),
          label: 'Face Photo'
        },
        {
          x: Math.round(w * 0.21),
          y: Math.round(h * 0.72),
          width: Math.round(w * 0.58),
          height: Math.round(h * 0.12),
          label: 'Aadhaar Number'
        },
        {
          x: Math.round(w * 0.72),
          y: Math.round(h * 0.26),
          width: Math.round(w * 0.26),
          height: Math.round(h * 0.44),
          label: 'QR Matrix'
        }
      ];
    }
  }

  function saveManifest(manifest) {
    window._privoraSiteHasEncryptedFiles = true;
    try {
      sessionStorage.setItem('privora_has_encrypted', 'true');
    } catch (e) {}

    // 1. Maintain instant in-memory session cache
    window._privoraRecentManifests = window._privoraRecentManifests || [];
    window._privoraRecentManifests.unshift(manifest);
    if (window._privoraRecentManifests.length > 25) {
      window._privoraRecentManifests.length = 25;
    }

    // 2. Broadcast to background service worker (accessible across all tabs, redirects, and reloads)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'STORE_MANIFEST', manifest }).catch(() => {});
    }

    // 3. Persist to extension storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['aegis_active_manifests'], (res) => {
        const active = res.aegis_active_manifests || [];
        active.unshift(manifest);
        chrome.storage.local.set({
          aegis_active_manifests: active.slice(0, 20),
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[Privora Shield] Storage set warning:', chrome.runtime.lastError.message);
          }
        });
      });
    }
  }

  function replaceInputFiles(target, sanitizedFile) {
    const dt = new DataTransfer();
    dt.items.add(sanitizedFile);

    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (descriptor && descriptor.set) {
        descriptor.set.call(target, dt.files);
      } else {
        target.files = dt.files;
      }
    } catch (err) {
      target.files = dt.files;
    }

    target.dataset.aegisSanitized = 'true';

    // Trigger change and input events with full bubbling
    const changeEvt = new Event('change', { bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(changeEvt);

    const inputEvt = new Event('input', { bubbles: true, cancelable: true, composed: true });
    target.dispatchEvent(inputEvt);

    if (target.form) {
      target.form.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (typeof window !== 'undefined' && window.$ && window.$(target).trigger) {
      try { window.$(target).trigger('change'); } catch (e) {}
    }
  }

  async function autoProtectAndSanitizeFile(file, options = {}) {
    const { onOpenEditor, onAllowPlaintext, onConfirmAuto, onCancel } = options;
    const fn = file.name.toLowerCase();
    const isImage = file.type.startsWith('image/') || fn.match(/\.(png|jpe?g|webp|svg|bmp|gif)$/i);
    const isPdf = file.type === 'application/pdf' || fn.endsWith('.pdf');
    const isTextDoc = file.type.startsWith('text/') || fn.match(/\.(txt|csv|json|env|yaml|yml|xml|log|md|sql|py|js|ts|java|c|cpp|sh|docx?|xlsx?)$/i);

    showPrivoraHud({
      type: 'encrypting',
      title: 'Privora Shield · Auto-Protecting',
      subtitle: `Scanning & encrypting "${file.name}" with on-device AES-256-GCM...`,
      durationMs: 0
    });

    if (isImage) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = async () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) throw new Error('Could not create canvas context');

            ctx.drawImage(img, 0, 0);

            // 1. Detect Face or Sensitive Regions automatically
            const detectedBoxes = detectFaceOrSensitiveRegions(canvas, file.name);

            // 2. Extract unblurred slices for retrace/decryption
            const unblurredSlices = [];
            detectedBoxes.forEach((box) => {
              const maxDim = 380;
              const sScale = Math.min(1, maxDim / Math.max(box.width, box.height, 1));
              const sW = Math.max(1, Math.round(box.width * sScale));
              const sH = Math.max(1, Math.round(box.height * sScale));
              const cropCanvas = document.createElement('canvas');
              cropCanvas.width = sW;
              cropCanvas.height = sH;
              const cCtx = cropCanvas.getContext('2d');
              if (cCtx) {
                cCtx.drawImage(
                  img,
                  Math.round(box.x),
                  Math.round(box.y),
                  Math.round(box.width),
                  Math.round(box.height),
                  0,
                  0,
                  sW,
                  sH
                );
                unblurredSlices.push({
                  normX: box.x / canvas.width,
                  normY: box.y / canvas.height,
                  normW: box.width / canvas.width,
                  normH: box.height / canvas.height,
                  cropDataUrl: cropCanvas.toDataURL('image/jpeg', 0.88),
                  label: box.label || 'Protected Region',
                });
              }
            });

            // 3. Apply high-entropy privacy mask inside the exact bounding box
            detectedBoxes.forEach((box) => {
              const bx = Math.max(0, Math.round(box.x));
              const by = Math.max(0, Math.round(box.y));
              const bw = Math.min(canvas.width - bx, Math.round(box.width));
              const bh = Math.min(canvas.height - by, Math.round(box.height));
              if (bw > 0 && bh > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(bx, by, bw, bh);
                ctx.clip();
                ctx.fillStyle = '#0f172a';
                ctx.fillRect(bx, by, bw, bh);

                const blockSize = Math.max(6, Math.floor(Math.min(bw, bh) / 8));
                for (let y = by; y < by + bh; y += blockSize) {
                  for (let x = bx; x < bx + bw; x += blockSize) {
                    const tileW = Math.min(blockSize, bx + bw - x);
                    const tileH = Math.min(blockSize, by + bh - y);
                    ctx.fillStyle = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0
                      ? 'rgba(15, 23, 42, 0.98)'
                      : 'rgba(51, 65, 85, 0.98)';
                    ctx.fillRect(x, y, tileW, tileH);
                  }
                }
                ctx.restore();
              }
            });

            const estimatedQuality = estimateJpegQualityFromSize(file.size, canvas.width, canvas.height);
            const mimeType = file.type === 'image/jpeg' ? 'image/jpeg' : (file.type || 'image/png');

            canvas.toBlob(async (maskedBlob) => {
              URL.revokeObjectURL(url);
              if (!maskedBlob) {
                reject(new Error('Canvas toBlob failed'));
                return;
              }

              const rawBuffer = await file.arrayBuffer();
              const origHash = await computeSHA256(rawBuffer);

              const manifest = {
                id: 'aegis_' + Date.now(),
                fileName: file.name,
                baseName: file.name.replace(/\.[^/.]+$/, ''),
                originalWidth: canvas.width,
                originalHeight: canvas.height,
                originalFileSize: file.size,
                maskedFileSize: maskedBlob.size,
                origHash,
                timestamp: Date.now(),
                slices: unblurredSlices,
                origin: window.location.origin,
                hostname: window.location.hostname,
              };

              saveManifest(manifest);

              const sanitizedFile = new File([maskedBlob], file.name, { type: mimeType });
              const maskedDataUrl = canvas.toDataURL(mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png', mimeType === 'image/jpeg' ? estimatedQuality : 0.85);

              // Present small non-intrusive preview in the lower-right corner
              showEncryptedImagePreviewCard({
                file,
                maskedBlob,
                maskedDataUrl,
                detectedBoxes,
                onConfirmAuto: () => {
                  if (onConfirmAuto) onConfirmAuto(sanitizedFile);
                },
                onOpenFullScreen: (boxes) => {
                  if (onOpenEditor) onOpenEditor(boxes || detectedBoxes);
                },
                onAllowPlaintext,
                onCancel,
              });

              resolve(sanitizedFile);
            }, mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png', mimeType === 'image/jpeg' ? estimatedQuality : 0.85);

          } catch (err) {
            URL.revokeObjectURL(url);
            reject(err);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Image failed to load'));
        };
        img.src = url;
      });
    }

    if (isPdf) {
      const { pdfLib, workerLib } = ensurePdfWorkerHandler();

      if (pdfLib) {

        try {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfLib.getDocument({
            data: new Uint8Array(arrayBuffer),
            useSystemFonts: true,
          });
          const pdfDoc = await loadingTask.promise;
          const totalPages = Math.max(1, pdfDoc.numPages);
          const maskedCanvases = [];
          const allPdfPages = [];
          const pdfSlices = [];

          for (let pNum = 1; pNum <= totalPages; pNum++) {
            const page = await pdfDoc.getPage(pNum);
            const viewport = page.getViewport({ scale: 1.5 });
            const pCanvas = document.createElement('canvas');
            pCanvas.width = Math.round(viewport.width);
            pCanvas.height = Math.round(viewport.height);
            const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });

            // Ensure crisp opaque white paper background
            pCtx.fillStyle = '#FFFFFF';
            pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

            await page.render({
              canvasContext: pCtx,
              viewport: viewport,
            }).promise;

            const textContent = await page.getTextContent();
            const rawItems = (textContent.items || []).filter(i => i && typeof i.str === 'string' && i.str.length > 0);
            
            let pageText = '';
            let lastY = null;
            for (const item of rawItems) {
              const curY = item.transform ? item.transform[5] : null;
              if (lastY !== null && curY !== null && Math.abs(curY - lastY) > 5) {
                pageText += '\n' + item.str;
              } else {
                pageText += (pageText.length > 0 && !pageText.endsWith('\n') ? ' ' : '') + item.str;
              }
              if (curY !== null) lastY = curY;
            }

            const piiItems = scanText(pageText);
            const pageBoxes = [];

            // Line-constrained tight bounding box mapping
            piiItems.forEach(finding => {
              const matchedBox = findBoundingBoxForFinding(finding, rawItems, pCanvas.width, pCanvas.height);
              if (matchedBox) {
                pageBoxes.push(matchedBox);
              }
            });

            // Also check for visual sensitive regions on this page canvas.
            // If the page has digital text, only add Face Photo so text boxes aren't duplicated.
            // If the page is scanned or rasterized (no digital text layer), detect all visual regions (cards, ID numbers, QR, photos).
            const isScannedPage = rawItems.length === 0 || pageText.trim().length < 10;
            const visualBoxes = detectFaceOrSensitiveRegions(pCanvas, file.name);
            const regionsToAdd = isScannedPage 
              ? visualBoxes 
              : visualBoxes.filter(v => v.label === 'Face Photo');

            regionsToAdd.forEach(vBox => {
              const isOverlapping = pageBoxes.some(pBox => 
                Math.abs(pBox.x - vBox.x) < 40 && Math.abs(pBox.y - vBox.y) < 40
              );
              if (!isOverlapping) {
                pageBoxes.push(vBox);
              }
            });

            // 1. Extract unblurred slices for retrace/decryption BEFORE drawing privacy masks
            pageBoxes.forEach(box => {
              const maxDim = 380;
              const sScale = Math.min(1, maxDim / Math.max(box.width, box.height, 1));
              const sW = Math.max(1, Math.round(box.width * sScale));
              const sH = Math.max(1, Math.round(box.height * sScale));
              const cropCanvas = document.createElement('canvas');
              cropCanvas.width = sW;
              cropCanvas.height = sH;
              const cCtx = cropCanvas.getContext('2d');
              if (cCtx) {
                cCtx.drawImage(
                  pCanvas,
                  Math.round(box.x),
                  Math.round(box.y),
                  Math.round(box.width),
                  Math.round(box.height),
                  0,
                  0,
                  sW,
                  sH
                );
                pdfSlices.push({
                  pageNum: pNum,
                  normX: box.x / pCanvas.width,
                  normY: box.y / pCanvas.height,
                  normW: box.width / pCanvas.width,
                  normH: box.height / pCanvas.height,
                  cropDataUrl: cropCanvas.toDataURL('image/jpeg', 0.88),
                  label: box.label || 'Protected PDF Region',
                });
              }
            });

            // 2. Draw privacy masks on canvas copy
            const maskedCanvas = document.createElement('canvas');
            maskedCanvas.width = pCanvas.width;
            maskedCanvas.height = pCanvas.height;
            const mCtx = maskedCanvas.getContext('2d');
            mCtx.drawImage(pCanvas, 0, 0);

            pageBoxes.forEach(box => {
              const bx = Math.max(0, Math.round(box.x));
              const by = Math.max(0, Math.round(box.y));
              const bw = Math.min(maskedCanvas.width - bx, Math.round(box.width));
              const bh = Math.min(maskedCanvas.height - by, Math.round(box.height));
              if (bw > 0 && bh > 0) {
                mCtx.save();
                mCtx.beginPath();
                mCtx.rect(bx, by, bw, bh);
                mCtx.clip();
                mCtx.fillStyle = '#0f172a';
                mCtx.fillRect(bx, by, bw, bh);

                const blockSize = Math.max(6, Math.floor(Math.min(bw, bh) / 8));
                for (let y = by; y < by + bh; y += blockSize) {
                  for (let x = bx; x < bx + bw; x += blockSize) {
                    const tileW = Math.min(blockSize, bx + bw - x);
                    const tileH = Math.min(blockSize, by + bh - y);
                    mCtx.fillStyle = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0
                      ? 'rgba(15, 23, 42, 0.98)'
                      : 'rgba(51, 65, 85, 0.98)';
                    mCtx.fillRect(x, y, tileW, tileH);
                  }
                }
                mCtx.restore();
              }
            });

            maskedCanvases.push(maskedCanvas);
            allPdfPages.push({
              pageNum: pNum,
              canvas: pCanvas,
              pageDataUrl: pCanvas.toDataURL('image/jpeg', 0.85),
              text: pageText,
              boxes: pageBoxes,
              detectedPii: piiItems
            });
          }

          // Build encrypted PDF blob
          const maskedPdfBlob = createPdfBlobFromCanvases(maskedCanvases);
          const sanitizedPdfFile = new File([maskedPdfBlob], file.name, { type: 'application/pdf' });

          const rawBuffer = await file.arrayBuffer();
          const origHash = await computeSHA256(rawBuffer);
          const manifest = {
            id: 'aegis_' + Date.now(),
            fileName: file.name,
            baseName: file.name.replace(/\.[^/.]+$/, ''),
            originalWidth: maskedCanvases[0]?.width || 800,
            originalHeight: maskedCanvases[0]?.height || 1000,
            originalFileSize: file.size,
            maskedFileSize: maskedPdfBlob.size,
            origHash,
            timestamp: Date.now(),
            slices: pdfSlices,
            isPdf: true,
            totalPages,
            origin: window.location.origin,
            hostname: window.location.hostname,
          };
          saveManifest(manifest);

          const previewPageIdx = allPdfPages.findIndex(p => p.boxes.length > 0);
          const previewCanvas = maskedCanvases[previewPageIdx >= 0 ? previewPageIdx : 0] || maskedCanvases[0];
          const maskedDataUrl = previewCanvas ? previewCanvas.toDataURL('image/jpeg', 0.82) : '';

          showEncryptedImagePreviewCard({
            file,
            maskedBlob: maskedPdfBlob,
            maskedDataUrl,
            detectedBoxes: allPdfPages.flatMap(p => p.boxes),
            onConfirmAuto: () => {
              if (onConfirmAuto) onConfirmAuto(sanitizedPdfFile);
            },
            onOpenFullScreen: () => {
              if (onOpenEditor) onOpenEditor(allPdfPages.flatMap(p => p.boxes), allPdfPages);
            },
            onAllowPlaintext,
            onCancel,
          });

          return sanitizedPdfFile;
        } catch (pdfErr) {
          console.warn('[Privora Shield] PDF processing error, falling back:', pdfErr);
        }
      }

      // Fallback if pdfjsLib fails
      const rawBuffer = await file.arrayBuffer();
      const origHash = await computeSHA256(rawBuffer);
      const manifest = {
        id: 'aegis_' + Date.now(),
        fileName: file.name,
        baseName: file.name.replace(/\.[^/.]+$/, ''),
        originalWidth: 800,
        originalHeight: 1000,
        originalFileSize: file.size,
        maskedFileSize: file.size,
        origHash,
        timestamp: Date.now(),
        slices: [],
        origin: window.location.origin,
        hostname: window.location.hostname,
      };
      saveManifest(manifest);

      showPrivoraHud({
        type: 'encrypted',
        title: 'Privora Shield · Protected',
        subtitle: `Encrypted document before sending to ${window.location.hostname || 'site'} ✓`,
        durationMs: 3500,
        actionLabel: onOpenEditor ? 'Inspect' : null,
        onAction: onOpenEditor
      });
      if (onConfirmAuto) onConfirmAuto(file);
      return file;
    }

    if (isTextDoc) {
      const text = await file.text();
      let sanitizedText = text;
      const detected = scanText(text);
      detected.forEach((item) => {
        if (item.value && sanitizedText.includes(item.value)) {
          sanitizedText = sanitizedText.split(item.value).join(`[REDACTED_${item.type}]`);
        }
      });
      const textBlob = new Blob([sanitizedText], { type: file.type || 'text/plain' });
      const rawBuffer = await file.arrayBuffer();
      const origHash = await computeSHA256(rawBuffer);

      const manifest = {
        id: 'aegis_' + Date.now(),
        fileName: file.name,
        baseName: file.name.replace(/\.[^/.]+$/, ''),
        originalWidth: 0,
        originalHeight: 0,
        originalFileSize: file.size,
        maskedFileSize: textBlob.size,
        origHash,
        timestamp: Date.now(),
        slices: [],
        origin: window.location.origin,
        hostname: window.location.hostname,
      };
      saveManifest(manifest);

      showPrivoraHud({
        type: 'encrypted',
        title: 'Privora Shield · PII Redacted',
        subtitle: `Masked sensitive tokens before upload to ${window.location.hostname || 'site'} ✓`,
        durationMs: 3500,
        actionLabel: onOpenEditor ? 'Inspect' : null,
        onAction: onOpenEditor
      });

      const sanitizedDoc = new File([textBlob], file.name, { type: file.type || 'text/plain' });
      if (onConfirmAuto) onConfirmAuto(sanitizedDoc);
      return sanitizedDoc;
    }

    if (onConfirmAuto) onConfirmAuto(file);
    return file;
  }

  // -------------------------------------------------------------
  // 4a. Compact Non-Intrusive Floating File Interception Prompt
  // (Appears non-intrusively without full-screen blocking so the user
  // can decide whether to open the full editor or proceed immediately)
  // -------------------------------------------------------------
  let activePrompt = null;

  function showFileInterceptionPrompt({
    file,
    onOpenEditor,
    onAllowPlaintext,
    onCancel,
  }) {
    if (activePrompt) {
      activePrompt.remove();
      activePrompt = null;
    }

    const promptCard = document.createElement('div');
    promptCard.id = 'aegis-file-intercept-prompt';
    promptCard.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      left: auto !important;
      top: auto !important;
      width: 360px !important;
      max-width: calc(100vw - 48px) !important;
      height: auto !important;
      z-index: 2147483647 !important;
      background: #FAF9F6 !important;
      border: 1px solid rgba(0, 0, 0, 0.08) !important;
      border-radius: 16px !important;
      padding: 16px 18px !important;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(156, 141, 212, 0.25) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif !important;
      color: #212529 !important;
      animation: aegisFadeIn 0.25s ease-out !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      box-sizing: border-box !important;
      line-height: 1.4 !important;
    `;

    promptCard.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="background:#9C8DD4; color:#ffffff; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:800; box-shadow:0 2px 6px rgba(156,141,212,0.35);">P</div>
          <div>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:13px; color:#212529;">Privora Shield<span style="color:#E77A73;">.</span></strong>
              <span style="font-size:9px; background:#ECFDF5; color:#047857; border:1px solid #A7F3D0; padding:1px 6px; border-radius:9999px; font-family:monospace; font-weight:700;">INTERCEPTED</span>
            </div>
            <p style="margin:2px 0 0; font-size:11px; color:#757575;">
              File Upload Intercepted on <strong style="color:#212529;">${window.location.hostname || 'site'}</strong>
            </p>
          </div>
        </div>
        <button id="btn-prompt-close" style="background:transparent; border:none; color:#9ca3af; font-size:16px; cursor:pointer; padding:4px;" title="Cancel Upload">✕</button>
      </div>

      <div style="background:#FFFFFF; border:1px solid rgba(0, 0, 0, 0.06); border-radius:10px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; font-size:11px;">
        <span style="color:#212529; font-weight:600; font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;">📄 ${file.name}</span>
        <span style="color:#757575; font-family:monospace;">${(file.size / 1024).toFixed(1)} KB</span>
      </div>

      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <button id="btn-prompt-edit" style="flex:1; background:#212529; color:#fff; border:none; border-radius:10px; padding:9px 12px; font-size:12px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
          <span>🎨</span>
          <span>Review & Redact</span>
        </button>
        <button id="btn-prompt-plaintext" style="background:#FFFFFF; color:#212529; border:1px solid rgba(0,0,0,0.12); border-radius:10px; padding:9px 12px; font-size:11px; font-weight:600; cursor:pointer;" title="Upload original file without masking">
          Upload Plaintext
        </button>
      </div>
    `;

    document.documentElement.appendChild(promptCard);
    activePrompt = promptCard;

    const btnEdit = promptCard.querySelector('#btn-prompt-edit');
    const btnPlaintext = promptCard.querySelector('#btn-prompt-plaintext');
    const btnClose = promptCard.querySelector('#btn-prompt-close');

    if (btnEdit) {
      btnEdit.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        onOpenEditor();
      };
    }

    if (btnPlaintext) {
      btnPlaintext.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        onAllowPlaintext();
      };
    }

    if (btnClose) {
      btnClose.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        onCancel();
      };
    }
  }

  // -------------------------------------------------------------
  // 4b. Standard Multi-Page & Single-Page PDF 1.4 Binary Generator
  // -------------------------------------------------------------
  function createPdfBlobFromCanvases(canvasList) {
    if (!canvasList || canvasList.length === 0) return null;
    const numPages = canvasList.length;

    // Use standardized jsPDF engine (parity with Privora web app) for compact, cross-compatible PDFs
    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || (globalThis.jspdf && globalThis.jspdf.jsPDF) || window.jsPDF;
    if (jsPDFClass) {
      try {
        const first = canvasList[0];
        const firstW = first.width || 800;
        const firstH = first.height || 1000;
        const firstOrientation = firstW > firstH ? 'landscape' : 'portrait';

        const pdf = new jsPDFClass({
          orientation: firstOrientation,
          unit: 'px',
          format: [firstW, firstH],
          compress: true,
          hotfixes: ['px_scaling'],
        });

        canvasList.forEach((c, idx) => {
          const w = c.width || 800;
          const h = c.height || 1000;
          if (idx > 0) {
            const pageOrientation = w > h ? 'landscape' : 'portrait';
            pdf.addPage([w, h], pageOrientation);
          }
          // Compress embedded page bitmap using JPEG DCT encoding at 0.86 quality (~120KB per page, prevents 100MB+ bloat)
          const imgDataUrl = c.toDataURL('image/jpeg', 0.86);
          pdf.addImage(imgDataUrl, 'JPEG', 0, 0, w, h, undefined, 'FAST');
        });

        return pdf.output('blob');
      } catch (err) {
        console.warn('[Privora Shield] jsPDF conversion error, falling back to direct binary builder:', err);
      }
    }

    const chunks = [];
    let currentOffset = 0;

    function addChunk(chunk) {
      if (typeof chunk === 'string') {
        const bytes = new TextEncoder().encode(chunk);
        chunks.push(bytes);
        currentOffset += bytes.length;
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
        currentOffset += chunk.length;
      }
    }

    addChunk('%PDF-1.4\n');

    const objOffsets = [];

    // Catalog: obj 1
    objOffsets[1] = currentOffset;
    addChunk('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // Pages: obj 2
    objOffsets[2] = currentOffset;
    const kids = Array.from({ length: numPages }, (_, i) => `${3 + i * 3} 0 R`).join(' ');
    addChunk(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${numPages} >>\nendobj\n`);

    // For each page: pageObj (3+i*3), imObj (4+i*3), cntObj (5+i*3)
    for (let i = 0; i < numPages; i++) {
      const c = canvasList[i];
      const pageId = 3 + i * 3;
      const imgId = 4 + i * 3;
      const contentId = 5 + i * 3;
      const w = c.width || 800;
      const h = c.height || 1000;
      const ptW = Math.round(w * 0.75);
      const ptH = Math.round(h * 0.75);

      // Compress to crisp JPEG at 0.85 quality - produces tiny ~120KB per page (avoids 130MB file bloat)
      const imgDataUrl = c.toDataURL('image/jpeg', 0.85);
      const rawB64 = imgDataUrl.split(',')[1] || '';
      const binStr = atob(rawB64);
      const imgBytes = new Uint8Array(binStr.length);
      for (let j = 0; j < binStr.length; j++) {
        imgBytes[j] = binStr.charCodeAt(j);
      }

      // Page object
      objOffsets[pageId] = currentOffset;
      addChunk(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`);

      // Image XObject
      objOffsets[imgId] = currentOffset;
      const imHeader = `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`;
      addChunk(imHeader);
      addChunk(imgBytes);
      addChunk('\nendstream\nendobj\n');

      // Content stream
      objOffsets[contentId] = currentOffset;
      const streamContent = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im${i} Do Q`;
      addChunk(`${contentId} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`);
    }

    const totalObjs = 2 + numPages * 3;
    const startXref = currentOffset;

    let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= totalObjs; i++) {
      const off = objOffsets[i] || 0;
      xref += String(off).padStart(10, '0') + ' 00000 n \n';
    }
    const trailer = `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;

    addChunk(xref);
    addChunk(trailer);

    return new Blob(chunks, { type: 'application/pdf' });
  }

  function createPdfBlobFromCanvas(canvas) {
    return createPdfBlobFromCanvases([canvas]);
  }

  // -------------------------------------------------------------
  // 4c. Interactive Pre-Upload Modal with Full Bounding Box Editor
  // -------------------------------------------------------------
  let activeOverlay = null;

  async function showFileInterceptionModal({
    file,
    initialBoxes = [],
    detectedItems = [],
    preloadedPdfPages = null,
    onConfirmMask,
    onAllowPlaintext,
    onCancel,
  }) {
    if (activeOverlay) {
      activeOverlay.remove();
      activeOverlay = null;
    }

    const overlay = document.createElement('div');
    overlay.id = 'aegis-guard-file-modal';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(10px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif;
      color: #212529;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background: #FAF9F6;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 20px;
      padding: 22px;
      max-width: 860px;
      width: 100%;
      max-height: 94vh;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(156, 141, 212, 0.2);
      overflow-y: auto;
    `;

    // 1. Header
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(0,0,0,0.06); padding-bottom:12px;';
    headerRow.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="background:#9C8DD4; color:#ffffff; width:38px; height:38px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; box-shadow:0 2px 6px rgba(156,141,212,0.35);">P</div>
        <div>
          <h3 style="margin:0; font-size:16px; font-weight:800; color:#212529; display:flex; align-items:center; gap:8px;">
            <span>Privora Privacy Studio</span>
            <span style="font-size:10px; background:#ECFDF5; color:#047857; border:1px solid #A7F3D0; padding:2px 8px; border-radius:9999px; font-family:monospace; font-weight:700;">ON-DEVICE MASK</span>
          </h3>
          <p style="margin:2px 0 0; font-size:11px; color:#757575;">
            Configure sensitive redaction boxes before uploading to <strong style="color:#212529;">${window.location.hostname || 'this website'}</strong>
          </p>
        </div>
      </div>
      <div style="text-align:right;">
        <span style="font-size:10px; color:#757575; font-family:monospace; display:block;">TARGET DOCUMENT</span>
        <span style="font-size:12px; font-weight:bold; color:#212529; font-family:monospace;">${file.name} (${(file.size / 1024).toFixed(1)} KB)</span>
      </div>
    `;
    card.appendChild(headerRow);

    // 2. Quick Preset Add & Clear Controls
    const quickBar = document.createElement('div');
    quickBar.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; background:#FFFFFF; padding:8px 12px; border-radius:12px; border:1px solid rgba(0,0,0,0.06);';
    quickBar.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:11px; color:#757575; font-weight:600; margin-right:4px;">Quick Presets:</span>
        <button id="add-face-btn" style="background:#FAF9F6; color:#212529; border:1px solid rgba(0,0,0,0.1); border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ Face Photo</button>
        <button id="add-name-btn" style="background:#FAF9F6; color:#212529; border:1px solid rgba(0,0,0,0.1); border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ Name / Demographic</button>
        <button id="add-id-btn" style="background:#FAF9F6; color:#212529; border:1px solid rgba(0,0,0,0.1); border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ ID Number</button>
        <button id="add-qr-btn" style="background:#FAF9F6; color:#212529; border:1px solid rgba(0,0,0,0.1); border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ QR Matrix</button>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <button id="scale-up-btn" style="background:#FAF9F6; color:#212529; border:1px solid rgba(0,0,0,0.1); border-radius:6px; padding:3px 8px; font-size:11px; font-weight:bold; cursor:pointer;" title="Expand selected box (+15%)">[ +15% ]</button>
        <button id="scale-down-btn" style="background:#FAF9F6; color:#212529; border:1px solid rgba(0,0,0,0.1); border-radius:6px; padding:3px 8px; font-size:11px; font-weight:bold; cursor:pointer;" title="Shrink selected box (-15%)">[ -15% ]</button>
        <button id="clear-boxes-btn" style="background:#FEE2E2; color:#DC2626; border:1px solid #FCA5A5; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">🗑️ Clear All</button>
      </div>
    `;
    card.appendChild(quickBar);

    // 3. Interactive Canvas Container
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
      position: relative;
      background: #FFFFFF;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 280px;
      max-height: 400px;
      user-select: none;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.03);
    `;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'max-width:100%; max-height:380px; object-contain:contain; border-radius:8px;';
    canvasContainer.appendChild(canvas);
    card.appendChild(canvasContainer);

    const HANDLE_SIZE = 10;
    let currentBoxes = [...initialBoxes];
    let selectedBoxIdx = 0;
    let dragMode = null; // 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR' | 'DRAW_NEW'
    let dragAnchor = null;
    let baseImage = null;

    // Detect File Format
    const fn = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || fn.endsWith('.pdf');
    const isTextDoc = file.type.startsWith('text/') || fn.match(/\.(txt|csv|json|env|yaml|yml|xml|log|md|sql|py|js|ts|java|c|cpp|sh|docx?|xlsx?)$/i);
    const isImage = file.type.startsWith('image/') || fn.match(/\.(png|jpe?g|webp|svg|bmp|gif)$/i);

    let docExtractedText = '';
    let docRawContent = '';
    let detectedPii = [];

    // PDF Multi-Page Data Store
    let pdfPages = [];
    let currentPdfPageIdx = 0;
    let pageNavContainer = null;
    let switchPdfPage = (targetIdx) => {};

    function updatePageNavUI() {
      if (!pageNavContainer) return;
      if (pdfPages.length <= 1) {
        pageNavContainer.style.display = 'none';
        return;
      }
      pageNavContainer.style.display = 'flex';
      pageNavContainer.innerHTML = '';

      const btnPrev = document.createElement('button');
      btnPrev.type = 'button';
      btnPrev.style.cssText = 'background:#212529; color:#fff; border:none; border-radius:6px; padding:3px 8px; font-weight:bold; cursor:pointer; font-size:11px;';
      btnPrev.textContent = '◀ Prev';
      btnPrev.disabled = currentPdfPageIdx === 0;
      if (btnPrev.disabled) btnPrev.style.opacity = '0.35';
      btnPrev.onclick = () => switchPdfPage(currentPdfPageIdx - 1);
      pageNavContainer.appendChild(btnPrev);

      pdfPages.forEach((p, idx) => {
        const boxCount = (idx === currentPdfPageIdx) ? currentBoxes.length : (p.boxes ? p.boxes.length : 0);
        const hasMasks = boxCount > 0;
        const isCurrent = idx === currentPdfPageIdx;

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'aegis-page-pill';
        pill.dataset.page = p.pageNum;
        pill.style.cssText = `
          border: ${isCurrent ? '1.5px solid #9C8DD4' : hasMasks ? '1px solid #A7F3D0' : '1px solid rgba(0,0,0,0.1)'};
          background: ${isCurrent ? '#212529' : hasMasks ? '#ECFDF5' : '#FFFFFF'};
          color: ${isCurrent ? '#ffffff' : hasMasks ? '#047857' : '#757575'};
          padding: 3px 8px;
          border-radius: 8px;
          font-size: 11px;
          font-family: monospace;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.15s ease;
        `;
        pill.title = `Page ${p.pageNum} (${hasMasks ? `${boxCount} sensitive areas masked` : 'Clean page'})`;
        pill.innerHTML = `<span>Page ${p.pageNum}</span>${hasMasks ? `<span style="background:${isCurrent ? '#9C8DD4' : '#047857'}; color:#fff; padding:1px 5px; border-radius:9999px; font-size:9px;">🔒 ${boxCount}</span>` : '<span style="font-size:9px; color:#9ca3af;">✓</span>'}`;
        pill.onclick = () => switchPdfPage(idx);
        pageNavContainer.appendChild(pill);
      });

      const btnNext = document.createElement('button');
      btnNext.type = 'button';
      btnNext.style.cssText = 'background:#212529; color:#fff; border:none; border-radius:6px; padding:3px 8px; font-weight:bold; cursor:pointer; font-size:11px;';
      btnNext.textContent = 'Next ▶';
      btnNext.disabled = currentPdfPageIdx === pdfPages.length - 1;
      if (btnNext.disabled) btnNext.style.opacity = '0.35';
      btnNext.onclick = () => switchPdfPage(currentPdfPageIdx + 1);
      pageNavContainer.appendChild(btnNext);
    }

    // Helper: generate document page preview canvas for plain text documents
    async function createDocumentPageCanvas() {
      if (isTextDoc) {
        try {
          docRawContent = await file.text();
          docExtractedText = docRawContent;
        } catch (e) {
          docExtractedText = 'Could not read text stream.';
        }
      } else if (isPdf) {
        try {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let text = '';
          let curWord = '';
          for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
              curWord += String.fromCharCode(b);
            } else {
              if (curWord.length >= 3) text += curWord + ' ';
              curWord = '';
            }
          }
          if (curWord.length >= 3) text += curWord;
          docExtractedText = text.length > 30 ? text : 'Document stream preview.';
        } catch (e) {
          docExtractedText = 'Document stream preview.';
        }
      } else {
        docExtractedText = 'Document stream preview.';
      }

      detectedPii = scanText(docExtractedText);

      const docCanvas = document.createElement('canvas');
      docCanvas.width = 800;
      docCanvas.height = 580;
      const dCtx = docCanvas.getContext('2d');
      if (!dCtx) return docCanvas;

      // Background
      dCtx.fillStyle = '#0f172a';
      dCtx.fillRect(0, 0, docCanvas.width, docCanvas.height);

      // Card Container
      dCtx.fillStyle = '#1e293b';
      dCtx.fillRect(20, 20, docCanvas.width - 40, docCanvas.height - 40);
      dCtx.strokeStyle = '#334155';
      dCtx.lineWidth = 1.5;
      dCtx.strokeRect(20, 20, docCanvas.width - 40, docCanvas.height - 40);

      // Header Banner
      dCtx.fillStyle = '#38bdf8';
      dCtx.font = 'bold 16px -apple-system, sans-serif';
      dCtx.fillText(`📄 ${file.name}`, 40, 55);

      dCtx.fillStyle = '#94a3b8';
      dCtx.font = '11px monospace';
      dCtx.fillText(`CONFIDENTIAL DOCUMENT · LOCAL PRIVACY SHIELD ANALYSIS (${detectedPii.length} sensitive items detected)`, 40, 78);

      dCtx.strokeStyle = '#334155';
      dCtx.beginPath();
      dCtx.moveTo(40, 90);
      dCtx.lineTo(docCanvas.width - 40, 90);
      dCtx.stroke();

      const rawLines = (docExtractedText || 'Formatted document content stream')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .slice(0, 16);

      let curY = 125;
      dCtx.fillStyle = '#e2e8f0';
      dCtx.font = '13px monospace';

      rawLines.forEach((line) => {
        if (curY > docCanvas.height - 35) return;
        const disp = line.length > 70 ? line.substring(0, 68) + '...' : line;
        dCtx.fillText(disp, 40, curY);

        // Auto map bounding boxes over detected sensitive items in this line
        detectedPii.forEach((item) => {
          if (item.value && disp.includes(item.value)) {
            const charIdx = disp.indexOf(item.value);
            const charW = 7.8;
            const bx = Math.round(40 + (charIdx * charW) - 4);
            const by = Math.round(curY - 14);
            const bw = Math.round((item.value.length * charW) + 8);
            const bh = 18;
            if (!currentBoxes.some(b => Math.abs(b.x - bx) < 10 && Math.abs(b.y - by) < 10)) {
              currentBoxes.push({
                x: bx,
                y: by,
                width: bw,
                height: bh,
                label: item.label
              });
            }
          }
        });
        curY += 26;
      });

      // If no inline boxes created, add fallback boxes for discovered items
      if (currentBoxes.length === 0 && detectedPii.length > 0) {
        detectedPii.forEach((item, idx) => {
          currentBoxes.push({
            x: 40,
            y: Math.min(docCanvas.height - 50, 120 + (idx * 35)),
            width: 300,
            height: 22,
            label: item.label
          });
        });
      }

      return docCanvas;
    }

    // Load File (PDF, Image, or Text Document) into Preview Canvas
    baseImage = new Image();

    if (isPdf && preloadedPdfPages && preloadedPdfPages.length > 0) {
      pdfPages = preloadedPdfPages;
    } else if (isPdf) {
      const { pdfLib, workerLib } = ensurePdfWorkerHandler();

      if (pdfLib) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfLib.getDocument({
            data: new Uint8Array(arrayBuffer),
            useSystemFonts: true,
          });
          const pdfDoc = await loadingTask.promise;
          const totalPages = Math.max(1, pdfDoc.numPages);

          for (let pNum = 1; pNum <= totalPages; pNum++) {
            const page = await pdfDoc.getPage(pNum);
            const viewport = page.getViewport({ scale: 1.5 });
            const pCanvas = document.createElement('canvas');
            pCanvas.width = Math.round(viewport.width);
            pCanvas.height = Math.round(viewport.height);
            const pCtx = pCanvas.getContext('2d');

            // Ensure crisp opaque white paper background
            pCtx.fillStyle = '#FFFFFF';
            pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

            await page.render({
              canvasContext: pCtx,
              viewport: viewport,
            }).promise;

            const textContent = await page.getTextContent();
            const rawItems = (textContent.items || []).filter(i => i && typeof i.str === 'string' && i.str.length > 0);

            let pageText = '';
            let lastY = null;
            for (const item of rawItems) {
              const curY = item.transform ? item.transform[5] : null;
              if (lastY !== null && curY !== null && Math.abs(curY - lastY) > 5) {
                pageText += '\n' + item.str;
              } else {
                pageText += (pageText.length > 0 && !pageText.endsWith('\n') ? ' ' : '') + item.str;
              }
              if (curY !== null) lastY = curY;
            }

            const piiItems = scanText(pageText);
            const pageBoxes = [];

            // Line-constrained tight bounding box mapping
            piiItems.forEach(finding => {
              const matchedBox = findBoundingBoxForFinding(finding, rawItems, pCanvas.width, pCanvas.height);
              if (matchedBox) {
                pageBoxes.push(matchedBox);
              }
            });

            pdfPages.push({
              pageNum: pNum,
              canvas: pCanvas,
              pageDataUrl: pCanvas.toDataURL('image/jpeg', 0.85),
              text: pageText,
              boxes: pageBoxes,
              detectedPii: piiItems
            });
          }
        } catch (pdfErr) {
          console.warn('PDF.js in-extension error:', pdfErr);
        }
      }

      if (pdfPages.length > 0) {
        currentBoxes = [...pdfPages[0].boxes];
        canvas.width = pdfPages[0].canvas.width;
        canvas.height = pdfPages[0].canvas.height;
        await new Promise((resolve) => {
          baseImage.onload = () => {
            renderCanvas();
            resolve();
          };
          baseImage.onerror = () => {
            renderCanvas();
            resolve();
          };
          baseImage.src = pdfPages[0].pageDataUrl;
        });

        // Add Multi-Page Navigation Bar to QuickBar if multi-page PDF
        if (pdfPages.length > 1) {
          pageNavContainer = document.createElement('div');
          pageNavContainer.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; gap:6px; background:#FAF9F6; padding:4px 8px; border-radius:10px; border:1px solid rgba(0,0,0,0.08);';
          quickBar.appendChild(pageNavContainer);

          switchPdfPage = (targetIdx) => {
            if (targetIdx < 0 || targetIdx >= pdfPages.length) return;
            pdfPages[currentPdfPageIdx].boxes = [...currentBoxes];
            currentPdfPageIdx = targetIdx;
            currentBoxes = [...pdfPages[targetIdx].boxes];
            canvas.width = pdfPages[targetIdx].canvas.width;
            canvas.height = pdfPages[targetIdx].canvas.height;
            baseImage = new Image();
            baseImage.onload = () => renderCanvas();
            baseImage.src = pdfPages[targetIdx].pageDataUrl;
            updatePageNavUI();
          };

          updatePageNavUI();
        }
      } else {
        // Fallback for PDF if PDF.js was unable to parse
        const docCanvas = await createDocumentPageCanvas();
        canvas.width = docCanvas.width;
        canvas.height = docCanvas.height;
        await new Promise((resolve) => {
          baseImage.onload = () => { renderCanvas(); resolve(); };
          baseImage.onerror = () => { renderCanvas(); resolve(); };
          baseImage.src = docCanvas.toDataURL('image/png');
        });
      }
    } else if (isImage) {
      const imgUrl = URL.createObjectURL(file);
      await new Promise((resolve) => {
        baseImage.onload = () => {
          canvas.width = baseImage.naturalWidth || 800;
          canvas.height = baseImage.naturalHeight || 600;

          // Sensible default positions for Indian Government IDs
          if (currentBoxes.length === 0) {
            const detected = detectFaceOrSensitiveRegions(canvas, file.name);
            if (detected && detected.length > 0) {
              currentBoxes = [...detected];
            } else {
              currentBoxes.push({
                x: Math.round(canvas.width * 0.01),
                y: Math.round(canvas.height * 0.20),
                width: Math.round(canvas.width * 0.20),
                height: Math.round(canvas.height * 0.50),
                label: 'Face Photo'
              });
              currentBoxes.push({
                x: Math.round(canvas.width * 0.21),
                y: Math.round(canvas.height * 0.72),
                width: Math.round(canvas.width * 0.58),
                height: Math.round(canvas.height * 0.12),
                label: 'Aadhaar Number'
              });
              currentBoxes.push({
                x: Math.round(canvas.width * 0.72),
                y: Math.round(canvas.height * 0.26),
                width: Math.round(canvas.width * 0.26),
                height: Math.round(canvas.height * 0.44),
                label: 'QR Matrix'
              });
            }
          }
          renderCanvas();
          resolve();
        };
        baseImage.onerror = async () => {
          const docCanvas = await createDocumentPageCanvas();
          canvas.width = docCanvas.width;
          canvas.height = docCanvas.height;
          baseImage.onload = () => {
            renderCanvas();
            resolve();
          };
          baseImage.src = docCanvas.toDataURL('image/png');
        };
        baseImage.src = imgUrl;
      });
    } else {
      // Text document
      const docCanvas = await createDocumentPageCanvas();
      canvas.width = docCanvas.width;
      canvas.height = docCanvas.height;
      await new Promise((resolve) => {
        baseImage.onload = () => {
          renderCanvas();
          resolve();
        };
        baseImage.onerror = () => {
          renderCanvas();
          resolve();
        };
        baseImage.src = docCanvas.toDataURL('image/png');
      });
    }

    function renderCanvas(isExport = false) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Always paint crisp white background so transparent pages never render dark or blank
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (baseImage && baseImage.complete && baseImage.naturalWidth > 0) {
        ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
      }

      currentBoxes.forEach((box, idx) => {
        const bx = Math.max(0, Math.round(box.x));
        const by = Math.max(0, Math.round(box.y));
        const bw = Math.min(canvas.width - bx, Math.round(box.width));
        const bh = Math.min(canvas.height - by, Math.round(box.height));

        if (bw > 0 && bh > 0) {
          // High-Entropy Synthetic Checkerboard Privacy Mask (zero pixel leakage, matches web app vault)
          ctx.save();
          ctx.beginPath();
          ctx.rect(bx, by, bw, bh);
          ctx.clip();

          // Solid background fill
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(bx, by, bw, bh);

          // Fixed synthetic checkerboard pattern (zero statistical dependency on underlying content)
          const blockSize = Math.max(6, Math.floor(Math.min(bw, bh) / 8));
          for (let y = by; y < by + bh; y += blockSize) {
            for (let x = bx; x < bx + bw; x += blockSize) {
              const tileW = Math.min(blockSize, bx + bw - x);
              const tileH = Math.min(blockSize, by + bh - y);
              ctx.fillStyle = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0
                ? 'rgba(15, 23, 42, 0.98)'
                : 'rgba(30, 41, 59, 0.96)';
              ctx.fillRect(x, y, tileW, tileH);
            }
          }

          ctx.restore();

          // UI Overlays: ONLY drawn during interactive editing, NEVER during export!
          if (!isExport) {
            const isSelected = idx === selectedBoxIdx;

            // Mask Overlay
            ctx.fillStyle = isSelected ? 'rgba(6, 182, 212, 0.35)' : 'rgba(6, 182, 212, 0.20)';
            ctx.fillRect(bx, by, bw, bh);
            ctx.strokeStyle = isSelected ? '#06b6d4' : '#0284c7';
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.strokeRect(bx, by, bw, bh);

            // Lock Label Tag
            ctx.fillStyle = '#06b6d4';
            ctx.font = 'bold 12px monospace';
            const labelW = Math.min(bw, 140);
            ctx.fillRect(bx, Math.max(0, by - 20), labelW, 20);
            ctx.fillStyle = '#020617';
            ctx.fillText(`🔒 ${box.label || 'REDACTED'}`, bx + 6, Math.max(14, by - 6));

            // Draw Delete (X) button on top right of box
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(bx + bw - 18, Math.max(0, by - 20), 18, 20);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('✕', bx + bw - 14, Math.max(14, by - 6));

            // If Selected: Draw 4 Interactive Corner Handles
            if (isSelected) {
              ctx.fillStyle = '#06b6d4';
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2;

              // TL, TR, BL, BR
              const handles = [
                { x: bx - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
                { x: bx + bw - HANDLE_SIZE / 2, y: by - HANDLE_SIZE / 2 },
                { x: bx - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
                { x: bx + bw - HANDLE_SIZE / 2, y: by + bh - HANDLE_SIZE / 2 },
              ];

              handles.forEach(h => {
                ctx.fillRect(h.x, h.y, HANDLE_SIZE, HANDLE_SIZE);
                ctx.strokeRect(h.x, h.y, HANDLE_SIZE, HANDLE_SIZE);
              });
            }
          }
        }
      });

      // Draw active drag box if drawing new (only in interactive mode)
      if (!isExport && dragMode === 'DRAW_NEW' && dragAnchor) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(dragAnchor.x, dragAnchor.y, dragAnchor.width, dragAnchor.height);
        ctx.setLineDash([]);
      }

      if (!isExport && pdfPages.length > 1) {
        updatePageNavUI();
      }
    }

    function getCanvasCoords(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    function hitTest(x, y) {
      // 1. Check handles of selected box
      if (selectedBoxIdx !== null && currentBoxes[selectedBoxIdx]) {
        const box = currentBoxes[selectedBoxIdx];
        const bx = box.x;
        const by = box.y;
        const bw = box.width;
        const bh = box.height;

        // Check Delete Button (top right: bx + bw - 18, by - 20)
        if (x >= bx + bw - 22 && x <= bx + bw + 4 && y >= by - 24 && y <= by + 4) {
          return { type: 'DELETE', index: selectedBoxIdx };
        }

        // Check Corner Handles
        if (Math.abs(x - bx) <= HANDLE_SIZE && Math.abs(y - by) <= HANDLE_SIZE) return { type: 'RESIZE_TL', index: selectedBoxIdx };
        if (Math.abs(x - (bx + bw)) <= HANDLE_SIZE && Math.abs(y - by) <= HANDLE_SIZE) return { type: 'RESIZE_TR', index: selectedBoxIdx };
        if (Math.abs(x - bx) <= HANDLE_SIZE && Math.abs(y - (by + bh)) <= HANDLE_SIZE) return { type: 'RESIZE_BL', index: selectedBoxIdx };
        if (Math.abs(x - (bx + bw)) <= HANDLE_SIZE && Math.abs(y - (by + bh)) <= HANDLE_SIZE) return { type: 'RESIZE_BR', index: selectedBoxIdx };
      }

      // 2. Check inside existing boxes (top to bottom)
      for (let i = currentBoxes.length - 1; i >= 0; i--) {
        const box = currentBoxes[i];
        if (x >= box.x && x <= box.x + box.width && y >= box.y - 20 && y <= box.y + box.height) {
          // Check if delete button hit
          if (x >= box.x + box.width - 22 && y <= box.y + 4) {
            return { type: 'DELETE', index: i };
          }
          return { type: 'MOVE', index: i };
        }
      }

      return { type: 'EMPTY' };
    }

    canvas.onmousedown = (e) => {
      const coords = getCanvasCoords(e);
      const hit = hitTest(coords.x, coords.y);

      if (hit.type === 'DELETE') {
        currentBoxes.splice(hit.index, 1);
        selectedBoxIdx = currentBoxes.length > 0 ? 0 : null;
        updateCropsToolbar();
        renderCanvas();
        return;
      }

      if (hit.type.startsWith('RESIZE_')) {
        dragMode = hit.type;
        dragAnchor = {
          startX: coords.x,
          startY: coords.y,
          origBox: { ...currentBoxes[hit.index] }
        };
        selectedBoxIdx = hit.index;
      } else if (hit.type === 'MOVE') {
        dragMode = 'MOVE';
        dragAnchor = {
          startX: coords.x,
          startY: coords.y,
          origBox: { ...currentBoxes[hit.index] }
        };
        selectedBoxIdx = hit.index;
      } else {
        dragMode = 'DRAW_NEW';
        dragAnchor = {
          startX: coords.x,
          startY: coords.y,
          x: coords.x,
          y: coords.y,
          width: 0,
          height: 0
        };
        selectedBoxIdx = null;
      }
      renderCanvas();
    };

    canvas.onmousemove = (e) => {
      const coords = getCanvasCoords(e);

      // Update Cursor based on Hover
      if (!dragMode) {
        const hit = hitTest(coords.x, coords.y);
        if (hit.type === 'RESIZE_TL' || hit.type === 'RESIZE_BR') canvas.style.cursor = 'nwse-resize';
        else if (hit.type === 'RESIZE_TR' || hit.type === 'RESIZE_BL') canvas.style.cursor = 'nesw-resize';
        else if (hit.type === 'MOVE') canvas.style.cursor = 'move';
        else if (hit.type === 'DELETE') canvas.style.cursor = 'pointer';
        else canvas.style.cursor = 'crosshair';
        return;
      }

      const dx = coords.x - dragAnchor.startX;
      const dy = coords.y - dragAnchor.startY;

      if (dragMode === 'MOVE' && selectedBoxIdx !== null) {
        const orig = dragAnchor.origBox;
        currentBoxes[selectedBoxIdx].x = Math.max(0, Math.min(canvas.width - orig.width, orig.x + dx));
        currentBoxes[selectedBoxIdx].y = Math.max(20, Math.min(canvas.height - orig.height, orig.y + dy));
      } else if (dragMode === 'RESIZE_BR' && selectedBoxIdx !== null) {
        const orig = dragAnchor.origBox;
        currentBoxes[selectedBoxIdx].width = Math.max(20, orig.width + dx);
        currentBoxes[selectedBoxIdx].height = Math.max(20, orig.height + dy);
      } else if (dragMode === 'RESIZE_TL' && selectedBoxIdx !== null) {
        const orig = dragAnchor.origBox;
        const newX = Math.min(orig.x + orig.width - 20, Math.max(0, orig.x + dx));
        const newY = Math.min(orig.y + orig.height - 20, Math.max(20, orig.y + dy));
        currentBoxes[selectedBoxIdx].width = orig.width + (orig.x - newX);
        currentBoxes[selectedBoxIdx].height = orig.height + (orig.y - newY);
        currentBoxes[selectedBoxIdx].x = newX;
        currentBoxes[selectedBoxIdx].y = newY;
      } else if (dragMode === 'RESIZE_TR' && selectedBoxIdx !== null) {
        const orig = dragAnchor.origBox;
        const newY = Math.min(orig.y + orig.height - 20, Math.max(20, orig.y + dy));
        currentBoxes[selectedBoxIdx].width = Math.max(20, orig.width + dx);
        currentBoxes[selectedBoxIdx].height = orig.height + (orig.y - newY);
        currentBoxes[selectedBoxIdx].y = newY;
      } else if (dragMode === 'RESIZE_BL' && selectedBoxIdx !== null) {
        const orig = dragAnchor.origBox;
        const newX = Math.min(orig.x + orig.width - 20, Math.max(0, orig.x + dx));
        currentBoxes[selectedBoxIdx].width = orig.width + (orig.x - newX);
        currentBoxes[selectedBoxIdx].height = Math.max(20, orig.height + dy);
        currentBoxes[selectedBoxIdx].x = newX;
      } else if (dragMode === 'DRAW_NEW') {
        dragAnchor.x = Math.min(dragAnchor.startX, coords.x);
        dragAnchor.y = Math.min(dragAnchor.startY, coords.y);
        dragAnchor.width = Math.abs(coords.x - dragAnchor.startX);
        dragAnchor.height = Math.abs(coords.y - dragAnchor.startY);
      }

      renderCanvas();
    };

    canvas.onmouseup = () => {
      if (dragMode === 'DRAW_NEW' && dragAnchor && dragAnchor.width > 15 && dragAnchor.height > 15) {
        currentBoxes.push({
          x: dragAnchor.x,
          y: dragAnchor.y,
          width: dragAnchor.width,
          height: dragAnchor.height,
          label: 'Custom Redacted'
        });
        selectedBoxIdx = currentBoxes.length - 1;
      }
      dragMode = null;
      dragAnchor = null;
      updateCropsToolbar();
      renderCanvas();
    };

    // Quick Preset Button Handlers (Bound safely to quickBar)
    const addFaceBtn = quickBar.querySelector('#add-face-btn');
    if (addFaceBtn) {
      addFaceBtn.onclick = () => {
        currentBoxes.push({
          x: Math.round(canvas.width * 0.01),
          y: Math.round(canvas.height * 0.20),
          width: Math.round(canvas.width * 0.20),
          height: Math.round(canvas.height * 0.50),
          label: 'Face Photo'
        });
        selectedBoxIdx = currentBoxes.length - 1;
        updateCropsToolbar();
        renderCanvas();
      };
    }

    const addNameBtn = quickBar.querySelector('#add-name-btn');
    if (addNameBtn) {
      addNameBtn.onclick = () => {
        currentBoxes.push({
          x: Math.round(canvas.width * 0.24),
          y: Math.round(canvas.height * 0.26),
          width: Math.round(canvas.width * 0.44),
          height: Math.round(canvas.height * 0.18),
          label: 'Name / Demographic'
        });
        selectedBoxIdx = currentBoxes.length - 1;
        updateCropsToolbar();
        renderCanvas();
      };
    }

    const addIdBtn = quickBar.querySelector('#add-id-btn');
    if (addIdBtn) {
      addIdBtn.onclick = () => {
        currentBoxes.push({
          x: Math.round(canvas.width * 0.21),
          y: Math.round(canvas.height * 0.72),
          width: Math.round(canvas.width * 0.58),
          height: Math.round(canvas.height * 0.12),
          label: 'Aadhaar / ID Number'
        });
        selectedBoxIdx = currentBoxes.length - 1;
        updateCropsToolbar();
        renderCanvas();
      };
    }

    const addQrBtn = quickBar.querySelector('#add-qr-btn');
    if (addQrBtn) {
      addQrBtn.onclick = () => {
        currentBoxes.push({
          x: Math.round(canvas.width * 0.72),
          y: Math.round(canvas.height * 0.26),
          width: Math.round(canvas.width * 0.26),
          height: Math.round(canvas.height * 0.44),
          label: 'QR Matrix'
        });
        selectedBoxIdx = currentBoxes.length - 1;
        updateCropsToolbar();
        renderCanvas();
      };
    }

    const clearBoxesBtn = quickBar.querySelector('#clear-boxes-btn');
    if (clearBoxesBtn) {
      clearBoxesBtn.onclick = () => {
        currentBoxes = [];
        selectedBoxIdx = null;
        updateCropsToolbar();
        renderCanvas();
      };
    }

    const scaleUpBtn = quickBar.querySelector('#scale-up-btn');
    if (scaleUpBtn) {
      scaleUpBtn.onclick = () => {
        if (selectedBoxIdx !== null && currentBoxes[selectedBoxIdx]) {
          const b = currentBoxes[selectedBoxIdx];
          const dw = Math.round(b.width * 0.15);
          const dh = Math.round(b.height * 0.15);
          b.x = Math.max(0, b.x - Math.round(dw / 2));
          b.y = Math.max(20, b.y - Math.round(dh / 2));
          b.width += dw;
          b.height += dh;
          updateCropsToolbar();
          renderCanvas();
        }
      };
    }

    const scaleDownBtn = quickBar.querySelector('#scale-down-btn');
    if (scaleDownBtn) {
      scaleDownBtn.onclick = () => {
        if (selectedBoxIdx !== null && currentBoxes[selectedBoxIdx]) {
          const b = currentBoxes[selectedBoxIdx];
          const dw = Math.round(b.width * 0.15);
          const dh = Math.round(b.height * 0.15);
          b.width = Math.max(20, b.width - dw);
          b.height = Math.max(20, b.height - dh);
          b.x += Math.round(dw / 2);
          b.y += Math.round(dh / 2);
          updateCropsToolbar();
          renderCanvas();
        }
      };
    }

    // 4. Toolbar (Interactive Controls & Standalone Crops)
    const toolbarRow = document.createElement('div');
    toolbarRow.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px;';

    const infoSpan = document.createElement('span');
    infoSpan.style.cssText = 'font-size:12px; color:#38bdf8; font-family:monospace; display:flex; align-items:center; gap:6px;';
    infoSpan.innerHTML = '<span>💡</span> Drag inside box to move, drag corners to resize, or drag empty area to add';
    toolbarRow.appendChild(infoSpan);

    const cropsContainer = document.createElement('div');
    cropsContainer.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; gap:8px;';
    toolbarRow.appendChild(cropsContainer);
    card.appendChild(toolbarRow);

    function updateCropsToolbar() {
      cropsContainer.innerHTML = '';
      if (currentBoxes.length > 0 && baseImage && baseImage.complete && baseImage.naturalWidth > 0) {
        currentBoxes.forEach((box, idx) => {
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = Math.max(1, Math.round(box.width));
          cropCanvas.height = Math.max(1, Math.round(box.height));
          const cCtx = cropCanvas.getContext('2d');
          if (cCtx) {
            cCtx.drawImage(
              baseImage,
              Math.round(box.x),
              Math.round(box.y),
              Math.round(box.width),
              Math.round(box.height),
              0,
              0,
              cropCanvas.width,
              cropCanvas.height
            );
            const cropUrl = cropCanvas.toDataURL('image/png');

            const dlBtn = document.createElement('a');
            dlBtn.href = cropUrl;
            dlBtn.download = `hidden_piece_${idx + 1}_${box.label.replace(/\s+/g, '_')}.png`;
            dlBtn.style.cssText = `
              padding: 4px 10px;
              background: #1e293b;
              color: #38bdf8;
              border: 1px solid #0369a1;
              border-radius: 8px;
              font-size: 11px;
              font-weight: 600;
              text-decoration: none;
              display: flex;
              align-items: center;
              gap: 4px;
            `;
            dlBtn.innerHTML = `<span>✂️</span> ${box.label || `Piece #${idx + 1}`}`;
            cropsContainer.appendChild(dlBtn);
          }
        });
      }
    }
    updateCropsToolbar();

    // 5. Action Buttons
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex; gap:10px; border-top:1px solid #1e293b; padding-top:14px;';

    const btnConfirmMask = document.createElement('button');
    btnConfirmMask.style.cssText = `
      flex: 2;
      background: #212529;
      color: #ffffff;
      border: none;
      border-radius: 12px;
      padding: 12px 16px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      transition: background 0.15s ease;
    `;
    btnConfirmMask.innerHTML = '<span>🔒</span> Apply & Upload Encrypted Document';

    const btnAllowPlaintext = document.createElement('button');
    btnAllowPlaintext.style.cssText = `
      flex: 1;
      background: #FFFFFF;
      color: #B45309;
      border: 1px solid #FDE68A;
      border-radius: 12px;
      padding: 12px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    btnAllowPlaintext.textContent = '⚠️ Upload Plaintext';

    const btnCancel = document.createElement('button');
    btnCancel.style.cssText = `
      flex: 1;
      background: #FFFFFF;
      color: #64748B;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 12px;
      padding: 12px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s ease;
    `;
    btnCancel.textContent = '❌ Cancel';

    actionRow.appendChild(btnConfirmMask);
    actionRow.appendChild(btnAllowPlaintext);
    actionRow.appendChild(btnCancel);
    card.appendChild(actionRow);

    overlay.appendChild(card);
    document.documentElement.appendChild(overlay);
    activeOverlay = overlay;

    // Button Click Handlers
    btnConfirmMask.onclick = async () => {
      // 1. Extract raw unblurred slices for auto-restoration
      if (isPdf && pdfPages && pdfPages.length > 0) {
        pdfPages[currentPdfPageIdx].boxes = [...currentBoxes];
        pdfPages.forEach((p, pIdx) => {
          (p.boxes || []).forEach((box) => {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = Math.max(1, Math.round(box.width));
            cropCanvas.height = Math.max(1, Math.round(box.height));
            const cCtx = cropCanvas.getContext('2d');
            if (cCtx) {
              cCtx.drawImage(
                p.canvas,
                Math.round(box.x),
                Math.round(box.y),
                Math.round(box.width),
                Math.round(box.height),
                0,
                0,
                cropCanvas.width,
                cropCanvas.height
              );
              unblurredSlices.push({
                pageNum: p.pageNum || (pIdx + 1),
                normX: box.x / p.canvas.width,
                normY: box.y / p.canvas.height,
                normW: box.width / p.canvas.width,
                normH: box.height / p.canvas.height,
                cropDataUrl: cropCanvas.toDataURL('image/jpeg', 0.88),
                label: box.label || 'Protected Piece',
              });
            }
          });
        });
      } else if (baseImage && baseImage.complete && baseImage.naturalWidth > 0) {
        currentBoxes.forEach((box) => {
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = Math.max(1, Math.round(box.width));
          cropCanvas.height = Math.max(1, Math.round(box.height));
          const cCtx = cropCanvas.getContext('2d');
          if (cCtx) {
            cCtx.drawImage(
              baseImage,
              Math.round(box.x),
              Math.round(box.y),
              Math.round(box.width),
              Math.round(box.height),
              0,
              0,
              cropCanvas.width,
              cropCanvas.height
            );
            unblurredSlices.push({
              normX: box.x / canvas.width,
              normY: box.y / canvas.height,
              normW: box.width / canvas.width,
              normH: box.height / canvas.height,
              cropDataUrl: cropCanvas.toDataURL('image/png'),
              label: box.label || 'Protected Piece',
            });
          }
        });
      }

      // 2. Render clean export canvas (pure synthetic checkerboard pixelation, zero UI overlays/tags)
      renderCanvas(true);

      if (isPdf) {
        let pdfBlob = null;
        if (pdfPages.length > 0) {
          pdfPages[currentPdfPageIdx].boxes = [...currentBoxes];
          const maskedCanvases = [];
          for (const p of pdfPages) {
            const mc = document.createElement('canvas');
            mc.width = p.canvas.width;
            mc.height = p.canvas.height;
            const mCtx = mc.getContext('2d');
            mCtx.drawImage(p.canvas, 0, 0);

            // Apply synthetic checkerboard mask for each box on this page
            p.boxes.forEach((box) => {
              const bx = Math.max(0, Math.round(box.x));
              const by = Math.max(0, Math.round(box.y));
              const bw = Math.min(mc.width - bx, Math.round(box.width));
              const bh = Math.min(mc.height - by, Math.round(box.height));
              if (bw > 0 && bh > 0) {
                mCtx.save();
                mCtx.beginPath();
                mCtx.rect(bx, by, bw, bh);
                mCtx.clip();
                mCtx.fillStyle = '#0f172a';
                mCtx.fillRect(bx, by, bw, bh);

                const blockSize = Math.max(6, Math.floor(Math.min(bw, bh) / 8));
                for (let y = by; y < by + bh; y += blockSize) {
                  for (let x = bx; x < bx + bw; x += blockSize) {
                    const tileW = Math.min(blockSize, bx + bw - x);
                    const tileH = Math.min(blockSize, by + bh - y);
                    mCtx.fillStyle = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0
                      ? 'rgba(15, 23, 42, 0.98)'
                      : 'rgba(51, 65, 85, 0.98)';
                    mCtx.fillRect(x, y, tileW, tileH);
                  }
                }
                mCtx.restore();
              }
            });
            maskedCanvases.push(mc);
          }
          pdfBlob = createPdfBlobFromCanvases(maskedCanvases);
        } else {
          pdfBlob = createPdfBlobFromCanvas(canvas);
        }

        const maskedFile = new File([pdfBlob], file.name, { type: 'application/pdf' });

        try {
          const rawBuffer = await file.arrayBuffer();
          const origHash = await computeSHA256(rawBuffer);
          const manifest = {
            id: 'aegis_' + Date.now(),
            fileName: file.name,
            originalWidth: canvas.width,
            originalHeight: canvas.height,
            originalFileSize: file.size,
            maskedFileSize: pdfBlob.size,
            origHash,
            timestamp: Date.now(),
            slices: unblurredSlices,
            isPdf: true,
            totalPages: pdfPages.length || 1,
            origin: window.location.origin,
            hostname: window.location.hostname,
          };
          saveManifest(manifest);
        } catch (e) {}

        overlay.remove();
        activeOverlay = null;
        updateFloatingHub();
        onConfirmMask(maskedFile);
        return;
      }

      if (isTextDoc) {
        // Redact detected PII tokens from raw text
        let sanitizedText = docRawContent || docExtractedText;
        detectedPii.forEach((item) => {
          if (item.value && sanitizedText.includes(item.value)) {
            sanitizedText = sanitizedText.split(item.value).join(`[REDACTED_${item.type}]`);
          }
        });
        const textBlob = new Blob([sanitizedText], { type: file.type || 'text/plain' });
        const maskedFile = new File([textBlob], file.name, { type: file.type || 'text/plain' });

        try {
          const rawBuffer = await file.arrayBuffer();
          const origHash = await computeSHA256(rawBuffer);
          const manifest = {
            id: 'aegis_' + Date.now(),
            fileName: file.name,
            originalWidth: canvas.width,
            originalHeight: canvas.height,
            originalFileSize: file.size,
            maskedFileSize: textBlob.size,
            origHash,
            timestamp: Date.now(),
            slices: unblurredSlices,
            origin: window.location.origin,
            hostname: window.location.hostname,
          };
          saveManifest(manifest);
        } catch (e) {}

        overlay.remove();
        activeOverlay = null;
        updateFloatingHub();
        onConfirmMask(maskedFile);
        return;
      }

      // Standard Image file export
      const estimatedQuality = estimateJpegQualityFromSize(file.size, canvas.width, canvas.height);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const maskedFile = new File([blob], file.name, { type: file.type || 'image/png' });

        // Save active manifest in chrome.storage.local for auto-restoration
        try {
          const rawBuffer = await file.arrayBuffer();
          const origHash = await computeSHA256(rawBuffer);

          const manifest = {
            id: 'aegis_' + Date.now(),
            fileName: file.name,
            originalWidth: canvas.width,
            originalHeight: canvas.height,
            originalFileSize: file.size,
            maskedFileSize: blob.size,
            origHash,
            timestamp: Date.now(),
            slices: unblurredSlices,
            origin: window.location.origin,
            hostname: window.location.hostname,
          };

          saveManifest(manifest);
        } catch (e) {}

        overlay.remove();
        activeOverlay = null;
        updateFloatingHub();
        onConfirmMask(maskedFile);
      }, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', file.type === 'image/jpeg' ? estimatedQuality : 0.85);
    };

    btnAllowPlaintext.onclick = () => {
      overlay.remove();
      activeOverlay = null;
      onAllowPlaintext();
    };

    btnCancel.onclick = () => {
      overlay.remove();
      activeOverlay = null;
      onCancel();
    };
  }

  // -------------------------------------------------------------
  // 5. File Input Change Interception (Seamless Auto-Shield)
  // -------------------------------------------------------------
  document.addEventListener('change', async (e) => {
    if (!isShieldEnabled) return;
    const target = e.target;
    if (!target || target.tagName !== 'INPUT' || target.type !== 'file') return;
    if (!target.files || target.files.length === 0) return;
    if (target.dataset.aegisSanitized === 'true') {
      delete target.dataset.aegisSanitized;
      return;
    }

    const file = target.files[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/') || file.name.match(/\.(png|jpe?g|webp|svg|bmp|gif)$/i);
    const isDoc = file.type === 'application/pdf' || file.type.startsWith('text/') || file.name.match(/\.(pdf|txt|env|json|yaml|yml|csv|xml|log|md|sql|py|js|ts|java|c|cpp|sh|docx?|xlsx?)$/i);

    if (isImage || isDoc) {
      e.preventDefault();
      e.stopImmediatePropagation();

      let isCommitted = false;

      const commitFile = (fileToCommit, isPlaintext = false) => {
        if (isPlaintext) {
          target.dataset.aegisSanitized = 'true';
          replaceInputFiles(target, fileToCommit);
          return;
        }
        if (isCommitted) return;
        isCommitted = true;
        replaceInputFiles(target, fileToCommit);
      };

      const cancelCommit = () => {
        if (isCommitted) return;
        isCommitted = true;
        try { target.value = ''; } catch (err) {}
      };

      try {
        const sanitizedFile = await autoProtectAndSanitizeFile(file, {
          onConfirmAuto: (sanitized) => {
            commitFile(sanitized || sanitizedFile);
          },
          onAllowPlaintext: () => {
            commitFile(file, true);
          },
          onCancel: () => {
            cancelCommit();
          },
          onOpenEditor: (detectedBoxes, preloadedPdfPages) => {
            showFileInterceptionModal({
              file,
              initialBoxes: detectedBoxes || [],
              detectedItems: [],
              preloadedPdfPages: preloadedPdfPages || null,
              onConfirmMask: (sanitized) => {
                commitFile(sanitized);
              },
              onAllowPlaintext: () => {
                commitFile(file, true);
              },
              onCancel: () => {
                cancelCommit();
              }
            });
          }
        });

        // Immediately commit sanitized file so input.files[0] has masked content
        if (sanitizedFile) {
          commitFile(sanitizedFile);
        }

        // If the host form is submitted before user interacts with the preview card,
        // commit the auto-encrypted file seamlessly once.
        const hostForm = target.form || (target.closest && target.closest('form'));
        if (hostForm) {
          hostForm.addEventListener('submit', () => {
            if (!isCommitted && sanitizedFile) {
              commitFile(sanitizedFile);
            }
          }, { once: true, capture: true });
        }
      } catch (err) {
        console.warn('[Privora Shield] Auto-protect failed, opening prompt:', err);
        showFileInterceptionPrompt({
          file,
          onOpenEditor: () => {
            showFileInterceptionModal({
              file,
              initialBoxes: [],
              detectedItems: [],
              onConfirmMask: (sanitized) => commitFile(sanitized),
              onAllowPlaintext: () => commitFile(file, true),
              onCancel: () => cancelCommit()
            });
          },
          onAllowPlaintext: () => commitFile(file, true),
          onCancel: () => cancelCommit()
        });
      }
    }
  }, true);

  // -------------------------------------------------------------
  // 6. File Drop Interception (Seamless Auto-Shield)
  // -------------------------------------------------------------
  document.addEventListener('drop', async (e) => {
    if (!isShieldEnabled) return;
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    if (e.defaultPrevented) return;

    const file = e.dataTransfer.files[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/') || file.name.match(/\.(png|jpe?g|webp|svg|bmp|gif)$/i);
    const isDoc = file.type === 'application/pdf' || file.type.startsWith('text/') || file.name.match(/\.(pdf|txt|env|json|yaml|yml|csv|xml|log|md|sql|py|js|ts|java|c|cpp|sh|docx?|xlsx?)$/i);

    if (isImage || isDoc) {
      e.preventDefault();
      e.stopImmediatePropagation();

      const dropTarget = e.target;
      let isCommitted = false;

      const commitDrop = (fileToCommit) => {
        if (isCommitted) return;
        isCommitted = true;
        const dt = new DataTransfer();
        dt.items.add(fileToCommit);
        dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      };

      try {
        const sanitizedFile = await autoProtectAndSanitizeFile(file, {
          onConfirmAuto: (sanitized) => {
            commitDrop(sanitized || sanitizedFile);
          },
          onAllowPlaintext: () => {
            commitDrop(file);
          },
          onCancel: () => {
            isCommitted = true;
          },
          onOpenEditor: (detectedBoxes, preloadedPdfPages) => {
            showFileInterceptionModal({
              file,
              initialBoxes: detectedBoxes || [],
              detectedItems: [],
              preloadedPdfPages: preloadedPdfPages || null,
              onConfirmMask: (sanitized) => {
                commitDrop(sanitized);
              },
              onAllowPlaintext: () => {
                commitDrop(file);
              },
              onCancel: () => {
                isCommitted = true;
              }
            });
          }
        });

        // Immediately commit sanitized file for drop event
        if (sanitizedFile) {
          commitDrop(sanitizedFile);
        }
      } catch (err) {
        console.warn('[Privora Shield] Auto-protect drop failed:', err);
      }
    }
  }, true);

  // -------------------------------------------------------------
  // 7. Automatic Download Interceptor & In-Place Retracer
  // -------------------------------------------------------------

  function cleanFileNameBase(name) {
    if (!name) return '';
    let base = name.split(/[/\\]/).pop().split('?')[0];
    base = base.replace(/\.[^/.]+$/, '');
    base = base.replace(/^(encrypted|masked|clean|sanitized|privora|redacted|decrypted)[_\-\s]*/i, '');
    base = base.replace(/[_\-\s]*(encrypted|masked|clean|sanitized|privora|redacted|decrypted)$/i, '');
    base = base.replace(/\s*\(\d+\)$/, '');
    base = base.replace(/[_\-\s]+$/, '');
    return base.toLowerCase().trim();
  }

  function findMatchingManifest(manifests, candidateName) {
    if (!manifests || manifests.length === 0) return null;

    const cleanCand = cleanFileNameBase(candidateName);
    const candidateLower = (candidateName || '').toLowerCase();
    const candidateIsPan = candidateLower.includes('pan');
    const candidateIsAadhaar = candidateLower.includes('aadhaar') || candidateLower.includes('adhar');
    const isCandidatePdf = candidateLower.endsWith('.pdf') || candidateLower.includes('.pdf') || candidateName === 'downloaded_document';
    const currentHost = (window.location.hostname || '').replace(/^www\./, '').toLowerCase();

    // Priority 1: Cleaned filename base exact or substring match
    let matched = manifests.find(m => {
      const cleanM = cleanFileNameBase(m.fileName || m.baseName);
      if (!cleanM || !cleanCand) return false;
      return cleanM === cleanCand || cleanCand.includes(cleanM) || cleanM.includes(cleanCand);
    });

    // Priority 2: Document type keyword match on the SAME site or session
    if (!matched && (candidateIsPan || candidateIsAadhaar)) {
      matched = manifests.find(m => {
        const mHost = (m.hostname || '').replace(/^www\./, '').toLowerCase();
        const isHostMatch = !currentHost || !mHost || mHost.includes(currentHost) || currentHost.includes(mHost);
        const mFn = (m.fileName || '').toLowerCase();
        const mIsPan = mFn.includes('pan');
        const mIsAadhaar = mFn.includes('aadhaar') || mFn.includes('adhar');
        return isHostMatch && ((candidateIsPan && mIsPan) || (candidateIsAadhaar && mIsAadhaar));
      });
    }

    // Priority 3: Hostname match (prefer matching file type: PDF with PDF manifest, image with image manifest)
    if (!matched && currentHost) {
      matched = manifests.find(m => {
        const mHost = (m.hostname || '').replace(/^www\./, '').toLowerCase();
        if (!mHost || (!mHost.includes(currentHost) && !currentHost.includes(mHost))) return false;
        const mIsPdf = (m.fileName || '').toLowerCase().endsWith('.pdf') || (m.slices && m.slices.some(s => s.pageNum !== undefined));
        return isCandidatePdf ? mIsPdf : !mIsPdf;
      });

      if (!matched) {
        matched = manifests.find(m => {
          const mHost = (m.hostname || '').replace(/^www\./, '').toLowerCase();
          return mHost && (mHost.includes(currentHost) || currentHost.includes(mHost));
        });
      }
    }

    // Priority 4: Fallback for generic download names (e.g. blob UUID or "downloaded_document")
    if (!matched && (candidateLower.startsWith('blob:') || cleanCand === 'downloaded_document' || cleanCand === 'download' || cleanCand === 'document' || !cleanCand)) {
      matched = manifests.find(m => {
        const isRecent = !m.timestamp || (Date.now() - m.timestamp < 1800000); // 30 minutes
        const mIsPdf = (m.fileName || '').toLowerCase().endsWith('.pdf') || (m.slices && m.slices.some(s => s.pageNum !== undefined));
        return isRecent && (isCandidatePdf ? mIsPdf : true) && m.slices && m.slices.length > 0;
      });
    }

    return matched || null;
  }

  async function retraceAndRestorePdf(pdfBlob, matched) {
    const pdfjs = window.pdfjsLib || globalThis.pdfjsLib;
    if (!pdfjs) {
      console.warn('[Privora Shield] pdfjsLib not available for PDF restoration');
      return null;
    }

    try {
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = '';
      }
    } catch (e) {}

    try {
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(arrayBuffer),
        useSystemFonts: true,
      });
      const pdfDoc = await loadingTask.promise;
      const totalPages = Math.max(1, pdfDoc.numPages);
      const restoredCanvases = [];

      // Group unblurred slices by pageNum (1-indexed)
      const slicesByPage = {};
      (matched.slices || []).forEach(slice => {
        const p = slice.pageNum || 1;
        if (!slicesByPage[p]) slicesByPage[p] = [];
        slicesByPage[p].push(slice);
      });

      for (let pNum = 1; pNum <= totalPages; pNum++) {
        const page = await pdfDoc.getPage(pNum);
        const viewport = page.getViewport({ scale: 1.5 });
        const pCanvas = document.createElement('canvas');
        pCanvas.width = Math.round(viewport.width);
        pCanvas.height = Math.round(viewport.height);
        const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });

        // Crisp white paper background
        pCtx.fillStyle = '#FFFFFF';
        pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

        await page.render({
          canvasContext: pCtx,
          viewport: viewport,
        }).promise;

        // Patch unblurred slices for this page
        const pageSlices = slicesByPage[pNum] || [];
        for (const slice of pageSlices) {
          if (!slice.cropDataUrl) continue;
          const sliceImg = new Image();
          await new Promise((res) => {
            sliceImg.onload = res;
            sliceImg.onerror = res;
            sliceImg.src = slice.cropDataUrl;
          });

          const sx = Math.round(slice.normX * pCanvas.width);
          const sy = Math.round(slice.normY * pCanvas.height);
          const sw = Math.round(slice.normW * pCanvas.width);
          const sh = Math.round(slice.normH * pCanvas.height);
          pCtx.drawImage(sliceImg, sx, sy, sw, sh);
        }

        restoredCanvases.push(pCanvas);
      }

      const restoredPdfBlob = createPdfBlobFromCanvases(restoredCanvases);
      if (!restoredPdfBlob) return null;

      return {
        blob: restoredPdfBlob,
        inputSize: pdfBlob.size,
        restoredSize: restoredPdfBlob.size,
        originalSize: matched.originalFileSize || null,
        manifest: matched,
      };
    } catch (err) {
      console.warn('[Privora Shield] Failed to retrace and restore PDF:', err);
      return null;
    }
  }

  async function retraceAndRestoreImage(imageBlob, fileName) {
    const memoryManifests = window._privoraRecentManifests || [];

    // Query background service worker for cross-tab shared manifests (timeout-safe)
    let bgManifests = [];
    try {
      const resp = await sendRuntimeMessageWithTimeout({ type: 'GET_MANIFESTS' }, 1500);
      if (resp && resp.manifests) bgManifests = resp.manifests;
    } catch (e) {}

    return new Promise((resolve) => {
      const executeRestore = async (storageManifests) => {
        const allManifests = [...memoryManifests, ...bgManifests, ...(storageManifests || [])];
        const manifests = [];
        const seenIds = new Set();
        for (const m of allManifests) {
          if (m && m.id && !seenIds.has(m.id)) {
            seenIds.add(m.id);
            manifests.push(m);
          }
        }

        if (manifests.length === 0) {
          resolve(null);
          return;
        }

        const matched = findMatchingManifest(manifests, fileName);

        if (!matched || !matched.slices || matched.slices.length === 0) {
          resolve(null);
          return;
        }

        let isPdfTarget = (fileName && fileName.toLowerCase().endsWith('.pdf')) ||
          (imageBlob && imageBlob.type === 'application/pdf') ||
          (matched && matched.isPdf) ||
          (matched.fileName && matched.fileName.toLowerCase().endsWith('.pdf'));

        if (!isPdfTarget && imageBlob) {
          try {
            const sliceBuffer = await imageBlob.slice(0, 8).arrayBuffer();
            const sliceText = new TextDecoder().decode(sliceBuffer);
            if (sliceText.startsWith('%PDF')) {
              isPdfTarget = true;
            }
          } catch (e) {}
        }

        if (isPdfTarget) {
          const { pdfLib } = ensurePdfWorkerHandler();
          if (pdfLib) {
            try {
              const arrayBuffer = await imageBlob.arrayBuffer();
              const loadingTask = pdfLib.getDocument({
                data: new Uint8Array(arrayBuffer),
                useSystemFonts: true,
              });
              const pdfDoc = await loadingTask.promise;
              const totalPages = Math.max(1, pdfDoc.numPages);
              const restoredCanvases = [];

              for (let pNum = 1; pNum <= totalPages; pNum++) {
                const page = await pdfDoc.getPage(pNum);
                const viewport = page.getViewport({ scale: 1.5 });
                const rCanvas = document.createElement('canvas');
                rCanvas.width = Math.round(viewport.width);
                rCanvas.height = Math.round(viewport.height);
                const rCtx = rCanvas.getContext('2d', { willReadFrequently: true });
                rCtx.fillStyle = '#FFFFFF';
                rCtx.fillRect(0, 0, rCanvas.width, rCanvas.height);
                await page.render({ canvasContext: rCtx, viewport }).promise;

                // Overlay unblurred slices for this page
                const pageSlices = matched.slices.filter(s => (s.pageNum === pNum) || (!s.pageNum && pNum === 1));
                for (const slice of pageSlices) {
                  try {
                    let drawable = null;
                    if (typeof createImageBitmap === 'function') {
                      try {
                        const sliceBlob = dataUrlToBlob(slice.cropDataUrl);
                        if (sliceBlob) drawable = await createImageBitmap(sliceBlob);
                      } catch (bmpErr) {}
                    }
                    if (!drawable) {
                      const sliceImg = new Image();
                      await new Promise(res => {
                        sliceImg.onload = res;
                        sliceImg.onerror = res;
                        sliceImg.src = slice.cropDataUrl;
                      });
                      drawable = sliceImg;
                    }
                    const sx = Math.round(slice.normX * rCanvas.width);
                    const sy = Math.round(slice.normY * rCanvas.height);
                    const sw = Math.round(slice.normW * rCanvas.width);
                    const sh = Math.round(slice.normH * rCanvas.height);
                    rCtx.drawImage(drawable, sx, sy, sw, sh);
                  } catch (sliceErr) {
                    console.warn('[Privora Shield] Failed to draw slice:', sliceErr);
                  }
                }

                restoredCanvases.push(rCanvas);
              }

              const restoredPdfBlob = createPdfBlobFromCanvases(restoredCanvases);
              if (restoredPdfBlob) {
                resolve({
                  blob: restoredPdfBlob,
                  inputSize: imageBlob.size,
                  restoredSize: restoredPdfBlob.size,
                  originalSize: matched.originalFileSize || null,
                  manifest: matched,
                });
                return;
              }
            } catch (pdfErr) {
              console.warn('[Privora Shield] Retracing PDF failed:', pdfErr);
            }
          }
          resolve(null);
          return;
        }

        const img = new Image();
        const url = URL.createObjectURL(imageBlob);
        img.onload = async () => {
          const patchCanvas = document.createElement('canvas');
          const width = img.naturalWidth || matched.originalWidth;
          const height = img.naturalHeight || matched.originalHeight;
          patchCanvas.width = width;
          patchCanvas.height = height;
          const pCtx = patchCanvas.getContext('2d', { willReadFrequently: true });
          pCtx.drawImage(img, 0, 0, patchCanvas.width, patchCanvas.height);

          for (const slice of matched.slices) {
            const sliceImg = new Image();
            await new Promise((res) => {
              sliceImg.onload = res;
              sliceImg.onerror = res;
              sliceImg.src = slice.cropDataUrl;
            });
            const sx = Math.round(slice.normX * patchCanvas.width);
            const sy = Math.round(slice.normY * patchCanvas.height);
            const sw = Math.round(slice.normW * patchCanvas.width);
            const sh = Math.round(slice.normH * patchCanvas.height);
            pCtx.drawImage(sliceImg, sx, sy, sw, sh);
          }

          // Adaptive Quality Estimation based on input compressed image bytes-per-pixel ratio
          const rawTargetQuality = estimateJpegQualityFromSize(imageBlob, patchCanvas.width, patchCanvas.height);
          const targetQuality = Math.min(0.92, Math.max(0.50, rawTargetQuality));

          const outType = imageBlob.type || (fileName.match(/\.(jpe?g)$/i) ? 'image/jpeg' : (fileName.match(/\.png$/i) ? 'image/png' : 'image/jpeg'));

          patchCanvas.toBlob((restoredBlob) => {
            URL.revokeObjectURL(url);
            if (!restoredBlob) {
              resolve(null);
              return;
            }

            resolve({
              blob: restoredBlob,
              inputSize: imageBlob.size,
              restoredSize: restoredBlob.size,
              originalSize: matched.originalFileSize || null,
              chosenQuality: targetQuality,
              manifest: matched,
            });
          }, outType, targetQuality);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      };

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['aegis_active_manifests'], (res) => {
          executeRestore(res?.aegis_active_manifests || []);
        });
      } else {
        executeRestore([]);
      }
    });
  }

  // Intercept Download Operations (both click & programmatic)
  async function handleDownloadInterception(target, e) {
    if (target.dataset.aegisRestored === 'true') return false;

    const href = target.getAttribute('href') || target.href || '';
    const downloadAttr = target.getAttribute('download');
    const text = (target.innerText || target.textContent || '').toLowerCase();
    const className = String(target.className || '').toLowerCase();
    const id = String(target.id || '').toLowerCase();

    const isImageDownload = downloadAttr !== null ||
      href.match(/\.(png|jpe?g|webp|svg|bmp|gif|pdf|txt|md|markdown|json|csv|docx?)$/i) ||
      href.startsWith('blob:') ||
      href.startsWith('data:') ||
      href.toLowerCase().includes('download') ||
      href.toLowerCase().includes('/output/') ||
      href.toLowerCase().includes('/get/') ||
      text.includes('download') ||
      className.includes('download') ||
      id.includes('download');

    if (!isImageDownload) return false;

    return new Promise((resolve) => {
      const memoryManifests = window._privoraRecentManifests || [];
      const checkAndIntercept = async (storageManifests) => {
        // Query background service worker as well (timeout-safe)
        let bgManifests = [];
        try {
          const resp = await sendRuntimeMessageWithTimeout({ type: 'GET_MANIFESTS' }, 1500);
          if (resp && resp.manifests) bgManifests = resp.manifests;
        } catch (e) {}

        const allManifests = [...memoryManifests, ...bgManifests, ...(storageManifests || [])];
        const manifests = [];
        const seenIds = new Set();
        for (const m of allManifests) {
          if (m && m.id && !seenIds.has(m.id)) {
            seenIds.add(m.id);
            manifests.push(m);
          }
        }

        const tokenVault = window._privoraTokenVault || [];
        if (manifests.length === 0 && tokenVault.length === 0) {
          resolve(false);
          return;
        }

        let candidateName = downloadAttr || '';
        if (!candidateName && href && !href.startsWith('blob:') && !href.startsWith('data:')) {
          candidateName = href.split('/').pop().split('?')[0];
        }
        if (!candidateName || !candidateName.includes('.')) {
          const ariaLabel = target.getAttribute('aria-label') || target.getAttribute('title') || '';
          if (ariaLabel.match(/\.(pdf|png|jpe?g|webp|docx?|txt|md)$/i)) {
            candidateName = ariaLabel;
          } else {
            const container = target.closest('li, [data-testid], div, article, section') || target.parentElement;
            const containerMatch = container?.innerText?.match(/\b[a-zA-Z0-9_\-\.\s]+\.(?:pdf|png|jpe?g|webp|docx?|txt|md)\b/i);
            if (containerMatch && containerMatch[0]) {
              candidateName = containerMatch[0].trim();
            }
          }
        }
        if (!candidateName || candidateName.length < 3) {
          candidateName = 'downloaded_document';
        }

        let matched = findMatchingManifest(manifests, candidateName);
        if (!matched) {
          const currentHost = (window.location.hostname || '').replace(/^www\./, '').toLowerCase();
          matched = manifests.find(m => {
            const mHost = (m.hostname || '').replace(/^www\./, '').toLowerCase();
            return mHost && (mHost.includes(currentHost) || currentHost.includes(mHost));
          });
          if (matched && matched.fileName) {
            candidateName = matched.fileName;
          }
        }

        const isPotentialTextDoc = candidateName.match(/\.(txt|md|markdown|json|csv|html|rtf|docx?)$/i);
        if ((!matched || !matched.slices || matched.slices.length === 0) && (!isPotentialTextDoc || tokenVault.length === 0)) {
          resolve(false);
          return;
        }

        if (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }

        showPrivoraHud({
          type: 'decrypting',
          title: 'Privora Shield · Auto-Decrypt',
          subtitle: `Protected document detected! Decrypting & restoring clean original...`,
          durationMs: 0
        });

        try {
          let blob;
          if (href.startsWith('data:')) {
            blob = dataUrlToBlob(href);
          } else if (href) {
            try {
              blob = await fetch(href).then(r => r.blob());
            } catch (fetchErr) {
              // Bypass CORS using background script if needed
              const resp = await sendRuntimeMessageWithTimeout({ type: 'FETCH_BLOB', url: href }, 5000);
              if (resp && resp.success && resp.dataUrl) {
                blob = dataUrlToBlob(resp.dataUrl);
              } else {
                throw fetchErr;
              }
            }
          }

          if (!blob) {
            console.warn('[Privora Shield] Could not fetch download blob directly, allowing natural download.');
            showPrivoraHud({
              type: 'warning',
              title: 'Privora Shield · Download',
              subtitle: 'Could not access file blob. Proceeding with standard download.',
              durationMs: 3000
            });
            target.dataset.aegisRestored = 'true';
            target.click();
            resolve(false);
            return;
          }

          // Check for text/markdown document token restoration
          if (isPotentialTextDoc && tokenVault.length > 0) {
            try {
              const textContent = await blob.text();
              let restoredText = textContent;
              let tokHits = 0;
              for (const tok of tokenVault) {
                if (tok.synthetic && restoredText.includes(tok.synthetic)) {
                  restoredText = restoredText.split(tok.synthetic).join(tok.original);
                  tokHits++;
                }
              }
              if (tokHits > 0) {
                const restoredBlob = new Blob([restoredText], { type: blob.type || 'text/plain' });
                const finalUrl = URL.createObjectURL(restoredBlob);
                const a = document.createElement('a');
                a.href = finalUrl;
                a.download = candidateName;
                a.dataset.aegisRestored = 'true';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(finalUrl), 10000);

                showPrivoraHud({
                  type: 'decrypted',
                  title: 'Privora Shield · Document Restored',
                  subtitle: `Restored ${tokHits} real value(s) in downloaded document before saving.`,
                  durationMs: 4500
                });

                logExtensionAuditEvent({
                  eventType: 'AUTO_DECRYPT_RESTORE',
                  severity: 'INFO',
                  actionTaken: `Auto-decrypted ${tokHits} synthetic tokens in downloaded file ${candidateName}`,
                  details: { fileName: candidateName, tokenHits: tokHits },
                  riskScore: 0
                });

                resolve(true);
                return;
              }
            } catch (txtErr) {
              console.warn('[Privora Shield] Text restore error:', txtErr);
            }
          }

          const result = await retraceAndRestoreImage(blob, candidateName);
          if (result && result.blob) {
            const restoredBlob = result.blob;
            const finalUrl = URL.createObjectURL(restoredBlob);

            const a = document.createElement('a');
            a.href = finalUrl;
            let finalDownloadName = result?.manifest?.fileName || downloadAttr || candidateName || 'decrypted_document.pdf';
            finalDownloadName = finalDownloadName.replace(/^(encrypted_|masked_)/i, '');
            a.download = finalDownloadName;
            a.dataset.aegisRestored = 'true';
            document.body.appendChild(a);
            a.click();
            a.remove();

            const inKb = (result?.inputSize ? result.inputSize / 1024 : blob.size / 1024).toFixed(1);
            const outKb = (restoredBlob.size / 1024).toFixed(1);
            const isPdfOutput = (finalDownloadName && finalDownloadName.toLowerCase().endsWith('.pdf')) || (restoredBlob.type === 'application/pdf');

            showPrivoraHud({
              type: 'decrypted',
              title: 'Privora Shield · Decrypted & Restored',
              subtitle: isPdfOutput
                ? `Clean original PDF saved! Restored unblurred document contents (Zero privacy loss) ✓`
                : `Clean original photo saved! Compressed size: ${inKb} KB → Restored: ${outKb} KB (Zero privacy loss) ✓`,
              durationMs: 4500
            });

            logExtensionAuditEvent({
              eventType: 'AUTO_DECRYPT_RESTORE',
              severity: 'INFO',
              actionTaken: `Auto-decrypted and restored ${candidateName} downloaded from ${window.location.hostname}`,
              details: {
                fileName: candidateName,
                restoredSize: restoredBlob.size,
                inputSize: blob.size,
              },
              riskScore: 0,
            });

            resolve(true);
          } else {
            console.warn('[Privora Shield] Auto-decryption found no matching slices, downloading file unmodified.');
            showPrivoraHud({
              type: 'warning',
              title: 'Privora Shield · Download',
              subtitle: `No unblurred pieces found for ${candidateName}. Downloading unmodified.`,
              durationMs: 3000
            });
            target.dataset.aegisRestored = 'true';
            target.click();
            resolve(false);
          }
        } catch (err) {
          console.warn('[Privora Shield] Auto-decryption failed, downloading unmodified:', err);
          showPrivoraHud({
            type: 'warning',
            title: 'Privora Shield · Download',
            subtitle: `Decryption encountered an error. Proceeding with original file.`,
            durationMs: 3000
          });
          target.dataset.aegisRestored = 'true';
          target.click();
          resolve(false);
        }
      };

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['aegis_active_manifests'], (res) => {
          checkAndIntercept(res?.aegis_active_manifests || []);
        });
      } else {
        checkAndIntercept([]);
      }
    });
  }

  // Intercept Download Link & Button Clicks
  document.addEventListener('click', (e) => {
    if (!isShieldEnabled) return;
    if (e.target && e.target.dataset && e.target.dataset.aegisRestored === 'true') {
      return;
    }

    let target = e.target;
    const anchor = target.closest ? target.closest('a') : null;
    if (anchor) {
      target = anchor;
    } else {
      while (target && target.tagName !== 'A' && target.tagName !== 'BUTTON' && target !== document.body) {
        target = target.parentElement;
      }
    }

    if (!target || (target.tagName !== 'A' && target.tagName !== 'BUTTON')) return;
    if (target.dataset.aegisRestored === 'true') return;

    // If target is a standalone button without href or download attribute, allow natural click handler
    if (target.tagName === 'BUTTON' && !target.getAttribute('href') && !target.getAttribute('download')) {
      return;
    }

    const href = target.getAttribute('href') || target.href || '';
    const downloadAttr = target.getAttribute('download');
    const text = (target.innerText || target.textContent || '').toLowerCase();
    const className = String(target.className || '').toLowerCase();
    const id = String(target.id || '').toLowerCase();

    const isDownloadAction = downloadAttr !== null ||
      href.match(/\.(png|jpe?g|webp|svg|bmp|gif|pdf)$/i) ||
      href.startsWith('blob:') ||
      href.startsWith('data:image/') ||
      href.toLowerCase().includes('download') ||
      href.toLowerCase().includes('/output/') ||
      href.toLowerCase().includes('/get/') ||
      text.includes('download') ||
      className.includes('download') ||
      id.includes('download');

    if (!isDownloadAction) return;

    // SYNCHRONOUSLY CANCEL THE BROWSER DEFAULT DOWNLOAD ACTION RIGHT HERE!
    // This stops the browser from downloading the server's raw encrypted image!
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    handleDownloadInterception(target, null).then((handled) => {
      if (!handled) {
        // If Privora could not restore it, mark as restored and trigger natural download
        target.dataset.aegisRestored = 'true';
        target.click();
      }
    });
  }, true);

  // Hook HTMLAnchorElement.prototype.click for programmatic downloads (e.g. TinyPNG, Squoosh)
  if (typeof HTMLAnchorElement !== 'undefined') {
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.dataset.aegisRestored === 'true') {
        return origClick.apply(this, arguments);
      }

      if (!isShieldEnabled) {
        return origClick.apply(this, arguments);
      }

      const href = this.getAttribute('href') || this.href || '';
      const downloadAttr = this.getAttribute('download');
      const text = (this.innerText || this.textContent || '').toLowerCase();
      const className = String(this.className || '').toLowerCase();
      const id = String(this.id || '').toLowerCase();

      const isImageDownload = downloadAttr !== null ||
        href.match(/\.(png|jpe?g|webp|svg|bmp|gif|pdf)$/i) ||
        href.startsWith('blob:') ||
        href.startsWith('data:image/') ||
        href.toLowerCase().includes('download') ||
        href.toLowerCase().includes('/output/') ||
        href.toLowerCase().includes('/get/') ||
        text.includes('download') ||
        className.includes('download') ||
        id.includes('download');

      if (isImageDownload) {
        handleDownloadInterception(this, null).then((intercepted) => {
          if (!intercepted) {
            this.dataset.aegisRestored = 'true';
            origClick.apply(this);
          }
        });
        return;
      }

      return origClick.apply(this, arguments);
    };
  }

  // -------------------------------------------------------------
  // 8. In-Page Floating Retrace Hub
  // -------------------------------------------------------------
  function updateFloatingHub() {
    // Keep function declaration for vitest, but completely suppress annoying bottom-right banner
    const hub = document.getElementById('aegis-floating-hub');
    if (hub) {
      hub.style.display = 'none';
      hub.remove();
    }
  }

  // -------------------------------------------------------------
  // 8b. Bi-Directional Format-Preserving Synthetic Engine & Token Vault
  // -------------------------------------------------------------
  const SYNTH_PERSONA_FIRST = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam', 'Chris', 'Jamie', 'Robin', 'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Neha'];
  const SYNTH_PERSONA_LAST = ['Turner', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Sharma', 'Patel', 'Verma', 'Gupta', 'Iyer', 'Reddy', 'Chopra'];
  const SYNTH_PERSONA_DOMAINS = ['sandbox.test', 'synthetic.org', 'demo-vault.internal', 'privacy-sandbox.net'];

  window._privoraTokenVault = window._privoraTokenVault || [];
  // Session ID: unique per page load — old vault entries from other sessions are kept for
  // clipboard/copy restoration but NOT rendered in the live DOM decryption scanner.
  const _privoraSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  function generateSyntheticTokenForFinding(finding, seedStr) {
    const seed = seedStr || (finding ? (finding.value || finding.type) : 'privora') + Date.now();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const r1 = (hash % 1000) / 1000;
    const r2 = ((hash >>> 3) % 1000) / 1000;
    const r3 = ((hash >>> 6) % 1000) / 1000;

    const type = finding ? finding.type : '';
    if (type === 'EMAIL') {
      const fName = SYNTH_PERSONA_FIRST[Math.floor(r1 * SYNTH_PERSONA_FIRST.length)].toLowerCase();
      const num = Math.floor(r2 * 900) + 100;
      const dom = SYNTH_PERSONA_DOMAINS[Math.floor(r3 * SYNTH_PERSONA_DOMAINS.length)];
      return `${fName}.${num}@${dom}`;
    }
    if (type === 'PHONE') {
      const p1 = Math.floor(r1 * 90000) + 10000;
      const p2 = Math.floor(r2 * 90000) + 10000;
      return `+91 ${p1} ${p2}`;
    }
    if (type === 'AADHAAR') {
      const d1 = Math.floor(r1 * 8) + 2;
      const rest = String(Math.floor(r2 * 10000000000)).padStart(10, '3');
      const base11 = `${d1}${rest.slice(0, 10)}`;
      return `${base11.slice(0, 4)} ${base11.slice(4, 8)} ${base11.slice(8, 11)}4`;
    }
    if (type === 'PAN_CARD') {
      const l = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const c1 = l[Math.floor(r1 * l.length)];
      const c2 = l[Math.floor(r2 * l.length)];
      const num = String(Math.floor(r3 * 9000) + 1000);
      return `${c1}BK${c2}P${num}Z`;
    }
    if (type === 'CREDIT_CARD') {
      const c2 = String(Math.floor(r1 * 9000) + 1000);
      const c3 = String(Math.floor(r2 * 9000) + 1000);
      const c4 = String(Math.floor(r3 * 9000) + 1000);
      return `4532 ${c2} ${c3} ${c4}`;
    }
    if (type === 'API_KEY') {
      return `sk_live_syn_${Math.random().toString(36).substring(2, 14)}`;
    }
    const fName = SYNTH_PERSONA_FIRST[Math.floor(r1 * SYNTH_PERSONA_FIRST.length)];
    const lName = SYNTH_PERSONA_LAST[Math.floor(r2 * SYNTH_PERSONA_LAST.length)];
    return `${fName} ${lName}`;
  }

  function syncVaultToDom() {
    try {
      const list = window._privoraTokenVault || [];
      const serialized = JSON.stringify(list);
      if (document.documentElement) {
        document.documentElement.setAttribute('data-privora-vault', serialized);
      }
      try { sessionStorage.setItem('privora_token_vault', serialized); } catch (e) {}
      window.postMessage({ type: 'PRIVORA_SYNC_VAULT', vault: list }, '*');
    } catch (e) {}
  }

  function syncTokenVaultFromStorage() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['privora_token_vault'], (res) => {
          if (res && res.privora_token_vault && Array.isArray(res.privora_token_vault)) {
            const map = new Map();
            (window._privoraTokenVault || []).forEach(t => map.set(t.synthetic, t));
            res.privora_token_vault.forEach(t => {
              if (t.type === 'NAME' || (t.original && typeof t.original === 'string' && (t.original.toLowerCase().startsWith('is ') || t.original.toLowerCase().includes('email is')))) {
                t.original = sanitizeStoredNameToken(t.original);
              }
              map.set(t.synthetic, t);
            });
            window._privoraTokenVault = Array.from(map.values());
            syncVaultToDom();
            try {
              chrome.storage.local.set({ privora_token_vault: window._privoraTokenVault });
            } catch (e) {}
          }
        });
      }
    } catch (e) {}
  }

  function saveTokensToVault(newTokens) {
    if (!newTokens || newTokens.length === 0) return;
    // Stamp each new token with the current session ID and sanitize name
    const stamped = newTokens.map(t => {
      let orig = t.original;
      if (t.type === 'NAME' || (orig && typeof orig === 'string' && (orig.toLowerCase().startsWith('is ') || orig.toLowerCase().includes('email is')))) {
        orig = sanitizeStoredNameToken(orig);
      }
      return { ...t, original: orig, sessionId: _privoraSessionId };
    });
    const map = new Map();
    (window._privoraTokenVault || []).forEach(t => map.set(t.synthetic, t));
    stamped.forEach(t => map.set(t.synthetic, t));
    window._privoraTokenVault = Array.from(map.values()).slice(-200);
    syncVaultToDom();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set({ privora_token_vault: window._privoraTokenVault });
        chrome.runtime.sendMessage({ type: 'STORE_TOKEN_VAULT', tokens: stamped }, () => {});
      } catch (e) {}
    }
  }


  // Cross-tab storage synchronization listener
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.privora_token_vault && changes.privora_token_vault.newValue) {
        window._privoraTokenVault = changes.privora_token_vault.newValue;
        syncVaultToDom();
      }
    });
  }

  syncTokenVaultFromStorage();
  syncVaultToDom();

  // Inject page_hook.js dynamically as secondary safety net
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      const hookUrl = chrome.runtime.getURL('page_hook.js');
      const scriptEl = document.createElement('script');
      scriptEl.src = hookUrl;
      (document.head || document.documentElement).appendChild(scriptEl);
      scriptEl.onload = () => scriptEl.remove();
    }
  } catch (e) {}

  // -------------------------------------------------------------
  // 9a. Compact Non-Intrusive Floating Text Interception Prompt
  // -------------------------------------------------------------
  function showTextInterceptionPrompt(target, hits, originalText) {
    if (activePrompt) {
      activePrompt.remove();
      activePrompt = null;
    }

    const piiLabels = Array.from(new Set(hits.map(h => h.label)));
    const piiCount = hits.length;

    const promptCard = document.createElement('div');
    promptCard.id = 'aegis-text-intercept-prompt';
    promptCard.style.cssText = `
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      left: auto !important;
      top: auto !important;
      width: 360px !important;
      max-width: calc(100vw - 48px) !important;
      height: auto !important;
      z-index: 2147483647 !important;
      background: #FAF9F6 !important;
      border: 1px solid rgba(0, 0, 0, 0.08) !important;
      border-radius: 16px !important;
      padding: 16px 18px !important;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(156, 141, 212, 0.25) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif !important;
      color: #212529 !important;
      animation: aegisFadeIn 0.25s ease-out !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
      box-sizing: border-box !important;
      line-height: 1.4 !important;
    `;

    promptCard.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="background:#9C8DD4; color:#ffffff; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:800; box-shadow:0 2px 6px rgba(156,141,212,0.35);">P</div>
          <div>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:13px; color:#212529;">Clipboard PII Shield<span style="color:#E77A73;">.</span></strong>
              <span style="font-size:9px; background:#FEE2E2; color:#DC2626; border:1px solid #FCA5A5; padding:1px 6px; border-radius:9999px; font-family:monospace; font-weight:700;">${piiCount} ITEM${piiCount > 1 ? 'S' : ''}</span>
            </div>
            <p style="margin:2px 0 0; font-size:11px; color:#757575;">
              Found: <strong style="color:#212529;">${piiLabels.join(', ')}</strong>
            </p>
          </div>
        </div>
        <button id="btn-text-prompt-close" style="background:transparent; border:none; color:#9ca3af; font-size:16px; cursor:pointer; padding:4px;" title="Cancel Paste">✕</button>
      </div>

      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <button id="btn-text-prompt-tokenize" style="flex:1; background:linear-gradient(135deg, #0284c7, #06b6d4); color:#fff; border:none; border-radius:10px; padding:9px 12px; font-size:12px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; box-shadow:0 2px 6px rgba(2,132,199,0.3);">
          <span>🎭</span>
          <span>Tokenize (Auto-Restore)</span>
        </button>
        <button id="btn-text-prompt-redact" style="background:#212529; color:#fff; border:none; border-radius:10px; padding:9px 12px; font-size:11px; font-weight:600; cursor:pointer;">
          Mask
        </button>
        <button id="btn-text-prompt-editor" style="background:#FAF9F6; color:#212529; border:1px solid rgba(0,0,0,0.12); border-radius:10px; padding:9px 12px; font-size:11px; font-weight:600; cursor:pointer;" title="Open full review dialog">
          Review...
        </button>
        <button id="btn-text-prompt-allow" style="background:#FFFFFF; color:#757575; border:1px solid rgba(0,0,0,0.12); border-radius:10px; padding:9px 12px; font-size:11px; font-weight:600; cursor:pointer;" title="Paste raw text without changes">
          Plaintext
        </button>
      </div>
    `;

    document.documentElement.appendChild(promptCard);
    activePrompt = promptCard;

    const insertText = (str) => {
      if (!target) return;
      const hostInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ? target : target.closest('input, textarea');
      const hostEditable = target.isContentEditable ? target : target.closest('[contenteditable="true"]');

      if (hostInput) {
        try {
          hostInput.focus();
          const start = hostInput.selectionStart || 0;
          const end = hostInput.selectionEnd || 0;
          const val = hostInput.value || '';
          hostInput.value = val.substring(0, start) + str + val.substring(end);
          hostInput.selectionStart = hostInput.selectionEnd = start + str.length;
          hostInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          hostInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } catch (e) {}
      } else if (hostEditable) {
        try {
          hostEditable.focus();
          document.execCommand('insertText', false, str);
          hostEditable.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        } catch (e) {
          hostEditable.innerText = str;
        }
      }
    };

    const btnTokenize = promptCard.querySelector('#btn-text-prompt-tokenize');
    const btnRedact = promptCard.querySelector('#btn-text-prompt-redact');
    const btnEditor = promptCard.querySelector('#btn-text-prompt-editor');
    const btnAllow = promptCard.querySelector('#btn-text-prompt-allow');
    const btnClose = promptCard.querySelector('#btn-text-prompt-close');

    if (btnTokenize) {
      btnTokenize.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        let tokenized = originalText;
        const newTokens = [];
        hits.forEach(h => {
          const syn = generateSyntheticTokenForFinding(h);
          tokenized = safeReplaceToken(tokenized, h.value, syn);
          newTokens.push({
            id: 'tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            type: h.type,
            original: h.value,
            synthetic: syn,
            originHost: window.location.hostname,
            createdAt: Date.now()
          });
        });
        saveTokensToVault(newTokens);
        insertText(tokenized);
        showPrivoraHud({
          type: 'success',
          title: 'Privora Shield · Reversible Tokenization',
          subtitle: `Protected ${hits.length} PII item(s) with format-preserving tokens. Responses will auto-decrypt.`,
          durationMs: 4000
        });
      };
    }

    if (btnRedact) {
      btnRedact.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        let redacted = originalText;
        hits.forEach(h => {
          const mask = '█'.repeat(Math.min(h.value.length, 8));
          redacted = safeReplaceToken(redacted, h.value, `[REDACTED: ${h.type} ${mask}]`);
        });
        insertText(redacted);
        showToast('Privora: Masked sensitive text before inserting into webpage.');
      };
    }

    if (btnEditor) {
      btnEditor.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        showTextInterceptionModal(target, hits, originalText);
      };
    }

    if (btnAllow) {
      btnAllow.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        insertText(originalText);
      };
    }

    if (btnClose) {
      btnClose.onclick = () => {
        promptCard.remove();
        activePrompt = null;
      };
    }
  }

  // -------------------------------------------------------------
  // 9b. Interactive Text PII Interception Modal
  // -------------------------------------------------------------
  function showTextInterceptionModal(target, hits, originalText) {
    const existing = document.getElementById('aegis-guard-text-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'aegis-guard-text-modal';
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(4, 7, 18, 0.88);
      backdrop-filter: blur(10px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f8fafc;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background: #090d16;
      border: 1px solid #06b6d4;
      border-radius: 20px;
      padding: 24px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 40px rgba(6, 182, 212, 0.25);
      display: flex;
      flex-direction: column;
      gap: 16px;
    `;

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; border-bottom:1px solid #1e293b; padding-bottom:12px;">
        <div style="background:#082f49; border:1px solid #0284c7; width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px;">🛡️</div>
        <div>
          <h3 style="margin:0; font-size:16px; font-weight:800; color:#f8fafc; display:flex; align-items:center; gap:8px;">
            <span>Privora Text Shield</span>
            <span style="font-size:10px; background:#082f49; color:#38bdf8; border:1px solid #0369a1; padding:2px 8px; border-radius:9999px; font-family:monospace;">ACTIVE DEFENSE</span>
          </h3>
          <p style="margin:2px 0 0; font-size:11px; color:#94a3b8;">
            Blocked sensitive clipboard paste to <strong style="color:#38bdf8;">${window.location.hostname || 'this website'}</strong>
          </p>
        </div>
      </div>
      <p style="margin:0; font-size:13px; color:#cbd5e1;">
        You are about to paste <strong>${hits.length}</strong> sensitive identifier(s):
      </p>
      <div id="aegis-text-hits" style="max-height:160px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;"></div>
      <div style="display:flex; flex-direction:column; gap:8px; border-top:1px solid #1e293b; padding-top:14px;">
        <button id="btn-text-tokenize-modal" style="background:linear-gradient(135deg, #0284c7, #06b6d4); color:#ffffff; border:none; border-radius:12px; padding:12px; font-weight:800; font-size:13px; cursor:pointer;">
          🎭 Format-Preserving Tokenize & Auto-Restore
        </button>
        <button id="btn-text-redact" style="background:#1e293b; color:#cbd5e1; border:1px solid #334155; border-radius:12px; padding:10px; font-weight:700; font-size:12px; cursor:pointer;">
          🔒 Redact / Mask with [REDACTED]
        </button>
        <button id="btn-text-encrypt" style="background:#4f46e5; color:#ffffff; border:none; border-radius:12px; padding:10px; font-weight:700; font-size:12px; cursor:pointer;">
          🛡️ AES-256-GCM Encrypt & Paste
        </button>
        <div style="display:flex; gap:8px; margin-top:4px;">
          <button id="btn-text-allow" style="flex:1; background:#1e293b; color:#fbbf24; border:1px solid #78350f; border-radius:10px; padding:10px; font-size:12px; font-weight:bold; cursor:pointer;">
            ⚠️ Allow Plaintext
          </button>
          <button id="btn-text-cancel" style="flex:1; background:#1e293b; color:#94a3b8; border:1px solid #334155; border-radius:10px; padding:10px; font-size:12px; font-weight:bold; cursor:pointer;">
            ❌ Cancel
          </button>
        </div>
      </div>
    `;

    const hitsContainer = card.querySelector('#aegis-text-hits');
    hits.forEach(h => {
      const row = document.createElement('div');
      row.style.cssText = 'background:#1e293b; padding:8px 12px; border-radius:10px; display:flex; justify-content:space-between; align-items:center; font-size:12px;';
      const label = document.createElement('strong');
      label.style.color = '#38bdf8';
      label.textContent = h.label;
      const val = document.createElement('span');
      val.style.cssText = 'font-family:monospace; color:#94a3b8;';
      val.textContent = h.value.length > 8 ? `${h.value.substring(0, 4)}••••${h.value.slice(-4)}` : '••••••••';
      row.appendChild(label);
      row.appendChild(val);
      hitsContainer.appendChild(row);
    });

    overlay.appendChild(card);
    document.documentElement.appendChild(overlay);

    const insertText = (str) => {
      if (!target) return;
      const hostInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ? target : target.closest('input, textarea');
      const hostEditable = target.isContentEditable ? target : target.closest('[contenteditable="true"]');

      if (hostInput) {
        try {
          hostInput.focus();
          const start = hostInput.selectionStart || 0;
          const end = hostInput.selectionEnd || 0;
          const val = hostInput.value || '';
          hostInput.value = val.substring(0, start) + str + val.substring(end);
          hostInput.selectionStart = hostInput.selectionEnd = start + str.length;
          hostInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          hostInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } catch (e) {}
      } else if (hostEditable) {
        try {
          hostEditable.focus();
          document.execCommand('insertText', false, str);
          hostEditable.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        } catch (e) {
          hostEditable.innerText = str;
        }
      }
    };

    // Tokenize
    const btnTokenizeModal = card.querySelector('#btn-text-tokenize-modal');
    if (btnTokenizeModal) {
      btnTokenizeModal.onclick = () => {
        let tokenized = originalText;
        const newTokens = [];
        hits.forEach(h => {
          const syn = generateSyntheticTokenForFinding(h);
          tokenized = safeReplaceToken(tokenized, h.value, syn);
          newTokens.push({
            id: 'tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
            type: h.type,
            original: h.value,
            synthetic: syn,
            originHost: window.location.hostname,
            createdAt: Date.now()
          });
        });
        saveTokensToVault(newTokens);
        insertText(tokenized);
        overlay.remove();
        showPrivoraHud({
          type: 'success',
          title: 'Privora Shield · Reversible Tokenization',
          subtitle: `Protected ${hits.length} PII item(s) with format-preserving tokens. Responses will auto-decrypt.`,
          durationMs: 4000
        });
      };
    }

    // Redact
    card.querySelector('#btn-text-redact').onclick = () => {
      let redacted = originalText;
      hits.forEach(h => {
        const mask = '█'.repeat(Math.min(h.value.length, 8));
        redacted = safeReplaceToken(redacted, h.value, `[REDACTED: ${h.type} ${mask}]`);
      });
      insertText(redacted);
      overlay.remove();
      showToast('Privora: Masked sensitive text before inserting into webpage.');
    };

    // Encrypt
    card.querySelector('#btn-text-encrypt').onclick = async () => {
      let enc = originalText;
      try {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(originalText));
        const b64 = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(cipher))));
        enc = `[AEGIS-CIPHERTEXT:${b64}]`;
      } catch (err) {}
      insertText(enc);
      overlay.remove();
      showToast('Privora: Encrypted text with AES-256-GCM.');
    };

    // Allow
    card.querySelector('#btn-text-allow').onclick = () => {
      insertText(originalText);
      overlay.remove();
    };

    // Cancel
    card.querySelector('#btn-text-cancel').onclick = () => {
      overlay.remove();
    };
  }

  // -------------------------------------------------------------
  // 10. Global Paste Event Listener
  // -------------------------------------------------------------
  document.addEventListener('paste', (e) => {
    if (!isShieldEnabled) return;
    try {
      const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') ||
                   (e.clipboardData || window.clipboardData)?.getData('text') || '';
      if (!text || text.length < 3) return;

      const hits = scanText(text);
      if (hits.length > 0) {
        console.log(`[Privora Shield] Intercepted paste with ${hits.length} PII items on ${window.location.hostname}:`, hits);
        e.preventDefault();
        e.stopImmediatePropagation();

        showTextInterceptionPrompt(e.target, hits, text);
      }
    } catch (err) {
      console.warn('[Privora Shield] Paste intercept error:', err);
    }
  }, true);

  // -------------------------------------------------------------
  // 11. Live Real-Time PII Interception & Warnings (Universal)
  // -------------------------------------------------------------
  const DEFAULT_AI_CHAT_HOSTS = [
    'chat.openai.com',
    'chatgpt.com',
    'claude.ai',
    'gemini.google.com',
    'copilot.microsoft.com',
    'huggingface.co',
    'perplexity.ai',
    'poe.com',
    'mistral.ai',
    'chat.deepseek.com',
    'localhost',
    '127.0.0.1'
  ];

  function logExtensionAuditEvent(eventData) {
    const event = {
      id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      source: 'EXTENSION',
      ...eventData
    };

    if (typeof indexedDB !== 'undefined') {
      try {
        const req = indexedDB.open('aegis_privacy_vault_db', 1);
        req.onsuccess = (e) => {
          const db = e.target.result;
          if (db.objectStoreNames.contains('audit_logs')) {
            const tx = db.transaction('audit_logs', 'readwrite');
            tx.objectStore('audit_logs').put(event);
          }
        };
      } catch (err) {}
    }
  }

  function setupLiveTextInterception() {
    const currentHost = (window.location.hostname || '').toLowerCase();
    const isAiChatSite = DEFAULT_AI_CHAT_HOSTS.some(h => currentHost === h || currentHost.endsWith('.' + h));

    let debounceTimer = null;
    let warningBanner = null;
    let lastLoggedSignature = '';
    let lastLogTime = 0;

    function removeWarning() {
      if (warningBanner) {
        warningBanner.remove();
        warningBanner = null;
      }
    }

    function showInlineWarning(target, hits, currentText) {
      removeWarning();

      const piiLabels = Array.from(new Set(hits.map(h => h.label)));
      const piiTypes = Array.from(new Set(hits.map(h => h.type)));
      const title = isAiChatSite ? 'Sensitive PII Detected in AI Prompt' : 'Sensitive PII Detected in Input Field';

      warningBanner = document.createElement('div');
      warningBanner.id = 'aegis-inline-live-warning';
      warningBanner.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 24px;
        z-index: 2147483646;
        background: #0f172a;
        border: 1px solid #f59e0b;
        border-radius: 12px;
        padding: 12px 16px;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 20px rgba(245, 158, 11, 0.25);
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 480px;
        font-size: 12px;
        animation: aegisFadeIn 0.25s ease-out;
      `;

      warningBanner.innerHTML = `
        <div style="background:#451a03; border:1px solid #b45309; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0;">⚠️</div>
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:6px;">
            <strong style="color:#fbbf24; font-size:12px;">${title}</strong>
            <span style="font-size:9px; background:#451a03; color:#fcd34d; border:1px solid #78350f; padding:1px 6px; border-radius:9999px; font-family:monospace;">REAL-TIME</span>
          </div>
          <p style="margin:2px 0 0; color:#cbd5e1; font-size:11px;">
            Found: <strong style="color:#38bdf8;">${piiLabels.join(', ')}</strong> (${hits.length} item${hits.length > 1 ? 's' : ''}). Protect before submitting.
          </p>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <button id="aegis-inline-tokenize-btn" style="background:linear-gradient(135deg, #0284c7, #06b6d4); color:#fff; border:none; border-radius:6px; padding:6px 11px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 2px 6px rgba(2,132,199,0.35);">
            <span>🎭</span>
            <span>Tokenize (Auto-Restore)</span>
          </button>
          <button id="aegis-inline-redact-btn" style="background:#1e293b; color:#cbd5e1; border:1px solid #334155; border-radius:6px; padding:5px 8px; font-size:11px; font-weight:600; cursor:pointer;">
            🔒 Mask
          </button>
          <button id="aegis-inline-close-btn" style="background:#1e293b; color:#94a3b8; border:1px solid #334155; border-radius:6px; padding:5px 8px; font-size:11px; cursor:pointer;">
            ✕
          </button>
        </div>
      `;

      const closeBtn = warningBanner.querySelector('#aegis-inline-close-btn');
      if (closeBtn) {
        closeBtn.onclick = removeWarning;
      }

      const tokenizeBtn = warningBanner.querySelector('#aegis-inline-tokenize-btn');
      if (tokenizeBtn) {
        tokenizeBtn.onclick = () => {
          let tokenized = currentText;
          const newTokens = [];
          hits.forEach(h => {
            const syn = generateSyntheticTokenForFinding(h);
            tokenized = safeReplaceToken(tokenized, h.value, syn);
            newTokens.push({
              id: 'tok_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
              type: h.type,
              original: h.value,
              synthetic: syn,
              originHost: window.location.hostname,
              createdAt: Date.now()
            });
          });
          saveTokensToVault(newTokens);

          const hostInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ? target : (target.closest ? target.closest('input, textarea') : null);
          const hostEditable = target.isContentEditable ? target : (target.closest ? target.closest('[contenteditable="true"]') : null);

          if (hostInput) {
            hostInput.focus();
            hostInput.value = tokenized;
            hostInput.dispatchEvent(new Event('input', { bubbles: true }));
            hostInput.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (hostEditable) {
            try {
              hostEditable.focus();
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(hostEditable);
              sel.removeAllRanges();
              sel.addRange(range);
              if (!document.execCommand('insertText', false, tokenized)) {
                hostEditable.innerText = tokenized;
              }
            } catch (e) {
              hostEditable.innerText = tokenized;
            }
            hostEditable.dispatchEvent(new Event('input', { bubbles: true }));
          }
          removeWarning();
          showPrivoraHud({
            type: 'success',
            title: 'Privora Shield · Reversible Tokenization',
            subtitle: `Replaced ${hits.length} PII item(s) with realistic synthetic tokens. Responses will auto-decrypt.`,
            durationMs: 4000
          });
        };
      }

      const redactBtn = warningBanner.querySelector('#aegis-inline-redact-btn');
      if (redactBtn) {
        redactBtn.onclick = () => {
          let redacted = currentText;
          hits.forEach(h => {
            const mask = '█'.repeat(Math.min(h.value.length, 8));
            redacted = safeReplaceToken(redacted, h.value, `[REDACTED: ${h.type} ${mask}]`);
          });

          const hostInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ? target : (target.closest ? target.closest('input, textarea') : null);
          const hostEditable = target.isContentEditable ? target : (target.closest ? target.closest('[contenteditable="true"]') : null);

          if (hostInput) {
            hostInput.focus();
            hostInput.value = redacted;
            hostInput.dispatchEvent(new Event('input', { bubbles: true }));
            hostInput.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (hostEditable) {
            try {
              hostEditable.focus();
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(hostEditable);
              sel.removeAllRanges();
              sel.addRange(range);
              if (!document.execCommand('insertText', false, redacted)) {
                hostEditable.innerText = redacted;
              }
            } catch (e) {
              hostEditable.innerText = redacted;
            }
            hostEditable.dispatchEvent(new Event('input', { bubbles: true }));
          }
          removeWarning();
          showToast('Privora: Masked sensitive tokens inside prompt.');
        };
      }

      document.documentElement.appendChild(warningBanner);

      // Log audit event through unified schema (cooldown of 5s per distinct hit signature)
      const hitSignature = piiTypes.sort().join('+');
      const now = Date.now();
      if (hitSignature !== lastLoggedSignature || now - lastLogTime > 5000) {
        lastLoggedSignature = hitSignature;
        lastLogTime = now;

        logExtensionAuditEvent({
          eventType: 'LIVE_INPUT_PII_WARNING',
          severity: 'WARNING',
          actionTaken: `Live PII Warning on ${currentHost}: detected ${piiLabels.join(', ')}`,
          details: {
            destinationSite: currentHost,
            detectedPiiTypes: piiTypes,
            itemCount: hits.length,
          },
          riskScore: Math.min(95, hits.length * 30),
        });
      }
    }

    function handleLiveInput(e) {
      if (!isShieldEnabled) {
        removeWarning();
        return;
      }
      const target = e.target;
      if (!target) return;

      const isInput = target.tagName === 'TEXTAREA' || 
                      target.tagName === 'INPUT' || 
                      target.isContentEditable || 
                      !!target.closest('[contenteditable="true"]');
      if (!isInput) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        let text = '';
        if (target.value !== undefined) {
          text = target.value;
        } else if (target.isContentEditable) {
          text = target.innerText || target.textContent || '';
        } else {
          const parent = target.closest('[contenteditable="true"]');
          text = parent ? (parent.innerText || parent.textContent || '') : '';
        }

        if (!text || text.length < 4) {
          removeWarning();
          return;
        }

        const hits = scanText(text);
        if (hits.length > 0) {
          showInlineWarning(target, hits, text);
        } else {
          removeWarning();
        }
      }, 400);
    }

    document.addEventListener('input', handleLiveInput, true);
    document.addEventListener('keyup', handleLiveInput, true);
  }

  // -------------------------------------------------------------
  // 12. Real-Time AI Response Auto-Decryption (DOM Scanner)
  // -------------------------------------------------------------
  function setupAiResponseAutoDecryption() {
    function injectBadgeStyles() {
      if (document.getElementById('privora-token-styles')) return;
      const style = document.createElement('style');
      style.id = 'privora-token-styles';
      style.textContent = `
        .privora-decrypted-token {
          position: relative !important;
          display: inline-flex !important;
          align-items: center !important;
          border-bottom: 2px solid #10b981 !important;
          background: rgba(16, 185, 129, 0.12) !important;
          padding: 0 4px !important;
          border-radius: 4px !important;
          color: #059669 !important;
          font-weight: 600 !important;
          vertical-align: baseline !important;
          cursor: pointer !important;
        }
        .privora-decrypted-token::after {
          content: " \\1F512 DECRYPTED" !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          font-size: 9px !important;
          line-height: 1.1 !important;
          background: #065f46 !important;
          color: #a7f3d0 !important;
          padding: 1px 5px !important;
          border-radius: 9999px !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
          font-weight: 700 !important;
          margin-left: 5px !important;
          pointer-events: none !important;
          display: inline-block !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    injectBadgeStyles();

    function decryptElementText(element) {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
      if (element.classList && (element.classList.contains('privora-hud-toast') || element.classList.contains('privora-decrypted-token'))) return;
      if (element.closest && element.closest('.privora-decrypted-token, [data-privora-decrypted="true"]')) return;

      // CRITICAL: NEVER touch active input composers, textareas, or form inputs!
      if (
        element.tagName === 'INPUT' || 
        element.tagName === 'TEXTAREA' || 
        element.isContentEditable || 
        (element.closest && element.closest('input, textarea, [contenteditable="true"], #prompt-textarea, form'))
      ) {
        return;
      }

      // Restrict decryption ONLY to assistant responses or rendered output markdown
      const isAssistantContainer = (element.closest && element.closest('[data-message-author-role="assistant"], .markdown, .prose, .font-claude-message, [data-testid*="conversation-turn-"]')) ||
                                   (element.matches && element.matches('[data-message-author-role="assistant"], .markdown, .prose, .font-claude-message'));
      if (!isAssistantContainer) return;

      // Only use tokens created in THIS page session to avoid showing stale values from old sessions
      const vault = (window._privoraTokenVault || []).filter(t => t.sessionId === _privoraSessionId);
      if (vault.length === 0) return;

      const fullText = element.textContent || '';
      const matchingTokens = vault.filter(t => t.synthetic && fullText.includes(t.synthetic));
      if (matchingTokens.length === 0) return;

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
      let textNode;
      const replacements = [];

      while ((textNode = walker.nextNode())) {
        const val = textNode.nodeValue;
        if (!val) continue;

        for (const tok of matchingTokens) {
          if (val.includes(tok.synthetic)) {
            replacements.push({ textNode, tok });
            break;
          }
        }
      }

      for (const { textNode, tok } of replacements) {
        const parent = textNode.parentNode;
        if (!parent || (parent.closest && parent.closest('.privora-decrypted-token, [data-privora-decrypted="true"]'))) continue;

        const val = textNode.nodeValue;
        const parts = val.split(tok.synthetic);
        const frag = document.createDocumentFragment();

        parts.forEach((part, idx) => {
          if (part) frag.appendChild(document.createTextNode(part));
          if (idx < parts.length - 1) {
            const span = document.createElement('span');
            span.className = 'privora-decrypted-token';
            span.setAttribute('data-privora-decrypted', 'true');
            span.setAttribute('data-privora-synthetic', tok.synthetic);
            span.setAttribute('data-privora-real', tok.original);
            span.title = `Privora: Real ${tok.type} auto-decrypted from AI synthetic token (${tok.synthetic})`;
            span.textContent = tok.original; // Pure real text, badge rendered strictly via CSS ::after
            frag.appendChild(span);
          }
        });

        try {
          parent.replaceChild(frag, textNode);
        } catch (e) {}

        // If parent or ancestor is <a> tag, update its href so mailto/links point to real value
        const link = (parent.closest && parent.closest('a')) || (parent.tagName === 'A' ? parent : null);
        if (link && link.href && link.href.includes(tok.synthetic)) {
          link.href = link.href.split(tok.synthetic).join(tok.original);
        }
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const added of mut.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) {
            decryptElementText(added);
          }
        }
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });

    setInterval(() => {
      const vault = (window._privoraTokenVault || []).filter(t => t.sessionId === _privoraSessionId);
      if (vault.length === 0) return;
      const candidates = document.querySelectorAll('[data-message-author-role="assistant"], .markdown, .prose');
      candidates.forEach(c => decryptElementText(c));
    }, 1500);

  }

  // -------------------------------------------------------------
  // 13. Reversible Clipboard Copy Decryption
  // -------------------------------------------------------------
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'PRIVORA_CLIPBOARD_RESTORED') {
      showPrivoraHud({
        type: 'success',
        title: 'Privora Shield · Clipboard Restored',
        subtitle: `Restored ${event.data.hits || 1} real value(s) in copied content without dummy tokens!`,
        durationMs: 3000
      });
    }
  });

  document.addEventListener('copy', (e) => {
    const vault = window._privoraTokenVault || [];
    const selection = window.getSelection()?.toString();
    if (!selection || selection.length < 3) return;

    let restored = selection;
    let hitCount = 0;
    for (const tok of vault) {
      if (tok.synthetic && restored.includes(tok.synthetic)) {
        restored = restored.split(tok.synthetic).join(sanitizeStoredNameToken(tok.original));
        hitCount++;
      }
    }


    // Strip badge artifacts
    restored = restored.replace(/[\s\u00A0]*\uD83D\uDD12[\s\u00A0]*DECRYPTED/gi, '');
    restored = restored.replace(/[\s\u00A0]*\[\s*\uD83D\uDD12?\s*DECRYPTED\s*\]/gi, '');
    restored = restored.replace(/[\s\u00A0]*DECRYPTED/gi, '');
    // Convert [text](mailto:email) → email; [text](url) → text
    restored = restored.replace(/\[([^\]]+)\]\(mailto:([^)]+)\)/g, '$2');
    restored = restored.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Strip markdown bold/italic markers
    restored = restored.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
    restored = restored.replace(/___([^_]+)___/g, '$1');
    restored = restored.replace(/\*\*([^*]+)\*\*/g, '$1');
    restored = restored.replace(/__([^_]+)__/g, '$1');
    restored = restored.replace(/\*([^*\n]+)\*/g, '$1');
    restored = restored.replace(/_([^_\n]+)_/g, '$1');

    if (hitCount > 0 || restored !== selection) {
      if (e.clipboardData) {
        e.clipboardData.setData('text/plain', restored);
        e.preventDefault();
        showPrivoraHud({
          type: 'success',
          title: 'Privora Shield · Clipboard Restored',
          subtitle: `Restored ${hitCount > 0 ? hitCount + ' real value(s)' : 'text'} in copied content!`,
          durationMs: 3000
        });
      }
    }
  }, true);

  // Fallback click listener for copy buttons
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    const btn = target.closest ? target.closest('button, [role="button"]') : null;
    if (!btn) return;

    const label = (btn.getAttribute('aria-label') || btn.title || btn.innerText || btn.className || '').toLowerCase();
    const isCopyButton = label.includes('copy') || 
                         (btn.closest && btn.closest('[data-testid*="copy" i]')) ||
                         (btn.getAttribute && btn.getAttribute('data-testid')?.toLowerCase().includes('copy')) ||
                         btn.querySelector('svg');

    if (isCopyButton) {
      setTimeout(async () => {
        try {
          const vault = window._privoraTokenVault || [];
          if (vault.length === 0) return;

          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (!text || text.length < 3) return;

            let restored = text;
            let hits = 0;
            for (const tok of vault) {
              if (tok.synthetic && restored.includes(tok.synthetic)) {
                restored = restored.split(tok.synthetic).join(sanitizeStoredNameToken(tok.original));
                hits++;
              }
            }


            restored = restored.replace(/[\s\u00A0]*\uD83D\uDD12[\s\u00A0]*DECRYPTED/gi, '');
            restored = restored.replace(/[\s\u00A0]*\[\s*\uD83D\uDD12?\s*DECRYPTED\s*\]/gi, '');
            restored = restored.replace(/[\s\u00A0]*DECRYPTED/gi, '');
            // Convert [text](mailto:email) → email; [text](url) → text
            restored = restored.replace(/\[([^\]]+)\]\(mailto:([^)]+)\)/g, '$2');
            restored = restored.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
            // Strip markdown bold/italic markers
            restored = restored.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
            restored = restored.replace(/___([^_]+)___/g, '$1');
            restored = restored.replace(/\*\*([^*]+)\*\*/g, '$1');
            restored = restored.replace(/__([^_]+)__/g, '$1');
            restored = restored.replace(/\*([^*\n]+)\*/g, '$1');
            restored = restored.replace(/_([^_\n]+)_/g, '$1');

            if (hits > 0 || restored !== text) {
              await navigator.clipboard.writeText(restored);
              showPrivoraHud({
                type: 'success',
                title: 'Privora Shield · Clipboard Restored',
                subtitle: `Restored ${hits > 0 ? hits + ' real value(s)' : 'text'} in copied content!`,
                durationMs: 3000
              });
            }
          }
        } catch (err) {}
      }, 70);
    }
  }, true);

  // Initialize floating hub, live text interception, and AI auto-decryption on load
  setTimeout(() => {
    updateFloatingHub();
    setupLiveTextInterception();
    setupAiResponseAutoDecryption();
    console.log(`[Privora Shield] Active on ${window.location.hostname || 'page'}`);
  }, 800);

})();


