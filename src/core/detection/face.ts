import { BoundingBox, DetectedItem } from '../../types';
import { analyzeFacesFromImageData, FACE_WORKER_SCRIPT, FaceDetectorOptions } from './face.worker';

export class FaceDetector {
  private static workerInstance: Worker | null = null;
  private static isWorkerSupported = typeof Worker !== 'undefined' && typeof Blob !== 'undefined';

  // Get or initialize cached Web Worker for face detection
  private static getWorker(): Worker | null {
    if (!this.isWorkerSupported) return null;
    if (!this.workerInstance) {
      try {
        const blob = new Blob([FACE_WORKER_SCRIPT], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        this.workerInstance = new Worker(url);
      } catch (err) {
        console.warn('Face Web Worker initialization failed, falling back to sync analyzer:', err);
        return null;
      }
    }
    return this.workerInstance;
  }

  // Detect faces in an image/canvas via background Web Worker
  static async detectFaces(
    imageOrCanvas: HTMLImageElement | HTMLCanvasElement,
    options?: FaceDetectorOptions
  ): Promise<{ faces: BoundingBox[]; detectedItems: DetectedItem[]; durationMs: number }> {
    const origWidth = 'naturalWidth' in imageOrCanvas ? imageOrCanvas.naturalWidth : imageOrCanvas.width;
    const origHeight = 'naturalHeight' in imageOrCanvas ? imageOrCanvas.naturalHeight : imageOrCanvas.height;

    if (origWidth === 0 || origHeight === 0) {
      return { faces: [], detectedItems: [], durationMs: 0 };
    }

    const startTime = performance.now();

    // 1. First attempt hardware-accelerated native browser FaceDetector (Shape Detection API) if supported
    if (typeof window !== 'undefined' && 'FaceDetector' in (window as any)) {
      try {
        const NativeDetector = (window as any).FaceDetector;
        const detector = new NativeDetector({ fastMode: true, maxDetectedFaces: 10 });
        const nativeResults = await detector.detect(imageOrCanvas);
        if (Array.isArray(nativeResults)) {
          const faces: BoundingBox[] = nativeResults.map((r: any, idx: number) => {
            const b = r.boundingBox;
            return {
              x: Math.max(0, Math.round(b.x)),
              y: Math.max(0, Math.round(b.y)),
              width: Math.min(origWidth, Math.round(b.width)),
              height: Math.min(origHeight, Math.round(b.height)),
              label: `Face Landmark #${idx + 1}`,
              isNormalized: false,
            };
          });

          const detectedItems: DetectedItem[] = faces.map((face, i) => ({
            id: `face_${i + 1}`,
            type: 'FACE',
            label: `Human Face Biometric (${face.width}x${face.height}px)`,
            value: `[Biometric Face Landmark #${i + 1}]`,
            confidence: 0.98,
            boundingBox: face,
            boundingBoxes: [face],
            localizationState: 'EXACT',
            detectionConfidence: 'HIGH',
            complianceTags: ['DPDP_INDIA', 'GDPR'],
            recommendation: 'Biometric visual data. Selective region encryption recommended before sharing.',
          }));

          return { faces, detectedItems, durationMs: Math.round(performance.now() - startTime) };
        }
      } catch (nativeErr) {
        // Fallback to Web Worker morphological analyzer
      }
    }

    // Downscale for fast Worker computation (max 640px) while maintaining aspect ratio
    const maxDim = 640;
    const scale = Math.min(1.0, maxDim / Math.max(origWidth, origHeight));
    const targetW = Math.max(32, Math.round(origWidth * scale));
    const targetH = Math.max(32, Math.round(origHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { faces: [], detectedItems: [], durationMs: 0 };

    ctx.drawImage(imageOrCanvas, 0, 0, targetW, targetH);
    const imgData = ctx.getImageData(0, 0, targetW, targetH);

    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random()}`;
    let downscaledFaces: BoundingBox[] = [];

    const worker = this.getWorker();
    if (worker) {
      // Execute in Web Worker thread with strict requestId correlation
      downscaledFaces = await new Promise<BoundingBox[]>((resolve) => {
        let isResolved = false;

        const cleanup = () => {
          worker.removeEventListener('message', onMsg);
        };

        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            // Fallback sync execution on timeout
            resolve(analyzeFacesFromImageData(imgData, options));
          }
        }, 3000);

        const onMsg = (e: MessageEvent) => {
          if (e.data.type === 'DETECT_FACES_SUCCESS' && e.data.requestId === requestId) {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeout);
              cleanup();
              resolve(e.data.faces || []);
            }
          }
        };

        worker.addEventListener('message', onMsg);
        worker.postMessage({
          type: 'DETECT_FACES',
          requestId,
          imageData: imgData,
          width: targetW,
          height: targetH,
          options,
        });
      });
    } else {
      // Synchronous fallback for test runners
      downscaledFaces = analyzeFacesFromImageData(imgData, options);
    }

    const durationMs = Math.round(performance.now() - startTime);

    // Map bounding boxes back to original image dimensions with strict clamping
    const scaleBack = 1 / scale;
    const faces: BoundingBox[] = downscaledFaces.map((f, idx) => {
      const rawX = Math.round(f.x * scaleBack);
      const rawY = Math.round(f.y * scaleBack);
      const rawW = Math.round(f.width * scaleBack);
      const rawH = Math.round(f.height * scaleBack);

      const clampedX = Math.max(0, Math.min(origWidth - 1, rawX));
      const clampedY = Math.max(0, Math.min(origHeight - 1, rawY));
      const clampedW = Math.max(1, Math.min(origWidth - clampedX, rawW));
      const clampedH = Math.max(1, Math.min(origHeight - clampedY, rawH));

      return {
        x: clampedX,
        y: clampedY,
        width: clampedW,
        height: clampedH,
        label: `Face Landmark #${idx + 1}`,
        isNormalized: false,
      };
    });

    const detectedItems: DetectedItem[] = faces.map((face, i) => ({
      id: `face_${i + 1}`,
      type: 'FACE',
      label: `Human Face Biometric (${face.width}x${face.height}px)`,
      value: `[Biometric Face Landmark #${i + 1}]`,
      confidence: 0.94, // High geometric & chrominance cluster certainty
      boundingBox: face,
      boundingBoxes: [face],
      localizationState: 'EXACT',
      detectionConfidence: 'HIGH',
      complianceTags: ['DPDP_INDIA', 'GDPR'],
      recommendation: 'Biometric visual data. Selective region encryption recommended before sharing.',
    }));

    return { faces, detectedItems, durationMs };
  }
}
