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

  // Positional PAN candidate normalization strictly by schema class with genuine digit requirement
  public static normalizePanCandidate(str: string): { 
    rawValue: string;
    normalized: string; 
    wasCorrected: boolean; 
    editCount: number;
    detectionConfidence: 'HIGH' | 'MEDIUM';
  } | null {
    if (!str) return null;
    const clean = str.replace(/[-\s]/g, '').toUpperCase();
    if (clean.length !== 10) return null;

    // Hard Gate: Positions 6-9 must contain AT LEAST 1 genuine digit before any repair is allowed.
    // An all-alpha word (e.g. "DISCUSSION", "DEPARTMENT") has 0 digits and must be rejected immediately.
    let genuineDigits = 0;
    for (let i = 5; i < 9; i++) {
      if (/^[0-9]$/.test(clean[i])) {
        genuineDigits++;
      }
    }
    if (genuineDigits === 0) {
      return null;
    }

    let editCount = 0;
    const chars = clean.split('');

    // Positions 1–5: Expected letters (A-Z)
    for (let i = 0; i < 5; i++) {
      const c = chars[i];
      if (c === '0') { chars[i] = 'O'; editCount++; }
      else if (c === '1') { chars[i] = 'I'; editCount++; }
      else if (c === '8') { chars[i] = 'B'; editCount++; }
      else if (!/^[A-Z]$/.test(chars[i])) return null;
    }

    // Positions 6–9: Expected digits (0-9)
    for (let i = 5; i < 9; i++) {
      const c = chars[i];
      if (c === 'O' || c === 'D' || c === 'Q') { chars[i] = '0'; editCount++; }
      else if (c === 'I' || c === 'L') { chars[i] = '1'; editCount++; }
      else if (c === 'B') { chars[i] = '8'; editCount++; }
      else if (c === 'S') { chars[i] = '5'; editCount++; }
      else if (c === 'Z') { chars[i] = '2'; editCount++; }
      else if (c === 'G') { chars[i] = '6'; editCount++; }
      else if (!/^[0-9]$/.test(chars[i])) return null;
    }

    // Position 10: Expected letter (A-Z)
    const c10 = chars[9];
    if (c10 === '0') { chars[9] = 'O'; editCount++; }
    else if (c10 === '1') { chars[9] = 'I'; editCount++; }
    else if (!/^[A-Z]$/.test(chars[9])) return null;

    // Budget Rule:
    // 0 edits: strict match (HIGH)
    // 1 edit: supported repair (HIGH)
    // 2 edits: review required (MEDIUM)
    // >= 3 edits: reject
    if (editCount >= 3) {
      return null;
    }

    const normalized = chars.join('');
    return {
      rawValue: str.trim(),
      normalized,
      wasCorrected: editCount > 0,
      editCount,
      detectionConfidence: editCount <= 1 && genuineDigits >= 2 ? 'HIGH' : 'MEDIUM',
    };
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

  public static readonly NAME_STOP_WORDS = new Set([
    'is', 'am', 'are', 'was', 'were', 'my', 'me', 'i', 'only', 'just',
    'email', 'mail', 'id', 'phone', 'mobile', 'contact', 'no', 'number', 'num',
    'address', 'addr', 'dob', 'date', 'birth', 'gender', 'sex', 'male', 'female',
    'order', 'ord', 'account', 'acc', 'card', 'pan', 'aadhaar', 'aadhar',
    'father', 'mother', 'husband', 'guardian', 'parent', 'relation',
    'student', 'roll', 'reg', 'registration', 'university', 'college', 'school',
    'please', 'kindly', 'request', 'application', 'leave', 'cancel', 'cancellation',
    'and', 'with', 'for', 'to', 'from', 'at', 'in', 'on', 'the', 'a', 'an'
  ]);

  public static extractCleanName(raw: string): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const firstLine = raw.split(/[\r\n,;]/)[0];
    const words = firstLine.trim().split(/\s+/);
    while (words.length > 0 && RegexDetector.NAME_STOP_WORDS.has(words[0].toLowerCase().replace(/[^a-z]/g, ''))) {
      words.shift();
    }
    const cleanWords: string[] = [];
    for (const w of words) {
      const lower = w.toLowerCase().replace(/[^a-z]/g, '');
      if (!lower || RegexDetector.NAME_STOP_WORDS.has(lower)) {
        break;
      }
      cleanWords.push(w.replace(/[^a-zA-Z]/g, ''));
    }
    if (cleanWords.length >= 1 && cleanWords.length <= 4) {
      return cleanWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    return null;
  }

  // Scan plain text and return all confirmed, validated PII items
  static scanText(text: string, options?: { allowCandidateCards?: boolean }): DetectedItem[] {
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
          rawValue: panResult.rawValue,
          normalizedValue: panResult.normalized,
          editCount: panResult.editCount,
          detectionConfidence: panResult.detectionConfidence,
          localizationState: panResult.wasCorrected ? 'DERIVED' : 'EXACT',
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

    // 3. Credit / Debit Cards (Visa, Mastercard, Amex, RuPay, Discover)
    const cardRegex = /\b(?:\d{4}[-\s]?){3}\d{1,4}\b|\b\d{4}[-\s]?\d{6}[-\s]?\d{5}\b|\b\d{13,19}\b/g;
    const seenCards = new Set<string>();
    while ((match = cardRegex.exec(text)) !== null) {
      const digits = match[0].replace(/[-\s]/g, '');
      if (seenCards.has(digits)) continue;
      seenCards.add(digits);
      const isLuhnValid = this.validateLuhn(digits);
      if (isLuhnValid) {
        results.push({
          id: `pii_card_${idCounter++}`,
          type: 'CREDIT_CARD',
          label: 'Payment Card Number',
          value: match[0],
          confidence: 0.98,
          complianceTags: ['PCI_DSS', 'GDPR', 'DPDP_INDIA'],
          recommendation: 'PCI-DSS strictly prohibits storing unencrypted Primary Account Numbers (PAN).',
        });
      } else if (
        (options?.allowCandidateCards || /\b(?:visa\s*platinum|mastercard\s*gold|specimen|sample\s*card)\b/i.test(text)) &&
        (digits.length === 16 || digits.length === 15)
      ) {
        results.push({
          id: `pii_card_${idCounter++}`,
          type: 'CREDIT_CARD',
          label: 'Payment Card Number (Candidate)',
          value: match[0],
          confidence: 0.88,
          complianceTags: ['PCI_DSS', 'GDPR', 'DPDP_INDIA'],
          recommendation: 'Payment card candidate number. PCI-DSS strictly prohibits storing unencrypted Primary Account Numbers.',
        });
      }
    }

    // 3b. Card Expiry & Security Data
    const cardExpRegex = /(?:valid\s*(?:thru|to)|expires(?:\s*end)?|exp(?:\s*date)?|card\s*expires)\s*[:\/\-\s]*([0-1]?\d[\/\-][2-3]\d)\b/gi;
    while ((match = cardExpRegex.exec(text)) !== null) {
      const expVal = match[1]?.trim();
      if (expVal && !results.some(r => r.value === expVal)) {
        results.push({
          id: `pii_card_exp_${idCounter++}`,
          type: 'CREDIT_CARD',
          label: 'Card Expiration Date',
          value: expVal,
          confidence: 0.92,
          complianceTags: ['PCI_DSS'],
          recommendation: 'Card expiration security parameter.',
        });
      }
    }

    // 3c. USCIS / Alien Registration Number (Permanent Resident / Green Card)
    const uscisRegex = /(?:USCIS\s*#?|USCIS\s*Number|Alien\s*Registration\s*#?|A#)\s*[:\-\s]*([0-9]{3}[-\s]?[0-9]{3}[-\s]?[0-9]{3}|[0-9]{9})\b/gi;
    while ((match = uscisRegex.exec(text)) !== null) {
      const uscisVal = match[1]?.trim();
      if (uscisVal && !results.some(r => r.value === uscisVal)) {
        results.push({
          id: `pii_uscis_${idCounter++}`,
          type: 'GOVERNMENT_ID',
          label: 'USCIS Number / Green Card ID',
          value: uscisVal,
          confidence: 0.98,
          complianceTags: ['IDENTITY_THEFT_PREVENTION', 'GDPR'],
          recommendation: 'Permanent Resident Alien Registration / USCIS credential.',
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

    // 7. Phones (Supports +91 / international, with 5-5 grouping, 3-3-4 grouping, or continuous 10 digits)
    const phoneRegex = /(?:\+91[-\s]?)?\b[6-9]\d{4}[-\s]\d{5}\b|(?:\+91[-\s]?)?\b[6-9]\d{2}[-\s]\d{3}[-\s]\d{4}\b|(?:\+91[-\s]?)?\b[6-9]\d{9}\b|\b(?:\+?1[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b/g;
    while ((match = phoneRegex.exec(text)) !== null) {
      if (this.validatePhone(match[0])) {
        results.push({
          id: `pii_phone_${idCounter++}`,
          type: 'PHONE',
          label: 'Phone Number',
          value: match[0].trim(),
          confidence: 0.95,
          complianceTags: ['GDPR', 'DPDP_INDIA'],
          recommendation: 'Personal telecommunication identifier.',
        });
      }
    }

    // 8. API Keys & Secrets
    const apiKeyRegexes = [
      { regex: /AKIA[0-9A-Z]{16}/g, label: 'AWS Access Key ID' },
      { regex: /(?:test_|demo_|live_|prod_)?sk[_-](?:proj[_-]|live[_-]|test[_-])?[a-zA-Z0-9_\-]{8,64}/g, label: 'API Secret Key' },
      { regex: /(?:test_|demo_)?api[_-](?:key[_-]|secret[_-])?[a-zA-Z0-9_\-]{6,64}/g, label: 'API Key / Secret' },
      { regex: /(?:demo_|test_)?tok[_-][a-zA-Z0-9_\-]{8,64}/g, label: 'Access / Auth Token' },
      { regex: /ghp_[a-zA-Z0-9]{36}/g, label: 'GitHub Personal Token' },
      { regex: /-----BEGIN PRIVATE KEY-----/g, label: 'RSA / TLS Private Key' },
      { regex: /ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, label: 'JSON Web Token (JWT)' },
    ];

    for (const rule of apiKeyRegexes) {
      while ((match = rule.regex.exec(text)) !== null) {
        if (!results.some(r => r.value === match![0])) {
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
    }

    // 8b. Labeled Secret Credentials & Passwords
    const labeledSecretRegex = /(?:(?:API\s*(?:Key|secret)|Access\s*Token|Secret\s*Key|Password|Auth\s*Token)(?:-like\s*value|\s*value|\s*secret)?\s*[:=\s]\s*)([^\s,;]+)/gi;
    while ((match = labeledSecretRegex.exec(text)) !== null) {
      const secretVal = match[1]?.trim();
      if (secretVal && secretVal.length >= 4 && !results.some(r => r.value === secretVal)) {
        results.push({
          id: `pii_secret_${idCounter++}`,
          type: 'API_KEY',
          label: 'Secret Credential / Token',
          value: secretVal,
          confidence: 0.98,
          complianceTags: ['IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Confidential secret token requiring immediate protection.',
        });
      }
    }

    // 8c. Labeled OTP (One-Time Password)
    const otpRegex = /(?:(?:OTP|One-Time\s*Password|Verification\s*Code)\s*[:\-\s=]\s*)([0-9]{4,8})\b/gi;
    while ((match = otpRegex.exec(text)) !== null) {
      const otpVal = match[1]?.trim();
      if (otpVal && !results.some(r => r.value === otpVal)) {
        results.push({
          id: `pii_otp_${idCounter++}`,
          type: 'API_KEY',
          label: 'One-Time Password (OTP)',
          value: otpVal,
          confidence: 0.98,
          complianceTags: ['IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Temporary authentication secret requiring immediate masking.',
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

    // 10. Masked Aadhaar Number (e.g. XXXX XXXX 1234 or •••• •••• 1234)
    const maskedAadhaarRegex = /(?<=(?:^|\s|[:;,-]))([xX*•]{4}[\s-]?[xX*•]{4}[\s-]?[0-9]{4})\b/gu;
    while ((match = maskedAadhaarRegex.exec(text)) !== null) {
      results.push({
        id: `pii_masked_aadhaar_${idCounter++}`,
        type: 'AADHAAR',
        label: 'Masked Aadhaar Number',
        value: match[1],
        confidence: 0.95,
        complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
        recommendation: 'Masked Aadhaar identifier requiring privacy safeguarding.',
      });
    }

    // 11. Date of Birth (DOB) - Explicit Labels (English & Hindi) and Date Patterns
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

    // 12. Full Name & Demographic Identity
    const namePrefixRegex = /(?:(?:my\s+)?(?:full\s*name\s*and\s*residence|name\s*and\s*residence|cardholder\s*name|cardholder|name\s*on\s*card|patient\s*name|customer\s*name|candidate\s*name|applicant\s*name|holder\s*name|full\s*name|surname|given\s*name|name|नाम)\s*(?:is|[:=\-\/])*\s*|(?:i\s+am|i'm)\s+)([a-zA-Z \t\.]{2,60})/gi;
    while ((match = namePrefixRegex.exec(text)) !== null) {
      const val = RegexDetector.extractCleanName(match[1]);
      if (val && val.length >= 2 && !/^(DOB|Date|Year|Male|Female|Gender|Country|Category|Expires|Valid)$/i.test(val)) {
        results.push({
          id: `pii_name_${idCounter++}`,
          type: 'NAME',
          label: 'Full Name / Demographic',
          value: val,
          confidence: 0.93,
          complianceTags: ['DPDP_INDIA', 'GDPR'],
          recommendation: 'Full legal name subject to DPDP & GDPR privacy safeguards.',
        });
      }
    }

    // 13. Guardian / Relative (Father's Name, Husband's Name, C/O, S/O, D/O, W/O)
    const guardianPrefixRegex = /(?:(?:father'?s\s*name|care\s*of|c\/o|s\/o|d\/o|w\/o|husband'?s\s*name|पिता\s*का\s*नाम|पति\s*का\s*नाम)\s*(?:is|[:=\-\/])*\s*)([a-zA-Z \t\.]{2,60})/gi;
    while ((match = guardianPrefixRegex.exec(text)) !== null) {
      const val = RegexDetector.extractCleanName(match[1]);
      if (val && val.length >= 3) {
        results.push({
          id: `pii_guardian_${idCounter++}`,
          type: 'NAME',
          label: 'Guardian / Relative Name',
          value: val,
          confidence: 0.92,
          complianceTags: ['DPDP_INDIA', 'GDPR'],
          recommendation: 'Family relationship details linked to citizen identity.',
        });
      }
    }

    // 14. Gender / Sex
    const genderRegex = /(?:(?:Gender|Sex|लिंग)\s*[:\-\/\s]\s*)(MALE|FEMALE|TRANSGENDER|पुरुष|महिला)\b/gi;
    while ((match = genderRegex.exec(text)) !== null) {
      results.push({
        id: `pii_gender_${idCounter++}`,
        type: 'CUSTOM',
        label: 'Gender Demographic',
        value: match[1],
        confidence: 0.95,
        complianceTags: ['DPDP_INDIA', 'GDPR'],
        recommendation: 'Gender demographic attribute.',
      });
    }

    // 15. Residential Address & PIN Code
    const addressRegex = /(?:(?:Address|Residential\s*Address|Residence|Residing\s*at|पता)\s*[:\-\/\s]\s*)([A-Za-z0-9\s,\-\/\.]{6,60})(?=[;\n\r]|(?:PIN|Phone|Email|City|State|DOB|Name|Account|Total|Synthetic|DOB|Country)|$)/gi;
    while ((match = addressRegex.exec(text)) !== null) {
      const addrVal = match[1]?.trim();
      if (addrVal && addrVal.length >= 8) {
        results.push({
          id: `pii_address_${idCounter++}`,
          type: 'ADDRESS',
          label: 'Residential Address',
          value: addrVal,
          confidence: 0.91,
          complianceTags: ['DPDP_INDIA', 'GDPR'],
          recommendation: 'Physical address revealing exact residence location.',
        });
      }
    }

    // 15b. Formatted Street Address (e.g. "80 Pearl Street Suite #345", "123 Main St, New York")
    const streetAddressRegex = /\b(\d{1,5}\s+[A-Za-z0-9\.\s]{2,30}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Suite|Ste)\b[^\n\r]{0,45})/gi;
    while ((match = streetAddressRegex.exec(text)) !== null) {
      const addrVal = match[1]?.trim();
      if (addrVal && addrVal.length >= 8 && !results.some(r => r.value === addrVal)) {
        results.push({
          id: `pii_street_address_${idCounter++}`,
          type: 'ADDRESS',
          label: 'Residential Street Address',
          value: addrVal,
          confidence: 0.92,
          complianceTags: ['DPDP_INDIA', 'GDPR'],
          recommendation: 'Physical street address revealing residence location.',
        });
      }
    }

    const pinRegex = /\b(?:PIN|Postal Code|Pincode|Pin Code)\s*[:\-\s]?([1-9][0-9]{2}\s?[0-9]{3})\b/gi;
    while ((match = pinRegex.exec(text)) !== null) {
      const pinVal = match[1]?.trim();
      if (pinVal && !results.some(r => r.value && r.value.includes(pinVal))) {
        results.push({
          id: `pii_pin_${idCounter++}`,
          type: 'ADDRESS',
          label: 'Postal PIN Code',
          value: pinVal,
          confidence: 0.92,
          complianceTags: ['DPDP_INDIA'],
          recommendation: 'Geographic postal code identifying local jurisdiction.',
        });
      }
    }

    // 16. Financial Information: Bank Account Number & IFSC Code
    const ifscRegex = /\b([A-Z]{4}0[A-Z0-9]{6})\b/g;
    while ((match = ifscRegex.exec(text)) !== null) {
      results.push({
        id: `pii_ifsc_${idCounter++}`,
        type: 'FINANCIAL_DATA',
        label: 'Bank IFSC Code',
        value: match[1],
        confidence: 0.98,
        complianceTags: ['PCI_DSS', 'DPDP_INDIA'],
        recommendation: 'Bank routing identifier linked to personal account.',
      });
    }

    const bankAccRegex = /(?:(?:A\/C(?:\s*(?:No|Number|\.))?|Account(?:\s*(?:No|Number|\.))?|खाता\s*(?:संख्या|नंबर)?)\s*[:\-\s]*)([0-9]{9,18})\b/gi;
    while ((match = bankAccRegex.exec(text)) !== null) {
      results.push({
        id: `pii_bank_acc_${idCounter++}`,
        type: 'FINANCIAL_DATA',
        label: 'Bank Account Number',
        value: match[1],
        confidence: 0.96,
        complianceTags: ['PCI_DSS', 'DPDP_INDIA'],
        recommendation: 'Sensitive bank account number.',
      });
    }

    // 17. Voter ID (EPIC) & Driving License
    const voterIdRegex = /\b([A-Z]{3}[0-9]{7})\b/g;
    while ((match = voterIdRegex.exec(text)) !== null) {
      results.push({
        id: `pii_voter_${idCounter++}`,
        type: 'GOVERNMENT_ID',
        label: 'Voter ID (EPIC)',
        value: match[1],
        confidence: 0.94,
        complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
        recommendation: 'Electoral identity number.',
      });
    }

    const dlRegex = /\b([A-Z]{2}[-\s]?[0-9]{2,4}[-\s]?[0-9]{7,11})\b/g;
    while ((match = dlRegex.exec(text)) !== null) {
      results.push({
        id: `pii_dl_${idCounter++}`,
        type: 'DRIVING_LICENSE',
        label: 'Driving License Number',
        value: match[1],
        confidence: 0.93,
        complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
        recommendation: 'Motor vehicle driving license document.',
      });
    }

    // 17b. Document Barcode Tracking Identifier (Permits & Driver IDs)
    const dlBarcodeRegex = /\b([0-9]{5}\s+[0-9]{5})\b/g;
    while ((match = dlBarcodeRegex.exec(text)) !== null) {
      const barVal = match[1]?.trim();
      if (barVal && !results.some(r => r.value === barVal)) {
        results.push({
          id: `pii_barcode_${idCounter++}`,
          type: 'GOVERNMENT_ID',
          label: 'Document Barcode Identifier',
          value: barVal,
          confidence: 0.90,
          complianceTags: ['IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Machine-readable document barcode tracking number.',
        });
      }
    }

    // 18. Contextual Migration, Tracking, and Record IDs (Label-Anchored)
    // E.g. "Migration ID: MIG-8-441-2021", "Record ID: REC-992-X", "Reference No: REF-2024-001"
    const contextualIdRegex = /(?:(Migration\s+ID|Record\s+ID|Tracking\s+ID|Certificate\s+ID|Registration\s+ID|Application\s+ID|File\s+No|Reference\s+(?:ID|No)|Ref\s+No|MIG\s+ID)\s*[:=\-]?\s*)([A-Za-z0-9]{2,6}[-#_][A-Za-z0-9]{1,6}[-#_][A-Za-z0-9]{1,8}(?:[-#_][A-Za-z0-9]{1,8})?)/gi;
    while ((match = contextualIdRegex.exec(text)) !== null) {
      const anchorLabel = match[1]?.trim();
      const idVal = match[2]?.trim();
      if (idVal && idVal.length >= 6 && /\d/.test(idVal) && /[A-Za-z]/.test(idVal)) {
        if (!results.some(r => r.value === idVal)) {
          results.push({
            id: `pii_record_id_${idCounter++}`,
            type: 'GOVERNMENT_ID',
            label: `${anchorLabel}`,
            value: idVal,
            rawValue: idVal,
            anchorLabel,
            confidence: 0.95,
            detectionConfidence: 'HIGH',
            localizationState: 'ANCHORED',
            complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
            recommendation: `Contextually anchored ${anchorLabel} contains sensitive tracking provenance.`,
          });
        }
      }
    }

    // 19. Segmented Alphanumeric Enterprise Identifiers with known prefixes (MIG-, VND-, REF-, REG-)
    const standaloneEnterpriseIdRegex = /\b((?:MIG|VND|REF|REG|SYS|USR)[-#_]\d{1,4}[-#_][A-Za-z0-9]{1,6}(?:[-#_][A-Za-z0-9]{1,8})?)\b/g;
    while ((match = standaloneEnterpriseIdRegex.exec(text)) !== null) {
      const val = match[1]?.trim();
      if (val && !results.some(r => r.value === val)) {
        results.push({
          id: `pii_record_token_${idCounter++}`,
          type: 'GOVERNMENT_ID',
          label: 'Record Identifier Token',
          value: val,
          rawValue: val,
          confidence: 0.90,
          detectionConfidence: 'HIGH',
          localizationState: 'ANCHORED',
          complianceTags: ['DPDP_INDIA'],
          recommendation: 'Structured enterprise record identifier requiring redaction.',
        });
      }
    }

    return results;
  }
}
