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

      // Map regex findings back to exact PDF viewport coordinates
      regexFindings.forEach((finding, fIdx) => {
        let matchedBox: BoundingBox | null = null;

        if (finding.value) {
          const cleanVal = finding.value.replace(/[-\s]/g, '');
          for (const item of textContent.items as any[]) {
            if (!('str' in item) || !item.str) continue;
            const cleanItem = item.str.replace(/[-\s]/g, '');
            if (
              item.str.includes(finding.value) ||
              finding.value.includes(item.str) ||
              (cleanItem.length >= 4 && cleanVal.includes(cleanItem))
            ) {
              // PDF coordinates have origin at bottom-left; convert to canvas top-left
              const tx = item.transform[4] * 1.5;
              const ty = viewport.height - (item.transform[5] * 1.5);
              const tw = Math.max(50, (item.width || 60) * 1.5);
              const th = Math.max(18, (item.height || 14) * 1.5);

              matchedBox = {
                x: Math.max(0, Math.round(tx - 4)),
                y: Math.max(0, Math.round(ty - th - 4)),
                width: Math.round(tw + 8),
                height: Math.round(th + 8),
                label: finding.label,
                isNormalized: false,
              };
              break;
            }
          }
        }

        // If no direct coordinate match, calculate position on canvas
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
