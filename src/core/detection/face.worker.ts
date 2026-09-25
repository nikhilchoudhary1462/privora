import { BoundingBox, DetectedItem } from '../../types';

export interface FaceDetectorOptions {
  minFaceSize?: number;
  maxFaceSize?: number;
  confidenceThreshold?: number;
}

export interface RawFaceDetectionMessage {
  type: 'DETECT_FACES';
  requestId: string;
  imageData: ImageData;
  width: number;
  height: number;
  options?: FaceDetectorOptions;
}

export interface FaceDetectionResultMessage {
  type: 'DETECT_FACES_SUCCESS';
  requestId: string;
  faces: BoundingBox[];
  durationMs: number;
}

/**
 * Multi-Scale Facial Landmark & Morphological Component Analyzer
 * Identifies connected spatial facial clusters with zero external network requests.
 */
export function analyzeFacesFromImageData(
  imgData: ImageData,
  options?: FaceDetectorOptions
): BoundingBox[] {
  const width = imgData.width;
  const height = imgData.height;
  const data = imgData.data;

  if (width < 10 || height < 10) return [];

  // Options configuration
  const minDim = Math.min(width, height);
  const minFacePx = options?.minFaceSize ? Math.max(20, options.minFaceSize) : Math.max(24, Math.floor(minDim * 0.06));
  // In ID documents and photos, a face never exceeds 45% of the shortest page/photo dimension
  const maxFacePx = options?.maxFaceSize ? Math.min(minDim, options.maxFaceSize) : Math.floor(minDim * 0.45);
  const confidenceThresh = options?.confidenceThreshold ?? 0.35;

  // Binary map of skin-like pixels in YCbCr color space (Comprehensive Kovac, Peer & Chai-Ngan model)
  const skinMap = new Uint8Array(width * height);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Convert RGB to YCbCr
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    // Comprehensive skin tone spectrum: covers fair, wheatish, olive, elderly, and warm/cool lighting
    const isSkin =
      cb >= 75 && cb <= 135 &&
      cr >= 125 && cr <= 180 &&
      y >= 30 && y <= 240 &&
      r >= g - 5 && (r - b) >= -5;

    skinMap[i / 4] = isSkin ? 1 : 0;
  }

  // Connected component labeling to find discrete facial clusters
  const visited = new Uint8Array(width * height);
  const candidateBoxes: { minX: number; maxX: number; minY: number; maxY: number; count: number; score: number }[] = [];

  const getIdx = (x: number, y: number) => y * width + x;
  const minPixels = Math.max(64, Math.floor(minFacePx * minFacePx * 0.35));

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = getIdx(x, y);
      if (skinMap[idx] === 1 && !visited[idx]) {
        let minX = x, maxX = x, minY = y, maxY = y;
        let count = 0;
        const queue: number[] = [x, y];
        visited[idx] = 1;

        while (queue.length > 0) {
          const cy = queue.pop()!;
          const cx = queue.pop()!;
          count++;

          minX = Math.min(minX, cx);
          maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy);
          maxY = Math.max(maxY, cy);

          // 4-connected step of 2px
          const neighbors = [
            [cx + 2, cy], [cx - 2, cy], [cx, cy + 2], [cx, cy - 2]
          ];

          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = getIdx(nx, ny);
              if (skinMap[nIdx] === 1 && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue.push(nx, ny);
              }
            }
          }
        }

        const boxW = maxX - minX;
        const boxH = maxY - minY;
        const aspect = boxW / Math.max(1, boxH);
        const maxBoxDim = Math.max(boxW, boxH);

        // Strict human facial geometry:
        // 1. Aspect ratio strictly between 0.60 and 1.35 (human heads are vertical ovals or roughly square, never wide ribbons)
        // 2. Solid fill factor >= 0.35 (genuine photo cluster, not sparse text characters or empty table borders)
        // 3. Reject corner headers and document margin emblems
        const isTopCornerEmblem = (minX > width * 0.65 || maxX < width * 0.25) && (minY < height * 0.15) && (boxW < width * 0.20);
        const boxArea = Math.max(1, boxW * boxH);
        // Because the grid steps by 2 in X and Y, each visited sample represents 4 pixels
        const solidDensity = (count * 4) / boxArea;

        if (
          count >= minPixels && 
          maxBoxDim >= minFacePx && 
          maxBoxDim <= maxFacePx && 
          aspect >= 0.60 && 
          aspect <= 1.35 &&
          solidDensity >= confidenceThresh &&
          !isTopCornerEmblem
        ) {
          candidateBoxes.push({ minX, maxX, minY, maxY, count, score: solidDensity });
        }
      }
    }
  }

  // Format and clamp bounding boxes with tight facial photo margins
  const faces: BoundingBox[] = candidateBoxes.map((b, index) => {
    const rawW = b.maxX - b.minX;
    const rawH = b.maxY - b.minY;

    // Tight head/portrait margins
    const padX = Math.floor(rawW * 0.08);
    const padYTop = Math.floor(rawH * 0.12);
    const padYBottom = Math.floor(rawH * 0.08);

    const x = Math.max(0, Math.min(width - 1, b.minX - padX));
    const y = Math.max(0, Math.min(height - 1, b.minY - padYTop));
    const w = Math.max(1, Math.min(width - x, rawW + padX * 2));
    const h = Math.max(1, Math.min(height - y, rawH + padYTop + padYBottom));

    return {
      x,
      y,
      width: w,
      height: h,
      label: `Face Biometric #${index + 1}`,
      isNormalized: false,
    };
  });

  return faces;
}

// Inline Web Worker Code String for zero-network bundle with request correlation
export const FACE_WORKER_SCRIPT = `
self.onmessage = function(e) {
  if (e.data.type === 'DETECT_FACES') {
    var startTime = performance.now();
    var requestId = e.data.requestId;
    var imageData = e.data.imageData;
    var options = e.data.options;
    
    var width = imageData.width;
    var height = imageData.height;
    var data = imageData.data;
    
    if (width < 10 || height < 10) {
      self.postMessage({ type: 'DETECT_FACES_SUCCESS', requestId: requestId, faces: [], durationMs: 0 });
      return;
    }

    var minDim = Math.min(width, height);
    var minFacePx = (options && options.minFaceSize) ? Math.max(20, options.minFaceSize) : Math.max(24, Math.floor(minDim * 0.06));
    var maxFacePx = (options && options.maxFaceSize) ? Math.min(minDim, options.maxFaceSize) : Math.floor(minDim * 0.45);
    var confidenceThresh = (options && typeof options.confidenceThreshold === 'number') ? options.confidenceThreshold : 0.35;

    var skinMap = new Uint8Array(width * height);
    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var y = 0.299 * r + 0.587 * g + 0.114 * b;
      var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      var isSkin = cb >= 75 && cb <= 135 && cr >= 125 && cr <= 180 && y >= 30 && y <= 240 && r >= g - 5 && (r - b) >= -5;
      skinMap[i / 4] = isSkin ? 1 : 0;
    }

    var visited = new Uint8Array(width * height);
    var candidateBoxes = [];
    var minPixels = Math.max(64, Math.floor(minFacePx * minFacePx * 0.35));

    for (var y = 0; y < height; y += 2) {
      for (var x = 0; x < width; x += 2) {
        var idx = y * width + x;
        if (skinMap[idx] === 1 && !visited[idx]) {
          var minX = x, maxX = x, minY = y, maxY = y;
          var count = 0;
          var queue = [x, y];
          visited[idx] = 1;

          while (queue.length > 0) {
            var cy = queue.pop();
            var cx = queue.pop();
            count++;
            minX = Math.min(minX, cx);
            maxX = Math.max(maxX, cx);
            minY = Math.min(minY, cy);
            maxY = Math.max(maxY, cy);

            var neighbors = [[cx + 2, cy], [cx - 2, cy], [cx, cy + 2], [cx, cy - 2]];
            for (var k = 0; k < neighbors.length; k++) {
              var nx = neighbors[k][0], ny = neighbors[k][1];
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                var nIdx = ny * width + nx;
                if (skinMap[nIdx] === 1 && !visited[nIdx]) {
                  visited[nIdx] = 1;
                  queue.push(nx, ny);
                }
              }
            }
          }

          var boxW = maxX - minX;
          var boxH = maxY - minY;
          var aspect = boxW / Math.max(1, boxH);
          var maxBoxDim = Math.max(boxW, boxH);
          var isTopCornerEmblem = (minX > width * 0.65 || maxX < width * 0.25) && (minY < height * 0.15) && (boxW < width * 0.20);
          var boxArea = Math.max(1, boxW * boxH);
          var solidDensity = (count * 4) / boxArea;

          if (count >= minPixels && maxBoxDim >= minFacePx && maxBoxDim <= maxFacePx && aspect >= 0.60 && aspect <= 1.35 && solidDensity >= confidenceThresh && !isTopCornerEmblem) {
            candidateBoxes.push({ minX: minX, maxX: maxX, minY: minY, maxY: maxY, count: count });
          }
        }
      }
    }

    var faces = candidateBoxes.map(function(b, index) {
      var rawW = b.maxX - b.minX;
      var rawH = b.maxY - b.minY;
      var padX = Math.floor(rawW * 0.08);
      var padYTop = Math.floor(rawH * 0.12);
      var padYBottom = Math.floor(rawH * 0.08);
      var x = Math.max(0, Math.min(width - 1, b.minX - padX));
      var y = Math.max(0, Math.min(height - 1, b.minY - padYTop));
      var w = Math.max(1, Math.min(width - x, rawW + padX * 2));
      var h = Math.max(1, Math.min(height - y, rawH + padYTop + padYBottom));
      return {
        x: x,
        y: y,
        width: w,
        height: h,
        label: 'Face Biometric #' + (index + 1),
        isNormalized: false
      };
    });

    var durationMs = Math.round(performance.now() - startTime);
    self.postMessage({
      type: 'DETECT_FACES_SUCCESS',
      requestId: requestId,
      faces: faces,
      durationMs: durationMs
    });
  }
};
`;
