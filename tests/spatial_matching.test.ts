import { describe, it, expect } from 'vitest';
import { RegexDetector } from '../src/core/detection/regex';

describe('Spatial & Bounding Box Regressions (Plan Verification)', () => {
  // Test 1: Decomposed Positional PAN Normalization Rules
  describe('Positional PAN Normalization Decomposition', () => {
    it('should correctly normalize prefix letter OCR errors (slot 1)', () => {
      const res = RegexDetector.normalizePanCandidate('1BCDE1234F');
      expect(res).not.toBeNull();
      expect(res?.normalized).toBe('IBCDE1234F');
      expect(res?.wasCorrected).toBe(true);
    });

    it('should correctly normalize suffix letter OCR errors (slot 10)', () => {
      const res = RegexDetector.normalizePanCandidate('ABCDE12340');
      expect(res).not.toBeNull();
      expect(res?.normalized).toBe('ABCDE1234O');
      expect(res?.wasCorrected).toBe(true);
    });

    it('should correctly normalize digit slot 6 (O -> 0)', () => {
      const res = RegexDetector.normalizePanCandidate('ABCDEO123F');
      expect(res).not.toBeNull();
      expect(res?.normalized).toBe('ABCDE0123F');
      expect(res?.wasCorrected).toBe(true);
    });

    it('should correctly normalize digit slots 7 and 9 (I -> 1, B -> 8)', () => {
      const res = RegexDetector.normalizePanCandidate('ABCDEI23BF');
      expect(res).not.toBeNull();
      expect(res?.normalized).toBe('ABCDE1238F');
      expect(res?.wasCorrected).toBe(true);
    });

    it('should reject non-PAN words even if they contain alphanumeric characters', () => {
      expect(RegexDetector.normalizePanCandidate('INCOMETAXD')).toBeNull();
      expect(RegexDetector.normalizePanCandidate('GOVTOFINDIA')).toBeNull();
      expect(RegexDetector.normalizePanCandidate('DEPARTMENT')).toBeNull();
    });
  });

  // Test 2: Aadhaar Two-Tier Checksum Retention
  describe('Aadhaar Two-Tier Checksum Retention', () => {
    it('should assign Tier 1 (0.99) for mathematically valid Verhoeff', () => {
      const validAadhaar = RegexDetector.generateVerhoeffChecksum('23456789012');
      const formatted = `${validAadhaar.substring(0, 4)} ${validAadhaar.substring(4, 8)} ${validAadhaar.substring(8, 12)}`;
      const items = RegexDetector.scanText(`Aadhaar: ${formatted}`);
      expect(items.length).toBe(1);
      expect(items[0].type).toBe('AADHAAR');
      expect(items[0].confidence).toBe(0.99);
      expect(items[0].label).toBe('Aadhaar UID');
    });

    it('should assign Tier 2 (0.85) for unverified checksum dummy/OCR card without dropping', () => {
      // Dummy Aadhaar card number often used in testing: 2345 6789 0123
      const dummyAadhaar = '2345 6789 0123';
      const isVerhoeff = RegexDetector.validateVerhoeff(dummyAadhaar.replace(/\s/g, ''));
      expect(isVerhoeff).toBe(false); // confirms invalid checksum

      // Must NOT be dropped
      const items = RegexDetector.scanText(`Aadhaar: ${dummyAadhaar}`);
      expect(items.length).toBe(1);
      expect(items[0].type).toBe('AADHAAR');
      expect(items[0].confidence).toBe(0.85);
      expect(items[0].label).toBe('Aadhaar UID (Candidate)');
    });
  });

  // Test 3: Spatially Coherent Line Digit-Stream Matching Simulation
  describe('Aadhaar Spatially Coherent Line Digit-Stream Simulation', () => {
    // Helper to simulate the exact line digit-stream algorithm from ocr.ts
    function matchLineAadhaar(
      lineBoxes: { text: string; x: number; y: number; width: number; height: number }[],
      targetAadhaar: string
    ) {
      const targetDigits = targetAadhaar.replace(/\D/g, '');
      let lineDigits = '';
      const digitToBoxMap: typeof lineBoxes[0][] = [];

      for (const wb of lineBoxes) {
        const wbDigits = wb.text.replace(/\D/g, '');
        for (let d = 0; d < wbDigits.length; d++) {
          lineDigits += wbDigits[d];
          digitToBoxMap.push(wb);
        }
      }

      const matchIndex = lineDigits.indexOf(targetDigits);
      if (matchIndex !== -1) {
        const matchedSet = new Set<typeof lineBoxes[0]>();
        for (let k = matchIndex; k < matchIndex + 12; k++) {
          matchedSet.add(digitToBoxMap[k]);
        }
        return Array.from(matchedSet);
      }
      return null;
    }

    const target = '234567890123';

    it('should resolve standard 4+4+4 split into 3 contributing boxes', () => {
      const boxes = [
        { text: '2345', x: 100, y: 300, width: 40, height: 20 },
        { text: '6789', x: 150, y: 300, width: 40, height: 20 },
        { text: '0123', x: 200, y: 300, width: 40, height: 20 },
      ];
      const matched = matchLineAadhaar(boxes, target);
      expect(matched?.length).toBe(3);
    });

    it('should resolve 8+4 split into 2 contributing boxes', () => {
      const boxes = [
        { text: '23456789', x: 100, y: 300, width: 80, height: 20 },
        { text: '0123', x: 190, y: 300, width: 40, height: 20 },
      ];
      const matched = matchLineAadhaar(boxes, target);
      expect(matched?.length).toBe(2);
    });

    it('should resolve 4+8 split into 2 contributing boxes', () => {
      const boxes = [
        { text: '2345', x: 100, y: 300, width: 40, height: 20 },
        { text: '67890123', x: 150, y: 300, width: 80, height: 20 },
      ];
      const matched = matchLineAadhaar(boxes, target);
      expect(matched?.length).toBe(2);
    });

    it('should resolve single combined 12-digit box', () => {
      const boxes = [
        { text: '234567890123', x: 100, y: 300, width: 120, height: 20 },
      ];
      const matched = matchLineAadhaar(boxes, target);
      expect(matched?.length).toBe(1);
    });
  });

  // Test 4: PAN Spatial Bounding Box Isolation (Substring Protection)
  describe('PAN Substring Protection & Fragmented Matching', () => {
    function matchLinePan(
      lineBoxes: { text: string; x: number; y: number; width: number; height: number }[],
      targetPan: string
    ) {
      const target = targetPan.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

      // Pass 1: Single box
      for (const wb of lineBoxes) {
        const clean = wb.text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (clean === target) return [wb];
        const pos = RegexDetector.normalizePanCandidate(clean);
        if (pos?.normalized === target) return [wb];
      }

      // Pass 2: Fragmented adjacent boxes
      for (let i = 0; i < lineBoxes.length - 1; i++) {
        const combined = (lineBoxes[i].text + lineBoxes[i + 1].text).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (combined === target) return [lineBoxes[i], lineBoxes[i + 1]];
      }

      return null;
    }

    it('should strictly target ABCDE1234F and reject tiny substring word "A"', () => {
      const lineBoxes = [
        { text: 'INCOME', x: 20, y: 50, width: 50, height: 18 },
        { text: 'TAX', x: 80, y: 50, width: 30, height: 18 },
        { text: 'DEPARTMENT', x: 120, y: 50, width: 80, height: 18 },
        { text: 'A', x: 210, y: 50, width: 12, height: 18 },
        { text: 'ABCDE1234F', x: 100, y: 150, width: 100, height: 22 },
      ];

      const matched = matchLinePan(lineBoxes, 'ABCDE1234F');
      expect(matched?.length).toBe(1);
      expect(matched?.[0].text).toBe('ABCDE1234F');
      expect(matched?.[0].text).not.toBe('A');
    });

    it('should match fragmented PAN across adjacent words on the same line', () => {
      const lineBoxes = [
        { text: 'ABCDE', x: 100, y: 150, width: 50, height: 22 },
        { text: '1234F', x: 155, y: 150, width: 50, height: 22 },
      ];

      const matched = matchLinePan(lineBoxes, 'ABCDE1234F');
      expect(matched?.length).toBe(2);
      expect(matched?.[0].text).toBe('ABCDE');
      expect(matched?.[1].text).toBe('1234F');
    });
  });
});
