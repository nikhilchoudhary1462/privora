import { describe, it, expect } from 'vitest';
import { RegexDetector } from '../src/core/detection/regex';
import { analyzeFacesFromImageData } from '../src/core/detection/face.worker';
import { BoundingBox } from '../src/types';
import fs from 'fs';
import path from 'path';

describe('Phase 1: Deterministic Detection - Hardened Regex PII Suite', () => {

  // --- PAN Validation Tests ---
  describe('PAN Card Detection & Validation', () => {
    it('should detect and validate all standard valid uppercase PAN cards', () => {
      const validPANs = ['ABCDE1234F', 'XYZPQ9876A', 'AAAPA0001A', 'BLRPN5432G'];
      validPANs.forEach(pan => {
        expect(RegexDetector.validatePAN(pan)).toBe(true);
        const detected = RegexDetector.scanText(`Customer PAN is ${pan} for tax.`);
        expect(detected.some(d => d.type === 'PAN_CARD' && d.value === pan)).toBe(true);
      });
    });

    it('should reject invalid PAN formats and partial fragments', () => {
      const invalidPANs = [
        '12345ABCDE',   // Digits first
        'ABCDE1234',    // Too short (9 chars)
        'ABCDE12345',   // Missing trailing letter
        'ABC12345F',    // 3 letters instead of 5
        'ABCDEF1234F',  // 6 letters
      ];

      invalidPANs.forEach(pan => {
        expect(RegexDetector.validatePAN(pan)).toBe(false);
        const detected = RegexDetector.scanText(`Invalid value ${pan}`);
        expect(detected.some(d => d.type === 'PAN_CARD')).toBe(false);
      });

      // Strict validatePAN rejects lowercase, but scanText repairs it via positional OCR normalization
      expect(RegexDetector.validatePAN('abcde1234f')).toBe(false);
      const repaired = RegexDetector.scanText('Scanned value abcde1234f');
      expect(repaired.some(d => d.type === 'PAN_CARD' && d.value === 'ABCDE1234F')).toBe(true);
    });

    it('should apply positional OCR normalization for PAN candidates (slots 1-5 & 10 letters, slots 6-9 digits)', () => {
      expect(RegexDetector.normalizePanCandidate('1BCDE1234F')?.normalized).toBe('IBCDE1234F');
      expect(RegexDetector.normalizePanCandidate('ABCDE12340')?.normalized).toBe('ABCDE1234O');
      expect(RegexDetector.normalizePanCandidate('ABCDEO123F')?.normalized).toBe('ABCDE0123F');
      expect(RegexDetector.normalizePanCandidate('ABCDEI23BF')?.normalized).toBe('ABCDE1238F');
      expect(RegexDetector.normalizePanCandidate('INCOMETAXD')).toBeNull();
    });
  });

  // --- Aadhaar Validation Tests ---
  describe('Aadhaar UID Detection & Verhoeff Checksum', () => {
    it('should detect valid Aadhaar numbers passing Verhoeff checksum algorithm', () => {
      // Mathematically generated Verhoeff Aadhaar format numbers
      const aadhaar1 = RegexDetector.generateVerhoeffChecksum('23456789012');
      const aadhaar2 = RegexDetector.generateVerhoeffChecksum('99999999001');
      const aadhaar3 = RegexDetector.generateVerhoeffChecksum('36759834601');

      const validAadhaars = [
        `${aadhaar1.substring(0, 4)} ${aadhaar1.substring(4, 8)} ${aadhaar1.substring(8, 12)}`,
        `${aadhaar2.substring(0, 4)} ${aadhaar2.substring(4, 8)} ${aadhaar2.substring(8, 12)}`,
        `${aadhaar3.substring(0, 4)} ${aadhaar3.substring(4, 8)} ${aadhaar3.substring(8, 12)}`,
      ];

      validAadhaars.forEach(aadhaar => {
        const raw = aadhaar.replace(/\D/g, '');
        expect(RegexDetector.validateVerhoeff(raw)).toBe(true);
        const detected = RegexDetector.scanText(`Aadhaar card number: ${aadhaar}`);
        expect(detected.some(d => d.type === 'AADHAAR' && d.confidence === 0.99)).toBe(true);
      });
    });

    it('should handle two-tier Aadhaar classification (verified vs unverified) and reject malformed lengths/prefixes', () => {
      const validBase = RegexDetector.generateVerhoeffChecksum('23456789012');
      const lastDigit = parseInt(validBase.slice(-1), 10);
      const corruptLastDigit = (lastDigit + 1) % 10;
      const corruptedChecksum = validBase.substring(0, 11) + corruptLastDigit;

      // Verhoeff algorithm strictly distinguishes corrupted check digit
      expect(RegexDetector.validateVerhoeff(validBase)).toBe(true);
      expect(RegexDetector.validateVerhoeff(corruptedChecksum)).toBe(false);

      // Two-tier Aadhaar architecture: Unverified Verhoeff is captured as Candidate (confidence 0.85) to prevent silent leakage
      const detectedCorrupt = RegexDetector.scanText(`Candidate number: ${corruptedChecksum}`);
      expect(detectedCorrupt.some(d => d.type === 'AADHAAR' && d.confidence === 0.85)).toBe(true);

      // Structurally invalid formats (wrong length or starting with 0/1) are strictly rejected
      const invalidAadhaars = [
        '2345 6789 012',   // 11 digits
        '2345 6789 01234', // 13 digits
        '0345 6789 0123',  // Starts with 0
        '1345 6789 0123',  // Starts with 1
      ];

      invalidAadhaars.forEach(aadhaar => {
        const detected = RegexDetector.scanText(`Candidate number: ${aadhaar}`);
        expect(detected.some(d => d.type === 'AADHAAR')).toBe(false);
      });
    });

    it('should detect valid Aadhaar regardless of spacing variations (spaces, hyphens, continuous)', () => {
      const validBase = RegexDetector.generateVerhoeffChecksum('23456789012');
      const formatted = [
        `${validBase.substring(0, 4)}-${validBase.substring(4, 8)}-${validBase.substring(8, 12)}`,
        validBase,
        `${validBase.substring(0, 4)} ${validBase.substring(4, 8)} ${validBase.substring(8, 12)}`
      ];

      formatted.forEach(f => {
        const detected = RegexDetector.scanText(`UID: ${f}`);
        expect(detected.some(d => d.type === 'AADHAAR')).toBe(true);
      });
    });
  });

  // --- Credit Card Validation Tests ---
  describe('Credit Card Detection & Luhn Algorithm', () => {
    it('should detect valid Visa, Mastercard, and Amex numbers passing Luhn checksum', () => {
      const validCards = [
        '4532 0150 9942 1825', // Visa 16-digit (valid Luhn)
        '5105 1051 0510 5100', // Mastercard (valid Luhn)
        '3782 822463 10005',   // Amex 15-digit (valid Luhn)
      ];

      validCards.forEach(card => {
        expect(RegexDetector.validateLuhn(card)).toBe(true);
        const detected = RegexDetector.scanText(`Card number: ${card}`);
        expect(detected.some(d => d.type === 'CREDIT_CARD')).toBe(true);
      });
    });

    it('should reject invalid Luhn checksums and small numbers', () => {
      const invalidCards = [
        '4532 0150 9942 1823', // Failed Luhn
        '1234 5678',           // Too short
        '0000 0000 0000 0000', // All zeros
      ];

      invalidCards.forEach(card => {
        const detected = RegexDetector.scanText(`Testing card: ${card}`);
        expect(detected.some(d => d.type === 'CREDIT_CARD')).toBe(false);
      });
    });
  });

  // --- Phone Number Tests ---
  describe('Phone Number Validation', () => {
    it('should detect valid Indian (+91 / 10-digit starting with 6-9) and US phones', () => {
      const validPhones = [
        '+91 9876543210',
        '9876543210',
        '7890123456',
        '+1 (555) 349-2091',
      ];

      validPhones.forEach(phone => {
        expect(RegexDetector.validatePhone(phone)).toBe(true);
        const detected = RegexDetector.scanText(`Contact me at ${phone} today.`);
        expect(detected.some(d => d.type === 'PHONE')).toBe(true);
      });
    });

    it('should reject invalid phone numbers (10 digits starting with 0-5)', () => {
      const invalidPhones = ['1234567890', '0987654321', '5551234567'];
      invalidPhones.forEach(phone => {
        expect(RegexDetector.validatePhone(phone)).toBe(false);
      });
    });
  });

  // --- Email Tests ---
  describe('Email Validation', () => {
    it('should detect valid RFC compliant emails', () => {
      const validEmails = [
        'user@example.com',
        'john.doe+privacy@security.org.in',
        'alex_mercer123@acme-corp.co.uk',
      ];

      validEmails.forEach(email => {
        expect(RegexDetector.validateEmail(email)).toBe(true);
        const detected = RegexDetector.scanText(`Send to ${email} please.`);
        expect(detected.some(d => d.type === 'EMAIL' && d.value === email)).toBe(true);
      });
    });

    it('should reject malformed email strings', () => {
      const invalidEmails = ['user@', '@example.com', 'user@.com', 'user.com'];
      invalidEmails.forEach(email => {
        expect(RegexDetector.validateEmail(email)).toBe(false);
      });
    });
  });

  // --- US SSN Tests ---
  describe('US SSN Validation', () => {
    it('should detect valid SSN formats and reject invalid area/group rules', () => {
      expect(RegexDetector.validateSSN('123-45-6789')).toBe(true);
      expect(RegexDetector.validateSSN('000-12-3456')).toBe(false);
      expect(RegexDetector.validateSSN('666-12-3456')).toBe(false);
      expect(RegexDetector.validateSSN('900-12-3456')).toBe(false);
      expect(RegexDetector.validateSSN('123-00-6789')).toBe(false);
      expect(RegexDetector.validateSSN('123-45-0000')).toBe(false);
    });
  });
});

describe('Phase 1: Deterministic Face Detection (0, 1, and Multiple Faces)', () => {

  function createSyntheticImage(
    width: number,
    height: number,
    facesToDraw: { cx: number; cy: number; radius: number }[]
  ): ImageData {
    const buffer = new Uint8ClampedArray(width * height * 4);

    // Background slate color
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 30;
      buffer[i + 1] = 41;
      buffer[i + 2] = 59;
      buffer[i + 3] = 255;
    }

    // Draw skin tone facial clusters
    facesToDraw.forEach(face => {
      const r = face.radius;
      for (let y = Math.max(0, face.cy - r); y < Math.min(height, face.cy + r); y++) {
        for (let x = Math.max(0, face.cx - r); x < Math.min(width, face.cx + r); x++) {
          const dist = Math.sqrt((x - face.cx) ** 2 + (y - face.cy) ** 2);
          if (dist <= r) {
            const idx = (y * width + x) * 4;
            buffer[idx] = 235;    // R
            buffer[idx + 1] = 180;// G
            buffer[idx + 2] = 140;// B
            buffer[idx + 3] = 255;
          }
        }
      }
    });

    return {
      data: buffer,
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData;
  }

  it('should detect 0 faces on blank/non-biometric image', () => {
    const imgData = createSyntheticImage(200, 200, []);
    const faces = analyzeFacesFromImageData(imgData);
    expect(faces.length).toBe(0);
  });

  it('should detect exactly 1 face on single-face portrait', () => {
    const imgData = createSyntheticImage(300, 300, [{ cx: 150, cy: 150, radius: 40 }]);
    const faces = analyzeFacesFromImageData(imgData);
    expect(faces.length).toBe(1);
    expect(faces[0].width).toBeGreaterThanOrEqual(40);
    expect(faces[0].x).toBeLessThan(150);
  });

  it('should detect multiple faces on multi-subject photo', () => {
    const imgData = createSyntheticImage(500, 300, [
      { cx: 120, cy: 150, radius: 35 },
      { cx: 380, cy: 150, radius: 35 },
    ]);
    const faces = analyzeFacesFromImageData(imgData);
    expect(faces.length).toBe(2);
  });
});

describe('Phase 1: Deterministic Detection - Date of Birth (DOB) Suite', () => {
  it('should validate standard DOB formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, Month Names)', () => {
    expect(RegexDetector.validateDOB('15/08/1990')).toBe(true);
    expect(RegexDetector.validateDOB('01-01-1985')).toBe(true);
    expect(RegexDetector.validateDOB('1992-12-31')).toBe(true);
    expect(RegexDetector.validateDOB('15 Jan 1990')).toBe(true);
    expect(RegexDetector.validateDOB('15-August-1992')).toBe(true);
    expect(RegexDetector.validateDOB('1990')).toBe(true);
  });

  it('should reject invalid dates, impossible months, and futuristic/past limits', () => {
    expect(RegexDetector.validateDOB('32/01/1990')).toBe(false); // Day 32
    expect(RegexDetector.validateDOB('15/13/1990')).toBe(false); // Month 13
    expect(RegexDetector.validateDOB('31/02/1990')).toBe(false); // Feb 31
    expect(RegexDetector.validateDOB('15/08/1850')).toBe(false); // Year < 1900
    expect(RegexDetector.validateDOB('15/08/2099')).toBe(false); // Futuristic
  });

  it('should detect DOB from multi-lingual government ID phrases and OCR text', () => {
    const sampleAadhaar = 'Name: Rajesh Kumar, जन्म तारीख / DOB: 14/07/1988, Gender: Male';
    const detected1 = RegexDetector.scanText(sampleAadhaar);
    expect(detected1.some(d => d.type === 'DOB' && d.value === '14/07/1988')).toBe(true);

    const samplePan = 'INCOME TAX DEPARTMENT, Date of Birth: 22-11-1993, Permanent Account Number';
    const detected2 = RegexDetector.scanText(samplePan);
    expect(detected2.some(d => d.type === 'DOB' && d.value === '22-11-1993')).toBe(true);

    const sampleYob = 'Govt of India, जन्म वर्ष / Year of Birth: 1985';
    const detected3 = RegexDetector.scanText(sampleYob);
    expect(detected3.some(d => d.type === 'DOB' && d.value === '1985')).toBe(true);
  });
});

describe('Phase 1: Zero-Network & Privacy Architecture Check', () => {
  it('should verify index.html contains NO remote CDN or Google Fonts links', () => {
    const htmlPath = path.resolve(__dirname, '../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    expect(htmlContent).not.toContain('fonts.googleapis.com');
    expect(htmlContent).not.toContain('fonts.gstatic.com');
    expect(htmlContent).not.toContain('cdn.jsdelivr.net');
    expect(htmlContent).not.toContain('cdnjs.cloudflare.com');
  });

  it('should verify extension manifest uses local bundled background script and permissions', () => {
    const manifestPath = path.resolve(__dirname, '../extension/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.content_scripts[0].js).toContain('content.js');
  });

  it('should verify extension/content.js uses synthetic checkerboard overwrite and NO mosaic downsampling', () => {
    const contentJsPath = path.resolve(__dirname, '../extension/content.js');
    const contentJs = fs.readFileSync(contentJsPath, 'utf8');

    // Verify synthetic pattern is used
    expect(contentJs).toContain('Synthetic Checkerboard Privacy Mask');
    expect(contentJs).toContain('#0f172a');
    expect(contentJs).toContain('rgba(15, 23, 42, 0.98)');
    expect(contentJs).toContain('rgba(30, 41, 59, 0.96)');

    // Verify downsample mosaic canvas scaling is eliminated
    expect(contentJs).not.toContain('offCtx.drawImage(canvas');
    expect(contentJs).not.toContain('offCtx.imageSmoothingEnabled');
  });

  it('should verify extension/content.js retains auto-retrace and restore functionality', () => {
    const contentJsPath = path.resolve(__dirname, '../extension/content.js');
    const contentJs = fs.readFileSync(contentJsPath, 'utf8');

    expect(contentJs).toContain('retraceAndRestoreImage');
    expect(contentJs).toContain('unblurredSlices');
    expect(contentJs).toContain('updateFloatingHub');
  });

  it('should verify extension uses non-blocking floating prompt before full-screen modal', () => {
    const contentJsPath = path.resolve(__dirname, '../extension/content.js');
    const contentJs = fs.readFileSync(contentJsPath, 'utf8');

    expect(contentJs).toContain('showFileInterceptionPrompt');
    expect(contentJs).toContain('showTextInterceptionPrompt');
    expect(contentJs).toContain('aegis-file-intercept-prompt');
    expect(contentJs).toContain('aegis-text-intercept-prompt');
  });
});
