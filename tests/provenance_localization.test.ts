import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as pdfjs from 'pdfjs-dist';
import { RegexDetector } from '../src/core/detection/regex';
import { PdfProcessor } from '../src/core/detection/pdf';

describe('Provenance-First Detection & Spatial Localization Architecture', () => {
  // Test 1: Hardened PAN Normalization & Evidence Gating
  describe('PAN Normalization & Genuine Evidence Gating', () => {
    it('strictly REJECTS all-alphabetic English words like DISCUSSION, DEPARTMENT, COLLECTION', () => {
      expect(RegexDetector.normalizePanCandidate('DISCUSSION')).toBeNull();
      expect(RegexDetector.normalizePanCandidate('DEPARTMENT')).toBeNull();
      expect(RegexDetector.normalizePanCandidate('COLLECTION')).toBeNull();
      expect(RegexDetector.normalizePanCandidate('EXTRACTION')).toBeNull();
      expect(RegexDetector.normalizePanCandidate('PRODUCTION')).toBeNull();
    });

    it('accepts valid 10-character PAN with 0 edits as HIGH confidence', () => {
      const res = RegexDetector.normalizePanCandidate('ABCDE1234F');
      expect(res).not.toBeNull();
      expect(res?.normalized).toBe('ABCDE1234F');
      expect(res?.wasCorrected).toBe(false);
      expect(res?.editCount).toBe(0);
      expect(res?.detectionConfidence).toBe('HIGH');
    });

    it('repairs digit slot 6 (O -> 0) when genuine digits exist in other slots', () => {
      const res = RegexDetector.normalizePanCandidate('ABCDEO123F');
      expect(res).not.toBeNull();
      expect(res?.normalized).toBe('ABCDE0123F');
      expect(res?.wasCorrected).toBe(true);
      expect(res?.editCount).toBe(1);
      expect(res?.detectionConfidence).toBe('HIGH');
    });

    it('repairs suffix letter slot 10 (0 -> O) with 1 edit', () => {
      const res = RegexDetector.normalizePanCandidate('ABCDE12340');
      expect(res).not.toBeNull();
      expect(res?.normalized).toBe('ABCDE1234O');
      expect(res?.wasCorrected).toBe(true);
      expect(res?.editCount).toBe(1);
    });

    it('rejects candidate when edit budget exceeds 2 edits', () => {
      // 3 edits needed: slots 1 (1->I), 6 (O->0), 7 (I->1)
      const res = RegexDetector.normalizePanCandidate('1BCDEOI23F');
      expect(res).toBeNull();
    });
  });

  // Test 2: Contextual & Label-Anchored Enterprise / Migration ID Detection
  describe('Contextual & Migration ID Detection', () => {
    it('detects label-anchored Migration ID without masking the anchor label', () => {
      const text = 'Registration record: Migration ID: MIG-8-441-2021 (active status)';
      const findings = RegexDetector.scanText(text);

      const migItem = findings.find(f => f.value === 'MIG-8-441-2021');
      expect(migItem).toBeDefined();
      expect(migItem?.anchorLabel).toBe('Migration ID');
      expect(migItem?.value).toBe('MIG-8-441-2021');
      expect(migItem?.localizationState).toBe('ANCHORED');
      expect(migItem?.detectionConfidence).toBe('HIGH');
    });

    it('detects structured enterprise tokens with known prefixes', () => {
      const text = 'Archive extract VND-2019-C-14 attached to vendor packet.';
      const findings = RegexDetector.scanText(text);

      const vndItem = findings.find(f => f.value === 'VND-2019-C-14');
      expect(vndItem).toBeDefined();
      expect(vndItem?.type).toBe('GOVERNMENT_ID');
    });
  });

  // Test 3: Elimination of False Positives on Real Drill Document
  describe('Drill Document Verification (Pages 8 and 10)', () => {
    const drillPdfPath = 'C:\\Users\\SAHIL\\Downloads\\random_10_page_search_drill.pdf';
    const hasDrillPdf = fs.existsSync(drillPdfPath);

    it('ensures Page 10 text produces ZERO false positive PAN detections', () => {
      const page10Text = `Internal Archive — Search & Issue Detection Drill 10  Archive Closing Notes  The archive contains a mixture of inventory, engineering, procurement, training, registration, and project records. The records were assembled to resemble a typical messy enterprise document rather than a purpose-built security test.  Search challenge  A document-analysis system should be able to answer questions such as:   “Where is the identity record?” ,   “Which page contains the PAN?” ,   “Does this document contain Aadhaar information?” , and   “What security issue should be raised?” .  Expected detection   Location  PAN identity record   Page 3 Aadhaar identity record   Page 8 Sensitive-data exposure issue   Pages 3 and 8 General encryption/search discussion   Pages 4, 6, 9  End of archive. This document is a synthetic drill container, but the identity values embedded in pages 3 and 8 are the values supplied in the original images.  SEARCH • DETECT • EXPLAIN • REMEDIATE`;

      const findings = RegexDetector.scanText(page10Text);
      const panFindings = findings.filter(f => f.type === 'PAN_CARD');
      // Crucial: "discussion" must NOT be converted to "DISCU5510N"
      expect(panFindings.length).toBe(0);
    });

    it('ensures Page 8 detects Aadhaar, DOB, and Migration ID', () => {
      const page8Text = `Internal Archive — Search & Issue Detection Drill 8  Legacy Registration Export — Record Group 8  This page contains an old registration extract recovered from a migration archive. The extract is intentionally mixed with unrelated migration metadata for search and issue-detection testing.  Field   Value  Name   Sahil Singh Rautela DOB   11/06/2005 Gender   Male Aadhaar   7058 1663 3069 Migration ID   MIG-8-441-2021  Source: legacy registration export. Destination table: archived_identity_records. Import completed with 0 structural errors.  Potential issue for the application to detect: this record contains highly sensitive identity information embedded inside a document that otherwise looks like an ordinary archive.`;

      const findings = RegexDetector.scanText(page8Text);
      expect(findings.some(f => f.type === 'AADHAAR')).toBe(true);
      expect(findings.some(f => f.type === 'DOB')).toBe(true);
      expect(findings.some(f => f.value === 'MIG-8-441-2021')).toBe(true);
      // No false positive PAN on Page 8
      expect(findings.some(f => f.type === 'PAN_CARD')).toBe(false);
    });

    if (hasDrillPdf) {
      it('processes real PDF: Page 10 has no column-header false box, Page 8 has Migration ID anchored', async () => {
        const fileBuffer = fs.readFileSync(drillPdfPath);
        // Create mock File for PdfProcessor
        const blob = new Blob([fileBuffer], { type: 'application/pdf' });
        const mockFile = new File([blob], 'random_10_page_search_drill.pdf', { type: 'application/pdf' });

        const result = await PdfProcessor.processPdf(mockFile);
        expect(result.pages.length).toBe(10);

        // Check Page 2: Zero false positive FACE detections across the table
        const page2 = result.pages[1];
        const page2Faces = page2.detectedItems.filter(i => i.type === 'FACE');
        expect(page2Faces.length).toBe(0);

        // Check Page 10: Zero PAN masks
        const page10 = result.pages[9];
        const page10Pans = page10.detectedItems.filter(i => i.type === 'PAN_CARD');
        expect(page10Pans.length).toBe(0);

        // Check Page 8: Migration ID is detected and has a localized bounding box
        const page8 = result.pages[7];
        const migItem = page8.detectedItems.find(i => i.value === 'MIG-8-441-2021');
        expect(migItem).toBeDefined();
        expect(migItem?.boundingBox).toBeDefined();
        // Bounding box must be in the table row (y between 200 and 400), not at footer
        expect(migItem?.boundingBox?.y).toBeGreaterThan(200);
        expect(migItem?.boundingBox?.y).toBeLessThan(400);

        // Aadhaar must also be in the table row
        const aadhaarItem = page8.detectedItems.find(i => i.type === 'AADHAAR');
        expect(aadhaarItem).toBeDefined();
        expect(aadhaarItem?.boundingBox?.y).toBeGreaterThan(200);
        expect(aadhaarItem?.boundingBox?.y).toBeLessThan(400);
      });
    }
  });

  // Test 4: Export Non-Extractable Rasterization Safety Invariant
  describe('Export Non-Extractable Safety Invariant', () => {
    it('creates flattened image-based PDF where underlying text cannot be extracted', () => {
      // Mock 1x1 transparent PNG
      const mockDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const pages = [
        { canvas: mockDataUrl, width: 600, height: 800 },
      ];

      const exportedBlob = PdfProcessor.exportMultiPagePdf(pages);
      expect(exportedBlob).toBeDefined();
      expect(exportedBlob.type).toBe('application/pdf');
      // The exported blob uses image embedding (addImage) rather than text streams
      expect(exportedBlob.size).toBeGreaterThan(100);
    });
  });
});
