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

    // Levenshtein distance helper for bounded fuzzy matching
    const levenshtein = (s1: string, s2: string): number => {
      if (s1 === s2) return 0;
      if (!s1.length) return s2.length;
      if (!s2.length) return s1.length;
      const d: number[][] = [];
      for (let i = 0; i <= s1.length; i++) d[i] = [i];
      for (let j = 0; j <= s2.length; j++) d[0][j] = j;
      for (let i = 1; i <= s1.length; i++) {
        for (let j = 1; j <= s2.length; j++) {
          const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
          d[i][j] = Math.min(
            d[i - 1][j] + 1,
            d[i][j - 1] + 1,
            d[i - 1][j - 1] + cost
          );
        }
      }
      return d[s1.length][s2.length];
    };

    const normalize = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    // 1. Spatially Coherent Line Grouping (Anti-Pollution Guard)
    // Sort boxes primarily by vertical position (Y)
    const sortedBoxes = [...wordBoxes].sort((a, b) => a.bbox.y - b.bbox.y);
    const lines: { avgY: number; avgH: number; boxes: OcrWordBox[] }[] = [];

    for (const wb of sortedBoxes) {
      let placed = false;
      for (const line of lines) {
        const yDiff = Math.abs(wb.bbox.y - line.avgY);
        const maxAllowedYDiff = Math.max(14, line.avgH * 0.6);
        if (yDiff <= maxAllowedYDiff) {
          line.boxes.push(wb);
          line.avgY = (line.avgY * (line.boxes.length - 1) + wb.bbox.y) / line.boxes.length;
          line.avgH = (line.avgH * (line.boxes.length - 1) + wb.bbox.height) / line.boxes.length;
          placed = true;
          break;
        }
      }
      if (!placed) {
        lines.push({
          avgY: wb.bbox.y,
          avgH: wb.bbox.height,
          boxes: [wb],
        });
      }
    }

    // Sort words within each line from left to right (X coordinate)
    for (const line of lines) {
      line.boxes.sort((a, b) => a.bbox.x - b.bbox.x);
    }

    // Track matched word boxes to avoid cross-claim collisions
    const usedWordBoxes = new Set<OcrWordBox>();

    // 2. Strict Matching Hierarchy per Detected Entity
    for (const item of detectedPii) {
      let bestMatchBoxes: OcrWordBox[] | null = null;

      // Special Matcher A: Indian PAN Card
      if (item.type === 'PAN_CARD') {
        const targetPan = item.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        // Pass 1: Single word box exact / positional / edit-distance <= 1
        for (const line of lines) {
          for (const wb of line.boxes) {
            if (usedWordBoxes.has(wb)) continue;
            const cleanWord = wb.text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            
            // 1. Exact normalized match
            if (cleanWord === targetPan) {
              bestMatchBoxes = [wb];
              break;
            }
            // 2. Positional OCR corrected match
            const posRepaired = RegexDetector.normalizePanCandidate(cleanWord);
            if (posRepaired && posRepaired.normalized === targetPan) {
              bestMatchBoxes = [wb];
              break;
            }
            // 3. Bounded edit distance (Levenshtein <= 1 strictly for 9-11 char tokens)
            if (cleanWord.length >= 9 && cleanWord.length <= 11 && levenshtein(cleanWord, targetPan) <= 1) {
              bestMatchBoxes = [wb];
              break;
            }
          }
          if (bestMatchBoxes) break;
        }

        // Pass 2: Fragmented PAN across adjacent words on the same line (e.g. ["ABCDE", "1234F"])
        if (!bestMatchBoxes) {
          for (const line of lines) {
            for (let i = 0; i < line.boxes.length - 1; i++) {
              const b1 = line.boxes[i];
              const b2 = line.boxes[i + 1];
              if (usedWordBoxes.has(b1) || usedWordBoxes.has(b2)) continue;
              const combined = (b1.text + b2.text).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
              if (combined === targetPan || (combined.length === 10 && levenshtein(combined, targetPan) <= 1)) {
                bestMatchBoxes = [b1, b2];
                break;
              }
            }
            if (bestMatchBoxes) break;
          }
        }
      }

      // Special Matcher B: Indian Aadhaar Number (Exact Digit-Stream within Spatially Coherent Lines)
      else if (item.type === 'AADHAAR') {
        const targetDigits = item.value.replace(/\D/g, '');

        if (targetDigits.length === 12) {
          for (const line of lines) {
            // Build digit stream for this specific line with OCR character normalization
            let lineDigits = '';
            const digitToBoxMap: OcrWordBox[] = [];

            for (const wb of line.boxes) {
              const normalizedWb = wb.text
                .replace(/[Oo]/g, '0')
                .replace(/[Il|]/g, '1')
                .replace(/[Bb]/g, '8')
                .replace(/[Ss]/g, '5')
                .replace(/[Zz]/g, '2');
              const wbDigits = normalizedWb.replace(/\D/g, '');
              for (let d = 0; d < wbDigits.length; d++) {
                lineDigits += wbDigits[d];
                digitToBoxMap.push(wb);
              }
            }

            const matchIndex = lineDigits.indexOf(targetDigits);
            if (matchIndex !== -1) {
              const matchedSet = new Set<OcrWordBox>();
              for (let k = matchIndex; k < Math.min(digitToBoxMap.length, matchIndex + 12); k++) {
                matchedSet.add(digitToBoxMap[k]);
              }
              bestMatchBoxes = Array.from(matchedSet);
              break;
            }
          }
        }
      }

      // General Matcher C: Multi-Token PII (DOB, Cards, Phones, Passports, SSN, Emails)
      if (!bestMatchBoxes) {
        const piiVal = item.value.trim();
        const piiTokens = piiVal.split(/[\s\-:_.]+/).filter(t => t.length > 0);
        const normTokens = piiTokens.map(normalize).filter(t => t.length > 0);

        if (normTokens.length > 1) {
          // Contiguous sequence search within the same line
          for (const line of lines) {
            if (line.boxes.length < normTokens.length) continue;

            for (let i = 0; i <= line.boxes.length - normTokens.length; i++) {
              let isSequenceMatch = true;
              for (let j = 0; j < normTokens.length; j++) {
                const expected = normTokens[j];
                const actual = normalize(line.boxes[i + j].text);
                if (actual !== expected && !actual.includes(expected)) {
                  isSequenceMatch = false;
                  break;
                }
              }
              if (isSequenceMatch) {
                bestMatchBoxes = line.boxes.slice(i, i + normTokens.length);
                break;
              }
            }
            if (bestMatchBoxes) break;
          }
        } else if (normTokens.length === 1) {
          const target = normTokens[0];
          for (const line of lines) {
            for (const wb of line.boxes) {
              if (usedWordBoxes.has(wb)) continue;
              const actual = normalize(wb.text);
              // Strict check: Exact match or tight container (prevent tiny substring match like "A" matching "ABCDE1234F")
              if (actual === target || (actual.includes(target) && actual.length <= target.length + 4)) {
                bestMatchBoxes = [wb];
                break;
              }
            }
            if (bestMatchBoxes) break;
          }
        }
      }

      // 3. Bounding Box Assignment & Provenance-Based Localization
      if (bestMatchBoxes && bestMatchBoxes.length > 0) {
        bestMatchBoxes.forEach(b => usedWordBoxes.add(b));

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const mb of bestMatchBoxes) {
          minX = Math.min(minX, mb.bbox.x);
          minY = Math.min(minY, mb.bbox.y);
          maxX = Math.max(maxX, mb.bbox.x + mb.bbox.width);
          maxY = Math.max(maxY, mb.bbox.y + mb.bbox.height);
        }

        // Add padding and clamp to image dimensions
        const padX = 8;
        const padY = 8;
        const rawW = (maxX - minX) + padX * 2;
        const maxW = Math.round(origWidth * 0.85);
        const boxW = Math.min(maxW, Math.max(1, Math.min(origWidth - minX, rawW)));

        const boxX = Math.max(0, Math.min(origWidth - 1, minX - padX));
        const boxY = Math.max(0, Math.min(origHeight - 1, minY - padY));
        const boxH = Math.max(1, Math.min(origHeight - boxY, (maxY - minY) + padY * 2));

        const resolvedBox: BoundingBox = {
          x: boxX,
          y: boxY,
          width: boxW,
          height: boxH,
          label: `${item.label}: ${item.value}`,
          isNormalized: false,
          tokenIds: bestMatchBoxes.map(b => b.text),
        };

        item.boundingBox = resolvedBox;
        item.boundingBoxes = [resolvedBox];
        item.localizationState = item.localizationState || 'EXACT';
      } else {
        // Layout-Aware Estimated Bounding Box Fallback (Guarantees visual protection is never dropped)
        let estBox: BoundingBox | null = null;
        if (item.type === 'AADHAAR') {
          estBox = {
            x: Math.round(origWidth * 0.28),
            y: Math.round(origHeight * 0.76),
            width: Math.round(origWidth * 0.44),
            height: Math.max(22, Math.round(origHeight * 0.07)),
            label: `${item.label}: ${item.value}`,
            isNormalized: false,
            boxConfidence: 'ESTIMATED',
          };
        } else if (item.type === 'PAN_CARD') {
          estBox = {
            x: Math.round(origWidth * 0.24),
            y: Math.round(origHeight * 0.62),
            width: Math.round(origWidth * 0.46),
            height: Math.max(20, Math.round(origHeight * 0.07)),
            label: `${item.label}: ${item.value}`,
            isNormalized: false,
            boxConfidence: 'ESTIMATED',
          };
        } else if (item.type === 'DOB') {
          estBox = {
            x: Math.round(origWidth * 0.28),
            y: Math.round(origHeight * 0.38),
            width: Math.round(origWidth * 0.38),
            height: Math.max(18, Math.round(origHeight * 0.06)),
            label: `${item.label}: ${item.value}`,
            isNormalized: false,
            boxConfidence: 'ESTIMATED',
          };
        } else if (item.type === 'PHONE') {
          estBox = {
            x: Math.round(origWidth * 0.28),
            y: Math.round(origHeight * 0.48),
            width: Math.round(origWidth * 0.40),
            height: Math.max(18, Math.round(origHeight * 0.06)),
            label: `${item.label}: ${item.value}`,
            isNormalized: false,
            boxConfidence: 'ESTIMATED',
          };
        }

        if (estBox) {
          item.boundingBox = estBox;
          item.boundingBoxes = [estBox];
          item.localizationState = 'ANCHORED';
        } else {
          item.boundingBox = undefined;
          item.boundingBoxes = [];
          item.localizationState = 'MISSING';
        }
      }
    }

    const scanDurationMs = Math.round(performance.now() - startTime);
    return { fullText: extractedText, detectedPii, scanDurationMs };
  }
}
