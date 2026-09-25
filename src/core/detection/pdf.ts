import * as pdfjsLib from 'pdfjs-dist';
import jsPDF from 'jspdf';
import { DetectedItem, BoundingBox, PdfPageResult } from '../../types';
import { RegexDetector } from './regex';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.js',
      import.meta.url
    ).toString();
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
  }
}

export interface PdfRenderResult {
  pageImageDataUrl: string;
  canvas: HTMLCanvasElement;
  extractedText: string;
  detectedItems: DetectedItem[];
  pageDimensions: { width: number; height: number };
}

export interface PdfMultiPageResult {
  pages: PdfPageResult[];
  totalPages: number;
  extractedText: string;
  detectedItems: DetectedItem[];
  pageDimensions: { width: number; height: number };
  previewDataUrl: string;
  primaryCanvas: HTMLCanvasElement;
}

export class PdfProcessor {
  /**
   * Render all pages of PDF to Canvas and extract text blocks with exact coordinates
   */
  static async processPdf(file: File): Promise<PdfMultiPageResult> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const totalPages = Math.max(1, pdf.numPages);

    const pages: PdfPageResult[] = [];
    const allDetectedItems: DetectedItem[] = [];
    const textParts: string[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });

      // Render to offscreen canvas with crisp white background (safe for browser & test environments)
      let canvas: any;
      if (typeof document !== 'undefined') {
        canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({
            canvasContext: ctx,
            viewport,
          }).promise;
        }
      } else {
        canvas = {
          width: Math.round(viewport.width),
          height: Math.round(viewport.height),
          toDataURL: () => '',
        };
      }

      // Extract text content preserving line breaks
      const textContent = await page.getTextContent();
      const rawItems = (textContent.items as any[])
        .filter((i: any) => i && typeof i.str === 'string' && i.str.length > 0);

      let pageText = '';
      let lastY: number | null = null;
      for (const item of rawItems) {
        const curY = item.transform ? item.transform[5] : null;
        if (lastY !== null && curY !== null && Math.abs(curY - lastY) > 5) {
          pageText += '\n' + item.str;
        } else {
          pageText += (pageText.length > 0 && !pageText.endsWith('\n') ? ' ' : '') + item.str;
        }
        if (curY !== null) lastY = curY;
      }

      if (pageText) {
        textParts.push(`--- Page ${pageNum} ---\n` + pageText);
      }

      const pageItems: DetectedItem[] = [];

      // Run Regex analysis over this page's text
      const regexFindings = RegexDetector.scanText(pageText);

      // Map regex findings back to exact PDF viewport coordinates with provenance-first verification
      regexFindings.forEach((finding, fIdx) => {
        let matchedBox = PdfProcessor.findBoundingBoxForFinding(finding, rawItems, canvas.width, canvas.height);

        // If rawValue differs and value wasn't found, try rawValue
        if (!matchedBox && finding.rawValue && finding.rawValue !== finding.value) {
          matchedBox = PdfProcessor.findBoundingBoxForFinding(
            { ...finding, value: finding.rawValue },
            rawItems,
            canvas.width,
            canvas.height
          );
        }

        const matchedBoxes: BoundingBox[] = matchedBox ? [matchedBox] : [];
        const localizationState = matchedBox
          ? (finding.localizationState || 'EXACT')
          : 'MISSING';

        pageItems.push({
          ...finding,
          id: `p${pageNum}_${finding.id || 'item'}_${fIdx}`,
          pageNumber: pageNum,
          localizationState,
          detectionConfidence: finding.detectionConfidence || 'HIGH',
          boundingBoxes: matchedBoxes,
          boundingBox: matchedBox || undefined,
        });
      });

      const pageDataUrl = canvas.toDataURL('image/png');
      pages.push({
        pageNumber: pageNum,
        pageImageDataUrl: pageDataUrl,
        detectedItems: pageItems,
        pageDimensions: { width: canvas.width, height: canvas.height },
        extractedText: pageText,
      });

      allDetectedItems.push(...pageItems);
    }

    const firstPage = pages[0] || {
      pageNumber: 1,
      pageImageDataUrl: '',
      detectedItems: [],
      pageDimensions: { width: 800, height: 1000 },
      extractedText: '',
    };

    const firstCanvas = typeof document !== 'undefined'
      ? document.createElement('canvas')
      : ({ width: firstPage.pageDimensions.width, height: firstPage.pageDimensions.height } as any);
    if (typeof document !== 'undefined') {
      firstCanvas.width = firstPage.pageDimensions.width;
      firstCanvas.height = firstPage.pageDimensions.height;
    }

    return {
      pages,
      totalPages,
      extractedText: textParts.join('\n\n'),
      detectedItems: allDetectedItems,
      pageDimensions: firstPage.pageDimensions,
      previewDataUrl: firstPage.pageImageDataUrl,
      primaryCanvas: firstCanvas,
    };
  }

  /**
   * Convert an image canvas or dataUrl to a single-page downloadable PDF Blob
   */
  static canvasToPdfBlob(canvas: HTMLCanvasElement | string, widthPx: number, heightPx: number): Blob {
    const orientation = widthPx > heightPx ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'px',
      format: [widthPx, heightPx],
      hotfixes: ['px_scaling'],
    });

    const isPng = typeof canvas === 'string' ? canvas.startsWith('data:image/png') : true;
    const format = isPng ? 'PNG' : 'JPEG';
    const imgData = typeof canvas === 'string' ? canvas : canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.95);
    pdf.addImage(imgData, format, 0, 0, widthPx, heightPx);
    return pdf.output('blob');
  }

  /**
   * Convert an array of rendered/masked page canvases into a multi-page PDF Blob
   */
  static exportMultiPagePdf(pages: { canvas: HTMLCanvasElement | string; width: number; height: number }[]): Blob {
    if (!pages || pages.length === 0) {
      throw new Error('No pages provided for PDF export');
    }

    const first = pages[0];
    const orientation = first.width > first.height ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'px',
      format: [first.width, first.height],
      hotfixes: ['px_scaling'],
    });

    pages.forEach((p, idx) => {
      if (idx > 0) {
        const pageOrientation = p.width > p.height ? 'landscape' : 'portrait';
        pdf.addPage([p.width, p.height], pageOrientation);
      }
      const isPng = typeof p.canvas === 'string' ? p.canvas.startsWith('data:image/png') : true;
      const format = isPng ? 'PNG' : 'JPEG';
      const imgData = typeof p.canvas === 'string' ? p.canvas : p.canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.95);
      pdf.addImage(imgData, format, 0, 0, p.width, p.height);
    });

    return pdf.output('blob');
  }

  /**
   * Spatially resolves the tightest bounding box for a detected PII finding on a PDF page.
   * Guarantees that single-line text items NEVER expand across multiple rows or columns.
   */
  public static findBoundingBoxForFinding(
    finding: { type?: string; label?: string; value?: string; rawValue?: string },
    rawItems: any[],
    canvasWidth: number,
    canvasHeight: number
  ): BoundingBox | null {
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
          label: finding.label,
          isNormalized: false,
        };
      }
    }

    // PASS 2: Contiguous consecutive items on the EXACT SAME LINE (e.g. split Aadhaar "1234 " + "5678 " + "9012" or "+91 " + "90000 12345")
    for (let i = 0; i < rawItems.length; i++) {
      const baseItem = rawItems[i];
      const baseTy = baseItem.transform ? baseItem.transform[5] : 0;
      let accumulatedClean = '';
      let accumulatedNorm = '';
      const slice: any[] = [];

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
          const contributingItems: any[] = [];
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
            label: finding.label,
            isNormalized: false,
          };
        }
      }
    }

    return null;
  }
}
