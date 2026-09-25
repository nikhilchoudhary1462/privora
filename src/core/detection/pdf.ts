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

      // Render to offscreen canvas
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;

      // Extract text content with coordinates
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .filter((i: any) => 'str' in i)
        .map((i: any) => i.str)
        .join(' ');

      if (pageText) {
        textParts.push(`--- Page ${pageNum} ---\n` + pageText);
      }

      const pageItems: DetectedItem[] = [];

      // Run Regex analysis over this page's text
      const regexFindings = RegexDetector.scanText(pageText);

      const rawItems = (textContent.items as any[])
        .filter((i: any) => i && typeof i.str === 'string' && i.str.length > 0);

      // Map regex findings back to exact PDF viewport coordinates using union bounding boxes
      regexFindings.forEach((finding, fIdx) => {
        let matchedBox: BoundingBox | null = null;

        if (finding.value) {
          const findingVal = finding.value.trim();
          const cleanFinding = findingVal.replace(/[-\s]/g, '').toLowerCase();

          // Find ALL matching items that contain or contribute to this finding
          const matchedChunks: any[] = [];

          for (const item of rawItems) {
            const itemStr = item.str;
            const cleanItem = itemStr.replace(/[-\s]/g, '').toLowerCase();
            if (!cleanItem) continue;

            const isExactSubstring = itemStr.includes(findingVal) || findingVal.includes(itemStr);
            const isCleanSubstring = (cleanItem.length >= 3 && cleanFinding.includes(cleanItem)) ||
                                     (cleanFinding.length >= 3 && cleanItem.includes(cleanFinding));

            if (isExactSubstring || isCleanSubstring) {
              matchedChunks.push(item);
            }
          }

          if (matchedChunks.length > 0) {
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;

            matchedChunks.forEach((item) => {
              const tx = item.transform[4] * 1.5;
              const ty = viewport.height - (item.transform[5] * 1.5);
              const tw = Math.max(16, (item.width || 40) * 1.5);
              const th = Math.max(14, (item.height || Math.abs(item.transform[0]) || 14) * 1.5);

              const bx = Math.max(0, Math.round(tx - 4));
              const by = Math.max(0, Math.round(ty - th - 3));
              const bw = Math.round(tw + 8);
              const bh = Math.round(th + 6);

              minX = Math.min(minX, bx);
              minY = Math.min(minY, by);
              maxX = Math.max(maxX, bx + bw);
              maxY = Math.max(maxY, by + bh);
            });

            if (minX < Infinity && maxX > minX && maxY > minY) {
              matchedBox = {
                x: minX,
                y: minY,
                width: Math.min(canvas.width - minX, maxX - minX),
                height: Math.min(canvas.height - minY, maxY - minY),
                label: finding.label,
                isNormalized: false,
              };
            }
          }
        }

        // If no direct coordinate match, calculate reasonable position on canvas
        if (!matchedBox) {
          matchedBox = {
            x: Math.round(canvas.width * 0.1),
            y: Math.round(canvas.height * 0.25 + (pageItems.length * 40)),
            width: Math.round(canvas.width * 0.8),
            height: 32,
            label: finding.label,
            isNormalized: false,
          };
        }

        pageItems.push({
          ...finding,
          id: `p${pageNum}_${finding.id || 'item'}_${fIdx}`,
          pageNumber: pageNum,
          boundingBox: matchedBox,
        });
      });

      // Detect face photo regions visually on this page canvas
      try {
        const thumbScale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
        const tw = Math.round(canvas.width * thumbScale);
        const th = Math.round(canvas.height * thumbScale);
        const tCan = document.createElement('canvas');
        tCan.width = tw;
        tCan.height = th;
        const tCtx = tCan.getContext('2d');
        if (tCtx) {
          tCtx.drawImage(canvas, 0, 0, tw, th);
          const imgData = tCtx.getImageData(0, 0, tw, th);
          let skinPixels = 0;
          let minSx = tw, maxSx = 0, minSy = th, maxSy = 0;
          const data = imgData.data;
          for (let y = 0; y < th; y++) {
            for (let x = 0; x < tw; x++) {
              const idx = (y * tw + x) * 4;
              const r = data[idx], g = data[idx + 1], b = data[idx + 2];
              if (r > 65 && g > 45 && b > 25 && r > g && r > b && (r - g) >= 10 && (r - b) >= 15) {
                skinPixels++;
                if (x < minSx) minSx = x;
                if (x > maxSx) maxSx = x;
                if (y < minSy) minSy = y;
                if (y > maxSy) maxSy = y;
              }
            }
          }
          if (skinPixels > 140 && (maxSx - minSx) >= 18 && (maxSy - minSy) >= 22) {
            const fx = Math.round(minSx / thumbScale);
            const fy = Math.round(minSy / thumbScale);
            const fw = Math.round((maxSx - minSx) / thumbScale);
            const fh = Math.round((maxSy - minSy) / thumbScale);
            pageItems.push({
              id: `p${pageNum}_face_${pageItems.length}`,
              type: 'FACE',
              label: 'Biometric Face Photo',
              value: 'FACE_BIOMETRIC',
              confidence: 0.94,
              complianceTags: ['DPDP_INDIA', 'GDPR'],
              recommendation: 'Biometric facial photograph requiring privacy shielding.',
              pageNumber: pageNum,
              boundingBox: {
                x: fx,
                y: fy,
                width: fw,
                height: fh,
                label: 'Face Photo',
                isNormalized: false,
              }
            });
          }
        }
      } catch (e) {}

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

    const firstCanvas = document.createElement('canvas');
    firstCanvas.width = firstPage.pageDimensions.width;
    firstCanvas.height = firstPage.pageDimensions.height;

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

    const imgData = typeof canvas === 'string' ? canvas : canvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', 0, 0, widthPx, heightPx);
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
      const imgData = typeof p.canvas === 'string' ? p.canvas : p.canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 0, 0, p.width, p.height);
    });

    return pdf.output('blob');
  }
}
