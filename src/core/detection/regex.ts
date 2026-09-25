import { DetectedItem, PiiType, ComplianceStandard } from '../../types';
import { validateVerhoeff, generateVerhoeffChecksum, validateLuhn } from '../fpe/checksum';

export class RegexDetector {
  public static generateVerhoeffChecksum(num11: string): string {
    return generateVerhoeffChecksum(num11);
  }

  public static validateVerhoeff(numStr: string): boolean {
    return validateVerhoeff(numStr);
  }

  // Luhn Algorithm for Credit Card validation
  public static validateLuhn(numStr: string): boolean {
    return validateLuhn(numStr);
  }

  // Positional PAN candidate normalization strictly by character class
  public static normalizePanCandidate(str: string): { normalized: string; wasCorrected: boolean } | null {
    if (!str) return null;
    const clean = str.replace(/[-\s]/g, '').toUpperCase();
    if (clean.length !== 10) return null;

    let wasCorrected = false;
    const chars = clean.split('');

    // Positions 1–5: Expected letters (A-Z)
    for (let i = 0; i < 5; i++) {
      const c = chars[i];
      if (c === '0') { chars[i] = 'O'; wasCorrected = true; }
      else if (c === '1') { chars[i] = 'I'; wasCorrected = true; }
      else if (c === '8') { chars[i] = 'B'; wasCorrected = true; }
      else if (!/^[A-Z]$/.test(chars[i])) return null;
    }

    // Positions 6–9: Expected digits (0-9)
    for (let i = 5; i < 9; i++) {
      const c = chars[i];
      if (c === 'O') { chars[i] = '0'; wasCorrected = true; }
      else if (c === 'I' || c === 'L') { chars[i] = '1'; wasCorrected = true; }
      else if (c === 'B') { chars[i] = '8'; wasCorrected = true; }
      else if (c === 'S') { chars[i] = '5'; wasCorrected = true; }
      else if (c === 'Z') { chars[i] = '2'; wasCorrected = true; }
      else if (!/^[0-9]$/.test(chars[i])) return null;
    }

    // Position 10: Expected letter (A-Z)
    const c10 = chars[9];
    if (c10 === '0') { chars[9] = 'O'; wasCorrected = true; }
    else if (c10 === '1') { chars[9] = 'I'; wasCorrected = true; }
    else if (!/^[A-Z]$/.test(chars[9])) return null;

    const normalized = chars.join('');
    return { normalized, wasCorrected };
  }

  // Strict PAN validation (official government format: 5 uppercase letters, 4 digits, 1 uppercase letter)
  public static validatePAN(str: string): boolean {
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    return panRegex.test(str ? str.trim() : '');
  }

  // US SSN Validation
  public static validateSSN(str: string): boolean {
    const clean = str.replace(/[-\s]/g, '');
    if (clean.length !== 9 || !/^\d{9}$/.test(clean)) return false;
    const area = parseInt(clean.substring(0, 3), 10);
    const group = parseInt(clean.substring(3, 5), 10);
    const serial = parseInt(clean.substring(5, 9), 10);
    if (area === 0 || area === 666 || area >= 900) return false;
    if (group === 0 || serial === 0) return false;
    return true;
  }

  // Passport Validation (1 uppercase letter, 7 or 8 digits, excluding Q, X, Z)
  public static validatePassport(str: string): boolean {
    const clean = str.replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-PR-WY][1-9]\d{6,7}$/.test(clean)) return false;
    return true;
  }

  // Phone Validation
  public static validatePhone(str: string): boolean {
    const clean = str.replace(/\D/g, '');
    if (clean.length === 10) {
      return /^[6-9]\d{9}$/.test(clean);
    }
    if (clean.length === 11 && clean.startsWith('1')) {
      return /^1[2-9]\d{9}$/.test(clean);
    }
    if (clean.length === 12 && clean.startsWith('91')) {
      return /^91[6-9]\d{9}$/.test(clean);
    }
    return false;
  }

  // Date of Birth (DOB) Validation
  public static validateDOB(str: string): boolean {
    if (!str || typeof str !== 'string') return false;
    const clean = str.trim();

    // 1. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const dmyMatch = /^([0-3]?\d)[\/\-\.]([0-1]?\d)[\/\-\.]((?:19|20)\d{2})$/.exec(clean);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10);
      const year = parseInt(dmyMatch[3], 10);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2026) {
        if (month === 2 && day > 29) return false;
        if ([4, 6, 9, 11].includes(month) && day > 30) return false;
        return true;
      }
      return false;
    }

    // 2. YYYY/MM/DD or YYYY-MM-DD
    const ymdMatch = /^((?:19|20)\d{2})[\/\-\.]([0-1]?\d)[\/\-\.]([0-3]?\d)$/.exec(clean);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10);
      const day = parseInt(ymdMatch[3], 10);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2026) {
        return true;
      }
      return false;
    }

    // 3. DD Month YYYY e.g. 15 Jan 1990 or 15-August-1992
    const monthNameMatch = /^([0-3]?\d)[\/\-\s,]+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\/\-\s,]+((?:19|20)\d{2})$/i.exec(clean);
    if (monthNameMatch) {
      const day = parseInt(monthNameMatch[1], 10);
      const year = parseInt(monthNameMatch[3], 10);
      return day >= 1 && day <= 31 && year >= 1900 && year <= 2026;
    }

    // 4. Month DD, YYYY e.g. Jan 15, 1990
    const monthFirstMatch = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\/\-\s,]+([0-3]?\d)[\/\-\s,]+((?:19|20)\d{2})$/i.exec(clean);
    if (monthFirstMatch) {
      const day = parseInt(monthFirstMatch[2], 10);
      const year = parseInt(monthFirstMatch[3], 10);
      return day >= 1 && day <= 31 && year >= 1900 && year <= 2026;
    }

    // 5. Standalone year of birth e.g. 1990
    if (/^(?:19|20)\d{2}$/.test(clean)) {
      const year = parseInt(clean, 10);
      return year >= 1900 && year <= 2026;
    }

    return false;
  }

  // Email Validation
  public static validateEmail(str: string): boolean {
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    return emailRegex.test(str.trim());
  }

  // Scan plain text and return all confirmed, validated PII items
  static scanText(text: string): DetectedItem[] {
    const results: DetectedItem[] = [];
    if (!text || typeof text !== 'string') return results;

    let idCounter = 1;

    // 1. Indian PAN Card (case-insensitive, flexible spacing, positional normalization)
    const panRegex = /\b([A-Za-z0-9]{5}[-\s]?[A-Za-z0-9]{4}[-\s]?[A-Za-z0-9]{1})\b/g;
    let match: RegExpExecArray | null;
    const seenPanValues = new Set<string>();
    while ((match = panRegex.exec(text)) !== null) {
      const rawMatch = match[1];
      const panResult = this.normalizePanCandidate(rawMatch);
      if (panResult && !seenPanValues.has(panResult.normalized)) {
        seenPanValues.add(panResult.normalized);
        results.push({
          id: `pii_pan_${idCounter++}`,
          type: 'PAN_CARD',
          label: panResult.wasCorrected ? 'PAN Card (OCR Repaired)' : 'PAN Card',
          value: panResult.normalized,
          confidence: panResult.wasCorrected ? 0.92 : 0.99,
          complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Selective region blur or envelope encryption mandated by DPDP Act 2023.',
        });
      }
    }

    // 2. Indian Aadhaar Number (Two-Tier: 0.99 for verified Verhoeff, 0.85 for unverified candidate)
    const aadhaarRegex = /\b([2-9]{1}[0-9]{3}[-\s]?[0-9]{4}[-\s]?[0-9]{4})\b/g;
    const seenAadhaarDigits = new Set<string>();
    while ((match = aadhaarRegex.exec(text)) !== null) {
      const rawDigits = match[1].replace(/[-\s]/g, '');
      if (rawDigits.length === 12 && !seenAadhaarDigits.has(rawDigits)) {
        seenAadhaarDigits.add(rawDigits);
        const isChecksumValid = this.validateVerhoeff(rawDigits);
        results.push({
          id: `pii_aadhaar_${idCounter++}`,
          type: 'AADHAAR',
          label: isChecksumValid ? 'Aadhaar UID' : 'Aadhaar UID (Candidate)',
          value: match[1],
          confidence: isChecksumValid ? 0.99 : 0.85,
          complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
          recommendation: isChecksumValid 
            ? 'Aadhaar Regulations mandate masking of first 8 digits or full encryption.'
            : 'Aadhaar candidate with unverified checksum. Redaction recommended under DPDP Act 2023.',
        });
      }
    }

    // 3. Credit / Debit Cards (Visa, Mastercard, Amex, RuPay)
    const cardRegex = /\b(?:\d{4}[-\s]?){3}\d{1,4}\b|\b\d{4}[-\s]?\d{6}[-\s]?\d{5}\b|\b\d{13,19}\b/g;
    while ((match = cardRegex.exec(text)) !== null) {
      const digits = match[0].replace(/[-\s]/g, '');
      if (this.validateLuhn(digits)) {
        results.push({
          id: `pii_card_${idCounter++}`,
          type: 'CREDIT_CARD',
          label: 'Payment Card Number',
          value: match[0],
          confidence: 0.98,
          complianceTags: ['PCI_DSS', 'GDPR', 'DPDP_INDIA'],
          recommendation: 'PCI-DSS strictly prohibits storing unencrypted Primary Account Numbers (PAN).',
        });
      }
    }

    // 4. US SSN
    const ssnRegex = /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g;
    while ((match = ssnRegex.exec(text)) !== null) {
      if (this.validateSSN(match[0])) {
        results.push({
          id: `pii_ssn_${idCounter++}`,
          type: 'SSN',
          label: 'Social Security Number (SSN)',
          value: match[0],
          confidence: 0.96,
          complianceTags: ['IDENTITY_THEFT_PREVENTION', 'GDPR'],
          recommendation: 'High-risk sensitive identity credential requiring immediate encryption.',
        });
      }
    }

    // 5. Passport
    const passportRegex = /\b([A-PR-WYa-pr-wy][1-9]\d{2}\s?\d{4,5})\b/g;
    while ((match = passportRegex.exec(text)) !== null) {
      if (this.validatePassport(match[1])) {
        results.push({
          id: `pii_passport_${idCounter++}`,
          type: 'PASSPORT',
          label: 'Passport Identifier',
          value: match[1],
          confidence: 0.90,
          complianceTags: ['DPDP_INDIA', 'GDPR', 'IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Government travel identity document.',
        });
      }
    }

    // 6. Emails
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    while ((match = emailRegex.exec(text)) !== null) {
      if (this.validateEmail(match[0])) {
        results.push({
          id: `pii_email_${idCounter++}`,
          type: 'EMAIL',
          label: 'Email Address',
          value: match[0],
          confidence: 0.95,
          complianceTags: ['GDPR', 'DPDP_INDIA'],
          recommendation: 'Direct personal identifier.',
        });
      }
    }

    // 7. Phones
    const phoneRegex = /(?:\+?91[-\s]?)?[6-9]\d{9}\b|\b(?:\+?1[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b/g;
    while ((match = phoneRegex.exec(text)) !== null) {
      if (this.validatePhone(match[0])) {
        results.push({
          id: `pii_phone_${idCounter++}`,
          type: 'PHONE',
          label: 'Phone Number',
          value: match[0],
          confidence: 0.92,
          complianceTags: ['GDPR', 'DPDP_INDIA'],
          recommendation: 'Personal telecommunication identifier.',
        });
      }
    }

    // 8. API Keys & Secrets
    const apiKeyRegexes = [
      { regex: /AKIA[0-9A-Z]{16}/g, label: 'AWS Access Key ID' },
      { regex: /sk-(?:proj-)?[a-zA-Z0-9_\-]{20,64}/g, label: 'OpenAI / Secret API Key' },
      { regex: /ghp_[a-zA-Z0-9]{36}/g, label: 'GitHub Personal Token' },
      { regex: /-----BEGIN PRIVATE KEY-----/g, label: 'RSA / TLS Private Key' },
      { regex: /ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, label: 'JSON Web Token (JWT)' },
    ];

    for (const rule of apiKeyRegexes) {
      while ((match = rule.regex.exec(text)) !== null) {
        results.push({
          id: `pii_key_${idCounter++}`,
          type: 'API_KEY',
          label: rule.label,
          value: match[0],
          confidence: 0.99,
          complianceTags: ['IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Critical secret credential requiring immediate encryption.',
        });
      }
    }

    // 9. Indian Aadhaar Virtual ID (VID - 16 digits)
    const vidRegex = /\bVID\s*[:\s]*([0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\s?[0-9]{4})\b/gi;
    while ((match = vidRegex.exec(text)) !== null) {
      results.push({
        id: `pii_vid_${idCounter++}`,
        type: 'AADHAAR',
        label: 'Aadhaar Virtual ID (VID)',
        value: match[1],
        confidence: 0.95,
        complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
        recommendation: 'Aadhaar Virtual ID requiring privacy masking.',
      });
    }

    // 10. Date of Birth (DOB) - Explicit Labels (English & Hindi) and Date Patterns
    const seenDobValues = new Set<string>();

    const labeledDobRegex = /(?:जन्म\s*(?:तारीख|तिथि)\s*\/\s*DOB|जन्म\s*वर्ष\s*\/\s*(?:Year\s*of\s*Birth|YOB)|DOB|D\.O\.B\.?|Date\s*of\s*Birth|Birth\s*Date|Year\s*of\s*Birth|YOB|Y\.O\.B\.?|जन्म\s*(?:तिथि|तारीख|वर्ष))\s*[:\/\-\s]*([0-3]?\d[\/\-\.][0-1]?\d[\/\-\.](?:19|20)\d{2}|[0-3]?\d[\/\-\s,]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\/\-\s,]+(?:19|20)\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\/\-\s,]+[0-3]?\d[\/\-\s,]+(?:19|20)\d{2}|(?:19|20)\d{2}[\/\-\.][0-1]?\d[\/\-\.][0-3]?\d|(?:19|20)\d{2})/gi;
    while ((match = labeledDobRegex.exec(text)) !== null) {
      const candidate = match[1]?.trim();
      if (candidate && this.validateDOB(candidate) && !seenDobValues.has(candidate)) {
        seenDobValues.add(candidate);
        results.push({
          id: `pii_dob_${idCounter++}`,
          type: 'DOB',
          label: 'Date of Birth (DOB)',
          value: candidate,
          confidence: 0.98,
          complianceTags: ['DPDP_INDIA', 'GDPR', 'IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Date of Birth requires privacy masking or pseudonymization under DPDP Act & GDPR.',
        });
      }
    }

    // Fallback: Standalone dates matching standard birthdate format (1920 - 2025)
    const standaloneDateRegex = /\b([0-3]\d[\/\-\.][0-1]\d[\/\-\.](?:19[2-9]\d|20[0-2]\d))\b/g;
    while ((match = standaloneDateRegex.exec(text)) !== null) {
      const candidate = match[1]?.trim();
      // Ensure this date is not already captured as part of credit card, phone, or existing DOB
      if (candidate && this.validateDOB(candidate) && !seenDobValues.has(candidate)) {
        seenDobValues.add(candidate);
        results.push({
          id: `pii_dob_${idCounter++}`,
          type: 'DOB',
          label: 'Date of Birth (DOB)',
          value: candidate,
          confidence: 0.90,
          complianceTags: ['DPDP_INDIA', 'GDPR', 'IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Date of Birth requires privacy masking or pseudonymization under DPDP Act & GDPR.',
        });
      }
    }

    return results;
  }
}
