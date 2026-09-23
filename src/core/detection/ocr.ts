import { createWorker, Worker as TesseractWorker } from 'tesseract.js';
import { BoundingBox, DetectedItem } from '../../types';
import { RegexDetector } from './regex';

export interface OcrWordBox {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export class OcrEngine {
  private static workerInstance: TesseractWorker | null = null;
  private static isInitializing = false;

  // Initialize OCR worker once and reuse with auto-recovery
  private static async getWorker(): Promise<TesseractWorker | null> {
    if (typeof window === 'undefined') return null;
    if (this.workerInstance) return this.workerInstance;

    if (this.isInitializing) {
      await new Promise(r => setTimeout(r, 200));
      return this.workerInstance;
    }

    this.isInitializing = true;
    try {
      const worker = await createWorker('eng', 1, {
        errorHandler: (err) => {
          console.warn('Tesseract worker error (attempting recovery):', err);
          this.workerInstance = null;
        }
      });
      this.workerInstance = worker;
      this.isInitializing = false;
      return worker;
    } catch (e) {
      console.warn('Tesseract worker initialization failed:', e);
      this.isInitializing = false;
      this.workerInstance = null;
      return null;
    }
  }

  // Extract text with image downscaling and hardened contiguous token bounding-box mapping
  static async processImage(
    imageOrCanvas: HTMLImageElement | HTMLCanvasElement
  ): Promise<{
    fullText: string;
    detectedPii: DetectedItem[];
    scanDurationMs: number;
  }> {
    const startTime = performance.now();
    const origWidth = 'naturalWidth' in imageOrCanvas ? imageOrCanvas.naturalWidth : imageOrCanvas.width;
    const origHeight = 'naturalHeight' in imageOrCanvas ? imageOrCanvas.naturalHeight : imageOrCanvas.height;

    if (origWidth === 0 || origHeight === 0) {
      return { fullText: '', detectedPii: [], scanDurationMs: 0 };
    }

    // Downscale large images (max 1600px) for high memory efficiency and reduced OCR latency
    const maxDim = 1600;
    const scale = Math.min(1.0, maxDim / Math.max(origWidth, origHeight));
    const targetW = Math.max(32, Math.round(origWidth * scale));
    const targetH = Math.max(32, Math.round(origHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { fullText: '', detectedPii: [], scanDurationMs: 0 };

    ctx.drawImage(imageOrCanvas, 0, 0, targetW, targetH);

    let extractedText = '';
    const wordBoxes: OcrWordBox[] = [];

    try {
      const worker = await this.getWorker();
      if (worker) {
        // Enforce 8000ms timeout on recognition to prevent hung tabs
        const recognizePromise = worker.recognize(canvas);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OCR recognition timed out')), 8000)
        );

        const ret = await Promise.race([recognizePromise, timeoutPromise]);
        extractedText = ret.data.text || '';

        // Extract word-level bounding boxes and scale back to original dimensions
        if (ret.data.words) {
          const scaleBack = 1 / scale;
          for (const word of ret.data.words) {
            if (word.text && word.bbox) {
              const cleanWordText = word.text.trim();
              if (cleanWordText.length > 0) {
                const rawX = Math.round(word.bbox.x0 * scaleBack);
                const rawY = Math.round(word.bbox.y0 * scaleBack);
                const rawW = Math.round((word.bbox.x1 - word.bbox.x0) * scaleBack);
                const rawH = Math.round((word.bbox.y1 - word.bbox.y0) * scaleBack);

                const clampedX = Math.max(0, Math.min(origWidth - 1, rawX));
                const clampedY = Math.max(0, Math.min(origHeight - 1, rawY));
                const clampedW = Math.max(1, Math.min(origWidth - clampedX, rawW));
                const clampedH = Math.max(1, Math.min(origHeight - clampedY, rawH));

                wordBoxes.push({
                  text: cleanWordText,
                  confidence: (word.confidence || 75) / 100,
                  bbox: {
                    x: clampedX,
                    y: clampedY,
                    width: clampedW,
                    height: clampedH,
                    label: cleanWordText,
                    isNormalized: false,
                  },
                });
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('OCR execution skipped or timed out:', e);
    }

    // Run hardened RegexDetector on extracted text
    const detectedPii = RegexDetector.scanText(extractedText);

    // Normalizer helper for token comparison
    const normalize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // Map each detected PII item to its corresponding contiguous OCR word box
    const usedWordIndices = new Set<number>();

    for (const item of detectedPii) {
      const piiVal = item.value.trim();
      const piiTokens = piiVal.split(/[\s\-:_.]+/).filter(t => t.length > 0);
      const normTokens = piiTokens.map(normalize).filter(t => t.length > 0);

      if (normTokens.length === 0) continue;

      let bestMatchBoxes: OcrWordBox[] | null = null;
      let matchedIndices: number[] = [];

      // Search for contiguous word-box match in wordBoxes array
      for (let i = 0; i <= wordBoxes.length - normTokens.length; i++) {
        let isContiguousMatch = true;
        const currentMatchIndices: number[] = [];

        for (let j = 0; j < normTokens.length; j++) {
          const expected = normTokens[j];
          const actual = normalize(wordBoxes[i + j].text);

          if (!actual.includes(expected) && !expected.includes(actual)) {
            isContiguousMatch = false;
            break;
          }
          currentMatchIndices.push(i + j);
        }

        if (isContiguousMatch) {
          const candidateBoxes = wordBoxes.slice(i, i + normTokens.length);

          // Spatial proximity check: Tokens in the same number sequence MUST be on roughly the same line
          const firstBox = candidateBoxes[0].bbox;
          const maxAllowedYDiff = Math.max(25, firstBox.height * 1.5);
          let spatiallyValid = true;

          for (let k = 1; k < candidateBoxes.length; k++) {
            const curBox = candidateBoxes[k].bbox;
            if (Math.abs(curBox.y - firstBox.y) > maxAllowedYDiff) {
              spatiallyValid = false;
              break;
            }
          }

          if (spatiallyValid) {
            bestMatchBoxes = candidateBoxes;
            matchedIndices = currentMatchIndices;
            break;
          }
        }
      }

      // If single-token match
      if (!bestMatchBoxes && normTokens.length === 1) {
        const firstToken = normTokens[0];
        for (let i = 0; i < wordBoxes.length; i++) {
          if (usedWordIndices.has(i)) continue;
          const actual = normalize(wordBoxes[i].text);
          if (actual.includes(firstToken) || firstToken.includes(actual)) {
            bestMatchBoxes = [wordBoxes[i]];
            matchedIndices = [i];
            break;
          }
        }
      }

      if (bestMatchBoxes && bestMatchBoxes.length > 0) {
        matchedIndices.forEach(idx => usedWordIndices.add(idx));

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const mb of bestMatchBoxes) {
          minX = Math.min(minX, mb.bbox.x);
          minY = Math.min(minY, mb.bbox.y);
          maxX = Math.max(maxX, mb.bbox.x + mb.bbox.width);
          maxY = Math.max(maxY, mb.bbox.y + mb.bbox.height);
        }

        // Add padding and clamp (limit maximum box width to 75% of card to avoid full-width spans)
        const padX = 8;
        const padY = 8;
        const rawW = (maxX - minX) + padX * 2;
        const maxW = Math.round(origWidth * 0.75);
        const boxW = Math.min(maxW, Math.max(1, Math.min(origWidth - minX, rawW)));

        const boxX = Math.max(0, Math.min(origWidth - 1, minX - padX));
        const boxY = Math.max(0, Math.min(origHeight - 1, minY - padY));
        const boxH = Math.max(1, Math.min(origHeight - boxY, (maxY - minY) + padY * 2));

        item.boundingBox = {
          x: boxX,
          y: boxY,
          width: boxW,
          height: boxH,
          label: `${item.label}: ${item.value}`,
          isNormalized: false,
        };
      }
    }

    const scanDurationMs = Math.round(performance.now() - startTime);
    return { fullText: extractedText, detectedPii, scanDurationMs };
  }
}
