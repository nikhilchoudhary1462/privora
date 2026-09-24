/**
 * Privora Manifest V3 Real-Time Privacy Shield & Auto-Retrace Manager
 * - Pre-Upload Interception: Blocks raw document uploads on any website, blurs sensitive regions, with interactive corner handles, drag-to-move, and custom box drawing.
 * - Auto-Retrace on Download: Intercepts downloads of modified/compressed images, matches with local manifest, and patches unblurred slices back on!
 * - In-Page Floating Hub: Quick-retrace dropzone for instant manual unblurring of any downloaded file.
 */

(function () {
  'use strict';

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

  function scanText(text) {
    const results = [];
    if (!text || typeof text !== 'string') return results;

    let match;

    // 1. PAN Card (case-insensitive search, validated uppercase)
    const panRegex = /\b([A-Za-z]{5}[0-9]{4}[A-Za-z]{1})\b/g;
    while ((match = panRegex.exec(text)) !== null) {
      if (validatePAN(match[1])) {
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
      if (raw.length === 12 && !seenAadhaar.has(raw)) {
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
      if (!seenCard.has(raw)) {
        seenCard.add(raw);
        if (validateLuhn(raw)) {
          results.push({ type: 'CREDIT_CARD', label: 'Payment Card', value: match[0] });
        }
      }
    }

    // 4. SSN
    const ssnRegex = /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g;
    while ((match = ssnRegex.exec(text)) !== null) {
      if (validateSSN(match[0])) {
        results.push({ type: 'SSN', label: 'US SSN', value: match[0] });
      }
    }

    // 5. Email
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    while ((match = emailRegex.exec(text)) !== null) {
      results.push({ type: 'EMAIL', label: 'Email Address', value: match[0] });
    }

    // 6. Phone
    const phoneRegex = /(?:\+?91[-\s]?)?[6-9]\d{9}\b|\b(?:\+?1[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b/g;
    while ((match = phoneRegex.exec(text)) !== null) {
      if (validatePhone(match[0])) {
        results.push({ type: 'PHONE', label: 'Phone Number', value: match[0] });
      }
    }

    // 7. API Keys & Bearer Tokens
    const apiKeyRegex = /sk-(?:proj-)?[a-zA-Z0-9_\-]{20,64}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi;
    while ((match = apiKeyRegex.exec(text)) !== null) {
      results.push({ type: 'API_KEY', label: 'API Secret Key', value: match[0] });
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

    return results;
  }

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
  // 3. Centralized In-Page Toast Notifications
  // -------------------------------------------------------------
  function showToast(message) {
    const existing = document.getElementById('aegis-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'aegis-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #090d16;
      border: 1px solid #10b981;
      border-radius: 14px;
      padding: 14px 20px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      z-index: 2147483647;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7), 0 0 20px rgba(16, 185, 129, 0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: aegisFadeIn 0.3s ease-out;
    `;
    toast.innerHTML = `<span>🛡️</span><span>${message}</span>`;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
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
      width: 380px !important;
      max-width: calc(100vw - 48px) !important;
      height: auto !important;
      z-index: 2147483647 !important;
      background: #090d16 !important;
      border: 1px solid #06b6d4 !important;
      border-radius: 16px !important;
      padding: 16px 20px !important;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.9), 0 0 30px rgba(6, 182, 212, 0.3) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      color: #f8fafc !important;
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
          <div style="background:#082f49; border:1px solid #0284c7; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:17px;">🛡️</div>
          <div>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:13px; color:#f8fafc;">Privora Privacy Shield</strong>
              <span style="font-size:9px; background:#082f49; color:#38bdf8; border:1px solid #0369a1; padding:1px 6px; border-radius:9999px; font-family:monospace;">READY</span>
            </div>
            <p style="margin:2px 0 0; font-size:11px; color:#94a3b8;">
              File Upload Intercepted on <strong style="color:#38bdf8;">${window.location.hostname || 'site'}</strong>
            </p>
          </div>
        </div>
        <button id="btn-prompt-close" style="background:transparent; border:none; color:#64748b; font-size:16px; cursor:pointer; padding:4px;" title="Cancel Upload">✕</button>
      </div>

      <div style="background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; font-size:11px;">
        <span style="color:#cbd5e1; font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:260px;">📄 ${file.name}</span>
        <span style="color:#64748b; font-family:monospace;">${(file.size / 1024).toFixed(1)} KB</span>
      </div>

      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <button id="btn-prompt-edit" style="flex:1; background:linear-gradient(135deg, #0284c7, #0891b2); color:#fff; border:none; border-radius:10px; padding:8px 12px; font-size:12px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 12px rgba(2, 132, 199, 0.3);">
          <span>🎨</span>
          <span>Review & Redact</span>
        </button>
        <button id="btn-prompt-plaintext" style="background:#1e293b; color:#cbd5e1; border:1px solid #334155; border-radius:10px; padding:8px 12px; font-size:11px; font-weight:600; cursor:pointer;" title="Upload original file without masking">
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
    const header = '%PDF-1.4\n';
    const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
    const kids = Array.from({ length: numPages }, (_, i) => `${3 + i * 3} 0 R`).join(' ');
    const obj2 = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${numPages} >>\nendobj\n`;

    const pageObjs = [];
    for (let i = 0; i < numPages; i++) {
      const c = canvasList[i];
      const pageId = 3 + i * 3;
      const imgId = 4 + i * 3;
      const contentId = 5 + i * 3;
      const w = c.width || 800;
      const h = c.height || 1000;
      const ptW = Math.round(w * 0.75);
      const ptH = Math.round(h * 0.75);

      const imgDataUrl = c.toDataURL('image/jpeg', 0.90);
      const binaryImg = atob(imgDataUrl.split(',')[1]);
      const imgLen = binaryImg.length;

      const pObj = `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`;
      const imObj = `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLen} >>\nstream\n${binaryImg}\nendstream\nendobj\n`;
      const streamContent = `q ${ptW} 0 0 ${ptH} 0 0 cm /Im${i} Do Q`;
      const cntObj = `${contentId} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;

      pageObjs.push(pObj, imObj, cntObj);
    }

    const allObjs = [obj1, obj2, ...pageObjs];
    const totalObjs = allObjs.length;
    let offset = header.length;
    const offsets = [0];
    for (const obj of allObjs) {
      offsets.push(offset);
      offset += obj.length;
    }

    let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= totalObjs; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    const trailer = `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`;

    const fullPdf = header + allObjs.join('') + xref + trailer;
    const pdfBytes = new Uint8Array(fullPdf.length);
    for (let i = 0; i < fullPdf.length; i++) {
      pdfBytes[i] = fullPdf.charCodeAt(i) & 0xff;
    }
    return new Blob([pdfBytes], { type: 'application/pdf' });
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
      padding: 22px;
      max-width: 860px;
      width: 100%;
      max-height: 94vh;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 40px rgba(6, 182, 212, 0.25);
      overflow-y: auto;
    `;

    // 1. Header
    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid #1e293b; padding-bottom:12px;';
    headerRow.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="background:#082f49; border:1px solid #0284c7; width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:20px;">🛡️</div>
        <div>
          <h3 style="margin:0; font-size:16px; font-weight:800; color:#f8fafc; display:flex; align-items:center; gap:8px;">
            <span>Privora Privacy Interception</span>
            <span style="font-size:10px; background:#082f49; color:#38bdf8; border:1px solid #0369a1; padding:2px 8px; border-radius:9999px; font-family:monospace;">ACTIVE SHIELD</span>
          </h3>
          <p style="margin:2px 0 0; font-size:11px; color:#94a3b8;">
            Blocked sensitive file before upload to <strong style="color:#38bdf8;">${window.location.hostname || 'this website'}</strong>
          </p>
        </div>
      </div>
      <div style="text-align:right;">
        <span style="font-size:10px; color:#64748b; font-family:monospace; display:block;">FILE TO UPLOAD</span>
        <span style="font-size:12px; font-weight:bold; color:#e2e8f0; font-family:monospace;">${file.name} (${(file.size / 1024).toFixed(1)} KB)</span>
      </div>
    `;
    card.appendChild(headerRow);

    // 2. Quick Preset Add & Clear Controls
    const quickBar = document.createElement('div');
    quickBar.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; background:#0b1120; padding:8px 12px; border-radius:12px; border:1px solid #1e293b;';
    quickBar.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:11px; color:#94a3b8; font-weight:600; margin-right:4px;">Quick Presets:</span>
        <button id="add-face-btn" style="background:#1e293b; color:#38bdf8; border:1px solid #0369a1; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ Face Photo</button>
        <button id="add-name-btn" style="background:#1e293b; color:#38bdf8; border:1px solid #0369a1; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ Name / Demographic</button>
        <button id="add-id-btn" style="background:#1e293b; color:#38bdf8; border:1px solid #0369a1; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ ID Number</button>
        <button id="add-qr-btn" style="background:#1e293b; color:#38bdf8; border:1px solid #0369a1; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">+ QR Matrix</button>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <button id="scale-up-btn" style="background:#1e293b; color:#e2e8f0; border:1px solid #334155; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:bold; cursor:pointer;" title="Expand selected box (+15%)">[ +15% ]</button>
        <button id="scale-down-btn" style="background:#1e293b; color:#e2e8f0; border:1px solid #334155; border-radius:6px; padding:3px 8px; font-size:11px; font-weight:bold; cursor:pointer;" title="Shrink selected box (-15%)">[ -15% ]</button>
        <button id="clear-boxes-btn" style="background:#331016; color:#f87171; border:1px solid #991b1b; border-radius:8px; padding:4px 8px; font-size:11px; font-weight:bold; cursor:pointer;">🗑️ Clear All</button>
      </div>
    `;
    card.appendChild(quickBar);

    // 3. Interactive Canvas Container
    const canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = `
      position: relative;
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 280px;
      max-height: 400px;
      user-select: none;
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

    function updatePageNavUI() {
      if (!pageNavContainer) return;
      if (pdfPages.length <= 1) {
        pageNavContainer.style.display = 'none';
        return;
      }
      pageNavContainer.style.display = 'flex';
      const pageIndicator = pageNavContainer.querySelector('#aegis-page-indicator');
      if (pageIndicator) {
        pageIndicator.textContent = `Page ${currentPdfPageIdx + 1} of ${pdfPages.length}`;
      }
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

    if (isPdf) {
      if (typeof pdfjsLib !== 'undefined') {
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
          }
        } catch (e) {}

        try {
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = pdfjsLib.getDocument({
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

            await page.render({
              canvasContext: pCtx,
              viewport: viewport,
            }).promise;

            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .filter(i => 'str' in i)
              .map(i => i.str)
              .join(' ');

            const piiItems = scanText(pageText);
            const pageBoxes = [];

            piiItems.forEach(finding => {
              let matched = false;
              if (finding.value) {
                const cleanVal = finding.value.replace(/[-\s]/g, '');
                for (const item of textContent.items) {
                  if (!item.str) continue;
                  const cleanItem = item.str.replace(/[-\s]/g, '');
                  if (
                    item.str.includes(finding.value) ||
                    finding.value.includes(item.str) ||
                    (cleanItem.length >= 4 && cleanVal.includes(cleanItem))
                  ) {
                    const tx = item.transform[4] * 1.5;
                    const ty = viewport.height - (item.transform[5] * 1.5);
                    const tw = Math.max(50, (item.width || 60) * 1.5);
                    const th = Math.max(18, (item.height || 14) * 1.5);

                    pageBoxes.push({
                      x: Math.max(0, Math.round(tx - 4)),
                      y: Math.max(0, Math.round(ty - th - 4)),
                      width: Math.round(tw + 8),
                      height: Math.round(th + 8),
                      label: finding.label
                    });
                    matched = true;
                    break;
                  }
                }
              }
              if (!matched) {
                pageBoxes.push({
                  x: Math.round(pCanvas.width * 0.1),
                  y: Math.round(pCanvas.height * 0.25 + (pageBoxes.length * 36)),
                  width: Math.round(pCanvas.width * 0.8),
                  height: 28,
                  label: finding.label
                });
              }
            });

            pdfPages.push({
              pageNum: pNum,
              canvas: pCanvas,
              pageDataUrl: pCanvas.toDataURL('image/png'),
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
          pageNavContainer.style.cssText = 'display:flex; align-items:center; gap:8px; background:#0284c7; padding:4px 10px; border-radius:8px;';
          pageNavContainer.innerHTML = `
            <button id="aegis-prev-page" style="background:#0369a1; color:#ffffff; border:none; border-radius:4px; padding:2px 8px; font-weight:bold; cursor:pointer;">◀ Prev</button>
            <span id="aegis-page-indicator" style="font-size:11px; font-weight:bold; color:#ffffff; font-family:monospace;">Page 1 of ${pdfPages.length}</span>
            <button id="aegis-next-page" style="background:#0369a1; color:#ffffff; border:none; border-radius:4px; padding:2px 8px; font-weight:bold; cursor:pointer;">Next ▶</button>
          `;
          quickBar.appendChild(pageNavContainer);

          const btnPrev = pageNavContainer.querySelector('#aegis-prev-page');
          const btnNext = pageNavContainer.querySelector('#aegis-next-page');

          const switchPdfPage = (targetIdx) => {
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

          if (btnPrev) btnPrev.onclick = () => switchPdfPage(currentPdfPageIdx - 1);
          if (btnNext) btnNext.onclick = () => switchPdfPage(currentPdfPageIdx + 1);
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
            if (fn.includes('aadhaar') || fn.includes('id') || fn.includes('pan') || fn.includes('card') || fn.includes('image') || fn.includes('whatsapp')) {
              currentBoxes.push({
                x: Math.round(canvas.width * 0.10),
                y: Math.round(canvas.height * 0.28),
                width: Math.round(canvas.width * 0.16),
                height: Math.round(canvas.height * 0.38),
                label: 'Face Photo'
              });
              currentBoxes.push({
                x: Math.round(canvas.width * 0.32),
                y: Math.round(canvas.height * 0.35),
                width: Math.round(canvas.width * 0.28),
                height: Math.round(canvas.height * 0.14),
                label: 'Name / DOB'
              });
              currentBoxes.push({
                x: Math.round(canvas.width * 0.30),
                y: Math.round(canvas.height * 0.80),
                width: Math.round(canvas.width * 0.40),
                height: Math.round(canvas.height * 0.12),
                label: 'ID Number'
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
          x: Math.round(canvas.width * 0.10),
          y: Math.round(canvas.height * 0.28),
          width: Math.round(canvas.width * 0.16),
          height: Math.round(canvas.height * 0.38),
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
          x: Math.round(canvas.width * 0.32),
          y: Math.round(canvas.height * 0.35),
          width: Math.round(canvas.width * 0.28),
          height: Math.round(canvas.height * 0.14),
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
          x: Math.round(canvas.width * 0.30),
          y: Math.round(canvas.height * 0.80),
          width: Math.round(canvas.width * 0.40),
          height: Math.round(canvas.height * 0.12),
          label: 'ID Number'
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
          x: Math.round(canvas.width * 0.68),
          y: Math.round(canvas.height * 0.64),
          width: Math.round(canvas.width * 0.24),
          height: Math.round(canvas.height * 0.26),
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
      background: linear-gradient(135deg, #06b6d4, #10b981);
      color: #020617;
      border: none;
      border-radius: 12px;
      padding: 12px;
      font-weight: 800;
      font-size: 13px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    `;
    btnConfirmMask.innerHTML = '<span>🔒</span> Redact / Encrypt & Proceed with Upload';

    const btnAllowPlaintext = document.createElement('button');
    btnAllowPlaintext.style.cssText = `
      flex: 1;
      background: #1e293b;
      color: #fbbf24;
      border: 1px solid #78350f;
      border-radius: 12px;
      padding: 12px;
      font-weight: bold;
      font-size: 12px;
      cursor: pointer;
    `;
    btnAllowPlaintext.textContent = '⚠️ Upload Unmodified';

    const btnCancel = document.createElement('button');
    btnCancel.style.cssText = `
      flex: 1;
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 12px;
      font-weight: bold;
      font-size: 12px;
      cursor: pointer;
    `;
    btnCancel.textContent = '❌ Cancel Upload';

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
      const unblurredSlices = [];
      if (baseImage && baseImage.complete && baseImage.naturalWidth > 0) {
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
            origin: window.location.origin,
            hostname: window.location.hostname,
          };
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['aegis_active_manifests'], (res) => {
              const list = res.aegis_active_manifests || [];
              list.unshift(manifest);
              chrome.storage.local.set({ aegis_active_manifests: list.slice(0, 50) });
            });
          }
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
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['aegis_active_manifests'], (res) => {
              const list = res.aegis_active_manifests || [];
              list.unshift(manifest);
              chrome.storage.local.set({ aegis_active_manifests: list.slice(0, 50) });
            });
          }
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

          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['aegis_active_manifests'], (res) => {
              const list = res.aegis_active_manifests || [];
              list.unshift(manifest);
              chrome.storage.local.set({ aegis_active_manifests: list.slice(0, 50) });
            });
          }
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
  // 5. File Input Change Interception
  // -------------------------------------------------------------
  document.addEventListener('change', async (e) => {
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

      showFileInterceptionPrompt({
        file,
        onOpenEditor: () => {
          showFileInterceptionModal({
            file,
            initialBoxes: [],
            detectedItems: [],
            onConfirmMask: (sanitizedFile) => {
              const dt = new DataTransfer();
              dt.items.add(sanitizedFile);

              // Use native prototype setter for React / Framework compatibility
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

              // If site uses jQuery or custom event wrappers
              if (typeof window !== 'undefined' && window.$ && window.$(target).trigger) {
                try { window.$(target).trigger('change'); } catch (e) {}
              }
            },
            onAllowPlaintext: () => {
              target.dataset.aegisSanitized = 'true';
              target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
            },
            onCancel: () => {
              target.value = '';
            }
          });
        },
        onAllowPlaintext: () => {
          target.dataset.aegisSanitized = 'true';
          target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true, composed: true }));
        },
        onCancel: () => {
          target.value = '';
        }
      });
    }
  }, true);

  // -------------------------------------------------------------
  // 6. File Drop Interception
  // -------------------------------------------------------------
  document.addEventListener('drop', async (e) => {
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

      showFileInterceptionPrompt({
        file,
        onOpenEditor: () => {
          showFileInterceptionModal({
            file,
            initialBoxes: [],
            detectedItems: [],
            onConfirmMask: (sanitizedFile) => {
              const dt = new DataTransfer();
              dt.items.add(sanitizedFile);
              const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
              });
              dropTarget.dispatchEvent(dropEvent);
            },
            onAllowPlaintext: () => {
              const dt = new DataTransfer();
              dt.items.add(file);
              const dropEvent = new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer: dt,
              });
              dropTarget.dispatchEvent(dropEvent);
            },
            onCancel: () => {}
          });
        },
        onAllowPlaintext: () => {
          const dt = new DataTransfer();
          dt.items.add(file);
          const dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
          });
          dropTarget.dispatchEvent(dropEvent);
        },
        onCancel: () => {}
      });
    }
  }, true);

  // -------------------------------------------------------------
  // 7. Automatic Download Interceptor & In-Place Retracer
  // -------------------------------------------------------------
  async function retraceAndRestoreImage(imageBlob, fileName) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;

    return new Promise((resolve) => {
      chrome.storage.local.get(['aegis_active_manifests'], async (res) => {
        const manifests = res.aegis_active_manifests || [];
        if (manifests.length === 0) {
          resolve(null);
          return;
        }

        const matched = manifests.find(m => 
          m.hostname === window.location.hostname || 
          fileName.toLowerCase().includes(m.fileName.replace(/\.[^/.]+$/, '').toLowerCase()) ||
          m.fileName.toLowerCase().includes(fileName.replace(/\.[^/.]+$/, '').toLowerCase())
        ) || manifests[0];

        if (!matched || !matched.slices || matched.slices.length === 0) {
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
          const pCtx = patchCanvas.getContext('2d');
          pCtx.drawImage(img, 0, 0, patchCanvas.width, patchCanvas.height);

          for (const slice of matched.slices) {
            const sliceImg = new Image();
            await new Promise((res) => {
              sliceImg.onload = res;
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
          console.log(`[Privora Retrace] Input: ${imageBlob.size} bytes (${patchCanvas.width}x${patchCanvas.height}), Chosen adaptive quality: ${targetQuality}`);

          const outType = imageBlob.type || (fileName.match(/\.(jpe?g)$/i) ? 'image/jpeg' : (fileName.match(/\.png$/i) ? 'image/png' : 'image/jpeg'));

          patchCanvas.toBlob((restoredBlob) => {
            URL.revokeObjectURL(url);
            if (!restoredBlob) {
              resolve(null);
              return;
            }

            console.log(`[Privora Retrace] Output: ${restoredBlob.size} bytes (Delta vs compressed input: ${restoredBlob.size - imageBlob.size > 0 ? '+' : ''}${restoredBlob.size - imageBlob.size} bytes, Original: ${matched.originalFileSize || 'N/A'} bytes)`);

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
      });
    });
  }

  // Intercept Download Link Clicks
  document.addEventListener('click', async (e) => {
    let target = e.target;
    while (target && target.tagName !== 'A' && target !== document.body) {
      target = target.parentElement;
    }

    if (!target || target.tagName !== 'A') return;
    if (target.dataset.aegisRestored === 'true') return;

    const href = target.getAttribute('href') || target.href || '';
    const downloadAttr = target.getAttribute('download');
    const isImageDownload = downloadAttr !== null || href.match(/\.(png|jpe?g|webp|svg)$/i) || href.startsWith('blob:') || href.startsWith('data:image/');

    if (isImageDownload && href) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

      chrome.storage.local.get(['aegis_active_manifests'], async (res) => {
        const manifests = res.aegis_active_manifests || [];
        if (manifests.length === 0) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        try {
          let blob;
          if (href.startsWith('data:')) {
            const r = await fetch(href);
            blob = await r.blob();
          } else {
            blob = await fetch(href).then(r => r.blob());
          }

          const result = await retraceAndRestoreImage(blob, downloadAttr || 'downloaded_image.png');
          const restoredBlob = result?.blob || (result instanceof Blob ? result : null);
          const finalBlob = restoredBlob || blob;
          const finalUrl = URL.createObjectURL(finalBlob);

          const a = document.createElement('a');
          a.href = finalUrl;
          a.download = downloadAttr || (restoredBlob ? ('restored_' + (result?.manifest?.fileName || manifests[0].fileName)) : 'downloaded_image.png');
          a.dataset.aegisRestored = 'true';
          document.body.appendChild(a);
          a.click();
          a.remove();

          if (restoredBlob && result) {
            const inKb = (result.inputSize / 1024).toFixed(1);
            const outKb = (result.restoredSize / 1024).toFixed(1);
            showToast(`✨ Privora: Retraced & restored unblurred regions — ${inKb}KB → ${outKb}KB on "${a.download}"!`);
          }
        } catch (err) {
          target.dataset.aegisRestored = 'true';
          target.click();
        }
      });
    }
  }, true);

  // -------------------------------------------------------------
  // 8. In-Page Floating Retrace Hub
  // -------------------------------------------------------------
  function updateFloatingHub() {
    let hub = document.getElementById('aegis-floating-hub');
    if (!hub) {
      hub = document.createElement('div');
      hub.id = 'aegis-floating-hub';
      hub.style.cssText = `
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 2147483640;
        background: #090d16;
        border: 1px solid #06b6d4;
        border-radius: 14px;
        padding: 10px 14px;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(6, 182, 212, 0.2);
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
      `;
      document.documentElement.appendChild(hub);
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['aegis_active_manifests'], (res) => {
        const manifests = res.aegis_active_manifests || [];
        if (manifests.length === 0) {
          hub.style.display = 'none';
          return;
        }

        hub.style.display = 'flex';
        hub.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">🛡️</span>
            <div>
              <strong style="color:#38bdf8; display:block; font-size:11px;">Privora Active</strong>
              <span style="color:#94a3b8; font-size:10px;">${manifests.length} Document(s) Protected</span>
            </div>
          </div>
          <button id="aegis-retrace-btn" style="background:#0284c7; color:#f8fafc; border:none; border-radius:8px; padding:6px 10px; font-size:11px; font-weight:bold; cursor:pointer;">
            🔄 Retrace Any Download
          </button>
          <button id="aegis-reset-hub-btn" style="background:#331016; color:#f87171; border:1px solid #991b1b; border-radius:8px; padding:6px 8px; font-size:11px; font-weight:bold; cursor:pointer;" title="Clear active session records">
            ✕
          </button>
        `;

        const resetBtn = document.getElementById('aegis-reset-hub-btn');
        if (resetBtn) {
          resetBtn.onclick = () => {
            chrome.storage.local.set({ aegis_active_manifests: [] }, () => {
              hub.style.display = 'none';
              showToast('Privora: Active protection session cleared.');
            });
          };
        }

        const btn = document.getElementById('aegis-retrace-btn');
        if (btn) {
          btn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.dataset.aegisSanitized = 'true';
            input.dataset.aegisRetrace = 'true';
            input.onchange = async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const result = await retraceAndRestoreImage(file, file.name);
              const restoredBlob = result?.blob || (result instanceof Blob ? result : null);
              if (restoredBlob) {
                const url = URL.createObjectURL(restoredBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'restored_' + file.name;
                a.dataset.aegisRestored = 'true';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                const inKb = result?.inputSize ? (result.inputSize / 1024).toFixed(1) : (file.size / 1024).toFixed(1);
                const outKb = result?.restoredSize ? (result.restoredSize / 1024).toFixed(1) : (restoredBlob.size / 1024).toFixed(1);
                showToast(`✨ Privora: Retraced & restored unblurred regions — ${inKb}KB → ${outKb}KB on "${a.download}"!`);
              } else {
                alert('No matching Privora encryption session found for this file.');
              }
            };
            input.click();
          };
        }
      });
    }
  }

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
      width: 380px !important;
      max-width: calc(100vw - 48px) !important;
      height: auto !important;
      z-index: 2147483647 !important;
      background: #090d16 !important;
      border: 1px solid #06b6d4 !important;
      border-radius: 16px !important;
      padding: 16px 20px !important;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.9), 0 0 30px rgba(6, 182, 212, 0.3) !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      color: #f8fafc !important;
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
          <div style="background:#082f49; border:1px solid #0284c7; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:17px;">🛡️</div>
          <div>
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:13px; color:#f8fafc;">Sensitive PII in Clipboard</strong>
              <span style="font-size:9px; background:#451a03; color:#fcd34d; border:1px solid #78350f; padding:1px 6px; border-radius:9999px; font-family:monospace;">${piiCount} ITEM${piiCount > 1 ? 'S' : ''}</span>
            </div>
            <p style="margin:2px 0 0; font-size:11px; color:#94a3b8;">
              Found: <strong style="color:#38bdf8;">${piiLabels.join(', ')}</strong>
            </p>
          </div>
        </div>
        <button id="btn-text-prompt-close" style="background:transparent; border:none; color:#64748b; font-size:16px; cursor:pointer; padding:4px;" title="Cancel Paste">✕</button>
      </div>

      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
        <button id="btn-text-prompt-redact" style="flex:1; background:linear-gradient(135deg, #0284c7, #0891b2); color:#fff; border:none; border-radius:10px; padding:8px 10px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px;">
          <span>🔒</span>
          <span>Redact & Paste</span>
        </button>
        <button id="btn-text-prompt-editor" style="background:#1e293b; color:#38bdf8; border:1px solid #0369a1; border-radius:10px; padding:8px 10px; font-size:11px; font-weight:600; cursor:pointer;" title="Open full review dialog">
          Review...
        </button>
        <button id="btn-text-prompt-allow" style="background:#1e293b; color:#cbd5e1; border:1px solid #334155; border-radius:10px; padding:8px 10px; font-size:11px; font-weight:600; cursor:pointer;" title="Paste raw text without changes">
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

    const btnRedact = promptCard.querySelector('#btn-text-prompt-redact');
    const btnEditor = promptCard.querySelector('#btn-text-prompt-editor');
    const btnAllow = promptCard.querySelector('#btn-text-prompt-allow');
    const btnClose = promptCard.querySelector('#btn-text-prompt-close');

    if (btnRedact) {
      btnRedact.onclick = () => {
        promptCard.remove();
        activePrompt = null;
        let redacted = originalText;
        hits.forEach(h => {
          const mask = '█'.repeat(Math.min(h.value.length, 8));
          redacted = redacted.split(h.value).join(`[REDACTED: ${h.type} ${mask}]`);
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
        <button id="btn-text-redact" style="background:linear-gradient(135deg, #06b6d4, #10b981); color:#020617; border:none; border-radius:12px; padding:12px; font-weight:800; font-size:13px; cursor:pointer;">
          🔒 Redact Sensitive Values & Paste
        </button>
        <button id="btn-text-encrypt" style="background:#4f46e5; color:#ffffff; border:none; border-radius:12px; padding:12px; font-weight:800; font-size:13px; cursor:pointer;">
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

    // Redact
    card.querySelector('#btn-text-redact').onclick = () => {
      let redacted = originalText;
      hits.forEach(h => {
        const mask = '█'.repeat(Math.min(h.value.length, 8));
        redacted = redacted.split(h.value).join(`[REDACTED: ${h.type} ${mask}]`);
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
          <button id="aegis-inline-redact-btn" style="background:#0284c7; color:#fff; border:none; border-radius:6px; padding:5px 9px; font-size:11px; font-weight:bold; cursor:pointer;">
            🔒 Redact
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

      const redactBtn = warningBanner.querySelector('#aegis-inline-redact-btn');
      if (redactBtn) {
        redactBtn.onclick = () => {
          let redacted = currentText;
          hits.forEach(h => {
            const mask = '█'.repeat(Math.min(h.value.length, 8));
            redacted = redacted.split(h.value).join(`[REDACTED: ${h.type} ${mask}]`);
          });

          if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
            target.value = redacted;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (target.isContentEditable) {
            target.innerText = redacted;
            target.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            const parent = target.closest('[contenteditable="true"]');
            if (parent) {
              parent.innerText = redacted;
              parent.dispatchEvent(new Event('input', { bubbles: true }));
            }
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

  // Initialize floating hub and live universal text interception on load
  setTimeout(() => {
    updateFloatingHub();
    setupLiveTextInterception();
    console.log(`[Privora Shield] Active on ${window.location.hostname || 'page'}`);
  }, 800);

})();


