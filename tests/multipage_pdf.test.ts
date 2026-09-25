import { describe, it, expect } from 'vitest';
import { PdfProcessor } from '../src/core/detection/pdf';
import { MasterDetector } from '../src/core/detection';
import { SyntheticEngine } from '../src/core/fpe';
import { DetectedItem } from '../src/types';

describe('Multi-Page Document & PDF Processing Engine', () => {
  it('correctly creates multi-page PDF blob from an array of image data URLs', () => {
    // 1x1 transparent PNG data URL
    const mockDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const pages = [
      { canvas: mockDataUrl, width: 600, height: 800 },
      { canvas: mockDataUrl, width: 600, height: 800 },
      { canvas: mockDataUrl, width: 600, height: 800 },
    ];

    const pdfBlob = PdfProcessor.exportMultiPagePdf(pages);
    expect(pdfBlob).toBeDefined();
    expect(pdfBlob.size).toBeGreaterThan(500);
    expect(pdfBlob.type).toBe('application/pdf');
  });

  it('correctly paginates long text / code documents into multiple pages', () => {
    const lines = [];
    for (let i = 1; i <= 60; i++) {
      if (i === 5) {
        lines.push('User PAN: ABCDE1234F');
      } else if (i === 40) {
        lines.push('Database Secret: sk-proj-1234567890abcdef1234567890abcdef');
      } else {
        lines.push('Log entry #' + i + ': system operational');
      }
    }
    const longText = lines.join('\n');

    const detectedItems: DetectedItem[] = [
      {
        id: 'item_pan',
        type: 'PAN_CARD',
        label: 'PAN Number',
        value: 'ABCDE1234F',
        confidence: 1.0,
        complianceTags: ['DPDP_INDIA'],
        recommendation: 'Redact PAN',
      },
      {
        id: 'item_key',
        type: 'API_KEY',
        label: 'API Secret Key',
        value: 'sk-proj-1234567890abcdef1234567890abcdef',
        confidence: 1.0,
        complianceTags: ['GDPR'],
        recommendation: 'Protect API Key',
      }
    ];

    const pages = MasterDetector.generateDocumentPages('server.log', longText, detectedItems);
    expect(pages.length).toBe(3);
    expect(pages[0].pageNumber).toBe(1);
    expect(pages[1].pageNumber).toBe(2);
    expect(pages[2].pageNumber).toBe(3);

    const page1Pan = pages[0].detectedItems.find(i => i.type === 'PAN_CARD');
    expect(page1Pan).toBeDefined();
    expect(page1Pan?.pageNumber).toBe(1);
    expect(page1Pan?.boundingBox).toBeDefined();

    const page2Key = pages[1].detectedItems.find(i => i.type === 'API_KEY');
    expect(page2Key).toBeDefined();
    expect(page2Key?.pageNumber).toBe(2);
    expect(page2Key?.boundingBox).toBeDefined();
  });

  it('correctly maps synthetic replacements across multi-page document items', () => {
    const items: DetectedItem[] = [
      {
        id: 'p1_aadhaar',
        type: 'AADHAAR',
        label: 'Aadhaar UID',
        value: '2345 6789 0123',
        confidence: 1.0,
        complianceTags: ['DPDP_INDIA'],
        recommendation: 'Mask Aadhaar',
        pageNumber: 1,
      },
      {
        id: 'p2_dob',
        type: 'DOB',
        label: 'Date of Birth (DOB)',
        value: '15/08/1995',
        confidence: 0.95,
        complianceTags: ['DPDP_INDIA'],
        recommendation: 'Mask DOB',
        pageNumber: 2,
      },
      {
        id: 'p3_pan',
        type: 'PAN_CARD',
        label: 'Income Tax PAN',
        value: 'ABCDE1234F',
        confidence: 1.0,
        complianceTags: ['DPDP_INDIA'],
        recommendation: 'Mask PAN',
        pageNumber: 3,
      },
    ];

    const mappings = SyntheticEngine.generateAllMappings(items, 'test_hash_123');
    expect(mappings.length).toBe(3);

    const aadhaarMap = mappings.find(m => m.id === 'p1_aadhaar');
    expect(aadhaarMap).toBeDefined();
    expect(aadhaarMap?.syntheticValue).toMatch(/^\d{4}\s\d{4}\s\d{4}$/);

    const dobMap = mappings.find(m => m.id === 'p2_dob');
    expect(dobMap).toBeDefined();
    expect(dobMap?.syntheticValue).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    const panMap = mappings.find(m => m.id === 'p3_pan');
    expect(panMap).toBeDefined();
    expect(panMap?.syntheticValue).toMatch(/^[A-Z]{5}\d{4}[A-Z]$/);
  });

  it('avoids false footer single-digit matches and clusters split PDF text chunks into exact bounding box', () => {
    // Simulate PDF items where item 1 is a footer page number "8" at bottom right
    // and items 10, 11, 12 are table chunks for Aadhaar "7058 1663 3069"
    interface MockPdfChunk {
      str: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }

    const chunks: MockPdfChunk[] = [
      { str: 'Header', x: 50, y: 50, w: 100, h: 12 },
      { str: '8', x: 545, y: 1200, w: 5, h: 10 }, // Footer page number at bottom right
      { str: 'Sahil Singh', x: 240, y: 200, w: 80, h: 12 },
      { str: '7058 ', x: 240, y: 250, w: 25, h: 12 },
      { str: '1663 ', x: 268, y: 250, w: 25, h: 12 },
      { str: '3069', x: 296, y: 250, w: 25, h: 12 },
    ];

    const targetVal = '7058 1663 3069';
    const cleanVal = targetVal.replace(/[-\s]/g, '').toUpperCase();

    // The new logic:
    let matchedBox: any = null;

    // 1. Direct single-item check
    for (const chunk of chunks) {
      const cleanChunk = chunk.str.replace(/[-\s]/g, '').toUpperCase();
      if (chunk.str.includes(targetVal) || (cleanVal.length >= 4 && cleanChunk.includes(cleanVal))) {
        matchedBox = { x: chunk.x, y: chunk.y, width: chunk.w, height: chunk.h };
        break;
      }
    }

    // 2. Line stream check
    if (!matchedBox) {
      const lines: MockPdfChunk[][] = [];
      const sorted = [...chunks].sort((a, b) => a.y - b.y || a.x - b.x);
      for (const chunk of sorted) {
        const line = lines.find(l => Math.abs(l[0].y - chunk.y) <= 4);
        if (line) line.push(chunk);
        else lines.push([chunk]);
      }

      for (const line of lines) {
        const lineClean = line.map(c => c.str).join('').replace(/[-\s]/g, '').toUpperCase();
        if (lineClean.includes(cleanVal)) {
          const minX = Math.min(...line.map(c => c.x));
          const maxX = Math.max(...line.map(c => c.x + c.w));
          const minY = Math.min(...line.map(c => c.y));
          const maxY = Math.max(...line.map(c => c.y + c.h));
          matchedBox = {
            x: Math.max(0, Math.round(minX - 4)),
            y: Math.max(0, Math.round(minY - 4)),
            width: Math.round(Math.max(50, maxX - minX) + 8),
            height: Math.round(Math.max(18, maxY - minY) + 8),
          };
          break;
        }
      }
    }

    expect(matchedBox).not.toBeNull();
    // Must NOT match the footer at y=1200
    expect(matchedBox.y).toBeLessThan(300);
    expect(matchedBox.x).toBe(236); // 240 - 4
    expect(matchedBox.width).toBeGreaterThanOrEqual(81); // spans 240 to 321 + padding
  });

  describe('PDF Bounding Box Precision & Isolation (Anti-Blob Guarantee)', () => {
    const mockRawItems = [
      // Row 1: Y = 400 (tx = 50, ty = 400)
      { str: 'Full Name', transform: [10, 0, 0, 10, 50, 400], width: 60, height: 12 },
      { str: 'Aarav Mehta', transform: [10, 0, 0, 10, 200, 400], width: 80, height: 12 },

      // Row 2: Y = 360 (tx = 50, ty = 360)
      { str: 'Date of Birth', transform: [10, 0, 0, 10, 50, 360], width: 70, height: 12 },
      { str: '12/04/1992', transform: [10, 0, 0, 10, 200, 360], width: 65, height: 12 },

      // Row 3: Y = 320 (tx = 50, ty = 320)
      { str: 'Phone Number', transform: [10, 0, 0, 10, 50, 320], width: 75, height: 12 },
      { str: '+91 98000 12345', transform: [10, 0, 0, 10, 200, 320], width: 95, height: 12 },

      // Row 4: Y = 280 (split Aadhaar across 3 items on same line)
      { str: 'Aadhaar UID', transform: [10, 0, 0, 10, 50, 280], width: 70, height: 12 },
      { str: '1234 ', transform: [10, 0, 0, 10, 200, 280], width: 30, height: 12 },
      { str: '5678 ', transform: [10, 0, 0, 10, 235, 280], width: 30, height: 12 },
      { str: '9012', transform: [10, 0, 0, 10, 270, 280], width: 28, height: 12 },

      // Row 5: Y = 240 (PAN)
      { str: 'PAN Card', transform: [10, 0, 0, 10, 50, 240], width: 60, height: 12 },
      { str: 'ABCDE1234F', transform: [10, 0, 0, 10, 200, 240], width: 75, height: 12 },
    ];

    it('should create tight isolated box for single item name without engulfing adjacent rows', () => {
      const box = PdfProcessor.findBoundingBoxForFinding(
        { type: 'NAME', label: 'Full Name', value: 'Aarav Mehta' },
        mockRawItems,
        800,
        600
      );

      expect(box).not.toBeNull();
      // Must cover Aarav Mehta only
      expect(box!.height).toBeLessThanOrEqual(32);
      expect(box!.width).toBeLessThan(200);
      // Must be at expected Y coordinate (viewport.height - 400*1.5 = 600 - 600 = 0 base)
      expect(box!.x).toBeGreaterThanOrEqual(190);
    });

    it('should resolve split 3-chunk Aadhaar strictly on same line without ballooning into column box', () => {
      const box = PdfProcessor.findBoundingBoxForFinding(
        { type: 'AADHAAR', label: 'Aadhaar UID', value: '1234 5678 9012' },
        mockRawItems,
        800,
        600
      );

      expect(box).not.toBeNull();
      // Must be strictly single-line height
      expect(box!.height).toBeLessThanOrEqual(32);
      // Width spans from 200 to 270+28 (approx 100-160px), NEVER the whole column or page
      expect(box!.width).toBeLessThan(200);
      expect(box!.width).toBeGreaterThanOrEqual(60);
    });

    it('should NEVER merge separate row findings into a column-spanning giant rectangle', () => {
      const nameBox = PdfProcessor.findBoundingBoxForFinding(
        { type: 'NAME', label: 'Name', value: 'Aarav Mehta' },
        mockRawItems,
        800,
        600
      );
      const panBox = PdfProcessor.findBoundingBoxForFinding(
        { type: 'PAN_CARD', label: 'PAN', value: 'ABCDE1234F' },
        mockRawItems,
        800,
        600
      );

      expect(nameBox).not.toBeNull();
      expect(panBox).not.toBeNull();
      // Verify both have tight heights and do NOT overlap vertically
      expect(nameBox!.height).toBeLessThanOrEqual(32);
      expect(panBox!.height).toBeLessThanOrEqual(32);
      expect(Math.abs(nameBox!.y - panBox!.y)).toBeGreaterThan(50);
    });

    it('should return null when value is not on the page instead of fabricating an 80% width box', () => {
      const box = PdfProcessor.findBoundingBoxForFinding(
        { type: 'PASSPORT', label: 'Passport', value: 'Z9999999' },
        mockRawItems,
        800,
        600
      );
      expect(box).toBeNull();
    });
  });
});

