import ExifReader from 'exifreader';
import { ExifData, DetectedItem } from '../../types';

export class ExifInspector {
  // Parse EXIF tags from File, Blob, or ArrayBuffer
  static async extractExif(fileOrBuffer: File | Blob | ArrayBuffer): Promise<{
    exif: ExifData;
    detectedPii: DetectedItem[];
  }> {
    const detectedPii: DetectedItem[] = [];
    const exifData: ExifData = {
      hasGps: false,
    };

    try {
      let buffer: ArrayBuffer;
      if (fileOrBuffer instanceof ArrayBuffer) {
        buffer = fileOrBuffer;
      } else if (typeof Blob !== 'undefined' && fileOrBuffer instanceof Blob) {
        buffer = await fileOrBuffer.arrayBuffer();
      } else {
        return { exif: exifData, detectedPii };
      }

      // Load EXIF tags
      const tags = ExifReader.load(buffer, { expanded: true });

      // Check and rigorously validate GPS metadata
      if (tags.gps && (tags.gps.Latitude !== undefined || tags.gps.Longitude !== undefined)) {
        const rawLat = typeof tags.gps.Latitude === 'number' ? tags.gps.Latitude : parseFloat(String(tags.gps.Latitude || ''));
        const rawLon = typeof tags.gps.Longitude === 'number' ? tags.gps.Longitude : parseFloat(String(tags.gps.Longitude || ''));

        if (Number.isFinite(rawLat) && Number.isFinite(rawLon) && rawLat >= -90 && rawLat <= 90 && rawLon >= -180 && rawLon <= 180) {
          exifData.hasGps = true;
          exifData.latitude = rawLat;
          exifData.longitude = rawLon;

          if (tags.gps.Altitude !== undefined) {
            const rawAlt = typeof tags.gps.Altitude === 'number' ? tags.gps.Altitude : parseFloat(String(tags.gps.Altitude || ''));
            if (Number.isFinite(rawAlt)) {
              exifData.altitude = rawAlt;
            }
          }

          detectedPii.push({
            id: 'exif_gps_1',
            type: 'EXIF_GPS',
            label: 'Precise GPS Coordinates in Metadata',
            value: `${exifData.latitude.toFixed(5)}°, ${exifData.longitude.toFixed(5)}°`,
            confidence: 1.0,
            complianceTags: ['GDPR', 'DPDP_INDIA'],
            recommendation: 'EXIF geotags reveal exact physical location of the user.',
          });
        }
      }

      // Fallback for non-expanded or flat GPS tags
      if (!exifData.hasGps) {
        try {
          const flatTags = ExifReader.load(buffer, { expanded: false });
          const latTag = flatTags['GPSLatitude'] || flatTags['GPS Latitude'] || flatTags['GPSPosition'];
          const lonTag = flatTags['GPSLongitude'] || flatTags['GPS Longitude'];
          if (latTag && lonTag) {
            const latVal = typeof latTag.value === 'number' ? latTag.value : parseFloat(String(latTag.description || ''));
            const lonVal = typeof lonTag.value === 'number' ? lonTag.value : parseFloat(String(lonTag.description || ''));
            if (Number.isFinite(latVal) && Number.isFinite(lonVal)) {
              exifData.hasGps = true;
              exifData.latitude = latVal;
              exifData.longitude = lonVal;
              detectedPii.push({
                id: 'exif_gps_flat',
                type: 'EXIF_GPS',
                label: 'Precise GPS Coordinates in Metadata',
                value: `${exifData.latitude.toFixed(5)}°, ${exifData.longitude.toFixed(5)}°`,
                confidence: 1.0,
                complianceTags: ['GDPR', 'DPDP_INDIA'],
                recommendation: 'EXIF geotags reveal exact physical location of the user.',
              });
            }
          }
        } catch {
          // ignore flat tag errors
        }
      }

      // Check Device/Camera metadata
      if (tags.exif) {
        if (tags.exif.Make) exifData.deviceMake = String(tags.exif.Make.description || '').trim();
        if (tags.exif.Model) exifData.deviceModel = String(tags.exif.Model.description || '').trim();
        if (tags.exif.Software) exifData.software = String(tags.exif.Software.description || '').trim();
        if (tags.exif.DateTimeOriginal) exifData.dateTime = String(tags.exif.DateTimeOriginal.description || '').trim();
        if (tags.exif.LensModel) exifData.lensModel = String(tags.exif.LensModel.description || '').trim();

        if (exifData.deviceMake || exifData.deviceModel) {
          detectedPii.push({
            id: 'exif_dev_1',
            type: 'EXIF_DEVICE',
            label: 'Device Hardware & Camera Footprint',
            value: `${exifData.deviceMake || ''} ${exifData.deviceModel || ''}`.trim(),
            confidence: 0.95,
            complianceTags: ['GDPR'],
            recommendation: 'Device fingerprinting can be used to track specific cameras and users.',
          });
        }
      }

      // Retain lightweight metadata summary rather than massive raw tag binary tree
      exifData.rawTags = {
        make: exifData.deviceMake,
        model: exifData.deviceModel,
        software: exifData.software,
        hasGps: exifData.hasGps,
      };
    } catch (e) {
      // Non-JPEG/PNG or image without EXIF header - graceful no-op
    }

    return { exif: exifData, detectedPii };
  }

  // Strip EXIF metadata by re-encoding canvas while preserving MIME type and dimensions
  static async stripExifFromImage(
    imgElement: HTMLImageElement | HTMLCanvasElement,
    mimeType = 'image/jpeg',
    quality = 0.95
  ): Promise<Blob> {
    const canvas = document.createElement('canvas');
    const width = 'naturalWidth' in imgElement ? imgElement.naturalWidth : imgElement.width;
    const height = 'naturalHeight' in imgElement ? imgElement.naturalHeight : imgElement.height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    ctx.drawImage(imgElement, 0, 0, width, height);

    // Default to image/png if source was png, otherwise image/jpeg
    const targetMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create stripped image blob'));
      }, targetMime, quality);
    });
  }
}
