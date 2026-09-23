import { BoundingBox, EncryptedRegionRecord } from '../../types';

/**
 * Native Web Crypto API Cryptographic Subsystem
 * Zero external libraries, standard AES-256-GCM, RSA-OAEP, PBKDF2, SHA-256.
 */

export class CryptoEngine {
  private static readonly AES_ALGO = { name: 'AES-GCM', length: 256 };
  private static readonly RSA_ALGO = {
    name: 'RSA-OAEP',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  };

  // Convert ArrayBuffer to Hex String
  static bufferToHex(buffer: ArrayBuffer): string {
    const byteArray = new Uint8Array(buffer);
    return Array.from(byteArray)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Convert ArrayBuffer to Base64 String
  static bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Convert Base64 String to Uint8Array
  static base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Compute SHA-256 Checksum of ArrayBuffer or Blob
  static async computeSHA256(data: ArrayBuffer | Blob | string): Promise<string> {
    let buffer: ArrayBuffer;
    if (typeof data === 'string') {
      buffer = new TextEncoder().encode(data).buffer as ArrayBuffer;
    } else if (data instanceof Blob) {
      buffer = await data.arrayBuffer();
    } else {
      buffer = data;
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return this.bufferToHex(hashBuffer);
  }

  // Generate Data Encryption Key (DEK) - AES-256-GCM
  static async generateDEK(): Promise<CryptoKey> {
    return await crypto.subtle.generateKey(this.AES_ALGO, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
  }

  // Export raw key bytes to base64
  static async exportKeyRaw(key: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('raw', key);
    return this.bufferToBase64(exported);
  }

  // Import raw key from base64
  static async importDEKRaw(base64Key: string): Promise<CryptoKey> {
    const rawBuffer = this.base64ToBuffer(base64Key);
    return await crypto.subtle.importKey('raw', rawBuffer.buffer as ArrayBuffer, this.AES_ALGO, true, ['encrypt', 'decrypt']);
  }

  // Derive Master Key Encryption Key (KEK) from user Passphrase / WebAuthn Entropy using PBKDF2
  static async deriveMasterKEK(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(passphrase).buffer as ArrayBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 250000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
    );
  }

  // Envelope Encryption: Wrap DEK with KEK
  static async wrapDEK(dek: CryptoKey, kek: CryptoKey): Promise<{ wrappedKeyB64: string; ivB64: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedBuffer = await crypto.subtle.wrapKey('raw', dek, kek, {
      name: 'AES-GCM',
      iv: iv.buffer as ArrayBuffer,
    });
    return {
      wrappedKeyB64: this.bufferToBase64(wrappedBuffer),
      ivB64: this.bufferToBase64(iv.buffer as ArrayBuffer),
    };
  }

  // Envelope Encryption: Unwrap DEK with KEK
  static async unwrapDEK(wrappedKeyB64: string, ivB64: string, kek: CryptoKey): Promise<CryptoKey> {
    const wrappedBuffer = this.base64ToBuffer(wrappedKeyB64);
    const ivBuffer = this.base64ToBuffer(ivB64);
    return await crypto.subtle.unwrapKey(
      'raw',
      wrappedBuffer.buffer as ArrayBuffer,
      kek,
      {
        name: 'AES-GCM',
        iv: ivBuffer.buffer as ArrayBuffer,
      },
      this.AES_ALGO,
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );
  }

  // Encrypt raw ArrayBuffer with DEK (AES-256-GCM)
  static async encryptBuffer(data: ArrayBuffer, key: CryptoKey): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
      },
      key,
      data
    );
    return { ciphertext, iv };
  }

  // Decrypt raw ArrayBuffer with DEK (AES-256-GCM)
  static async decryptBuffer(ciphertext: ArrayBuffer, iv: Uint8Array, key: CryptoKey): Promise<ArrayBuffer> {
    return await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer as ArrayBuffer,
      },
      key,
      ciphertext
    );
  }

  // RSA-OAEP Keypair generation for P2P sharing
  static async generateP2PKeyPair(): Promise<CryptoKeyPair> {
    return await crypto.subtle.generateKey(this.RSA_ALGO, true, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']);
  }

  // Export Public Key as base64 string
  static async exportPublicKey(key: CryptoKey): Promise<string> {
    const spki = await crypto.subtle.exportKey('spki', key);
    return this.bufferToBase64(spki);
  }

  // Import Public Key from base64 string
  static async importPublicKey(base64Key: string): Promise<CryptoKey> {
    const spkiBuffer = this.base64ToBuffer(base64Key);
    return await crypto.subtle.importKey('spki', spkiBuffer.buffer as ArrayBuffer, this.RSA_ALGO, true, ['wrapKey', 'encrypt']);
  }

  // Wrap DEK for recipient using recipient's RSA Public Key
  static async wrapDEKForRecipient(dek: CryptoKey, recipientPublicKey: CryptoKey): Promise<string> {
    const wrappedBuffer = await crypto.subtle.wrapKey('raw', dek, recipientPublicKey, {
      name: 'RSA-OAEP',
    });
    return this.bufferToBase64(wrappedBuffer);
  }

  // Unwrap DEK on recipient side using recipient's RSA Private Key
  static async unwrapDEKWithPrivateKey(wrappedKeyB64: string, privateKey: CryptoKey): Promise<CryptoKey> {
    const wrappedBuffer = this.base64ToBuffer(wrappedKeyB64);
    return await crypto.subtle.unwrapKey(
      'raw',
      wrappedBuffer.buffer as ArrayBuffer,
      privateKey,
      { name: 'RSA-OAEP' },
      this.AES_ALGO,
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );
  }

  // -------------------------------------------------------------
  // Selective Region Encryption for Images / Canvas
  // -------------------------------------------------------------
  static async encryptImageRegions(
    imgElement: HTMLImageElement | HTMLCanvasElement,
    regions: { box: BoundingBox; type: any }[],
    dek: CryptoKey
  ): Promise<{
    maskedImageDataUrl: string;
    encryptedRegionRecords: EncryptedRegionRecord[];
  }> {
    const canvas = document.createElement('canvas');
    const width = 'naturalWidth' in imgElement ? imgElement.naturalWidth : imgElement.width;
    const height = 'naturalHeight' in imgElement ? imgElement.naturalHeight : imgElement.height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get canvas 2d context');

    ctx.drawImage(imgElement, 0, 0, width, height);

    const encryptedRegionRecords: EncryptedRegionRecord[] = [];

    for (const region of regions) {
      const box = region.box;
      const px = box.x <= 1 ? Math.floor(box.x * width) : Math.floor(box.x);
      const py = box.y <= 1 ? Math.floor(box.y * height) : Math.floor(box.y);
      const pw = box.width <= 1 ? Math.ceil(box.width * width) : Math.ceil(box.width);
      const ph = box.height <= 1 ? Math.ceil(box.height * height) : Math.ceil(box.height);

      const clampedX = Math.max(0, Math.min(px, width - 1));
      const clampedY = Math.max(0, Math.min(py, height - 1));
      const clampedW = Math.max(1, Math.min(pw, width - clampedX));
      const clampedH = Math.max(1, Math.min(ph, height - clampedY));

      const imgData = ctx.getImageData(clampedX, clampedY, clampedW, clampedH);
      const rawPixels = imgData.data.buffer.slice(0); // slice to get ArrayBuffer

      const { ciphertext, iv } = await this.encryptBuffer(rawPixels, dek);

      encryptedRegionRecords.push({
        box: {
          x: clampedX,
          y: clampedY,
          width: clampedW,
          height: clampedH,
          label: box.label,
        },
        encryptedDataB64: this.bufferToBase64(ciphertext),
        ivB64: this.bufferToBase64(iv.buffer as ArrayBuffer),
        type: region.type,
      });

      // Apply High-Entropy Privacy Mask strictly clipped inside the exact bounding box
      ctx.save();
      ctx.beginPath();
      ctx.rect(clampedX, clampedY, clampedW, clampedH);
      ctx.clip();

      // Solid background fill
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(clampedX, clampedY, clampedW, clampedH);

      // Pixelation pattern
      const blockSize = Math.max(6, Math.floor(Math.min(clampedW, clampedH) / 8));
      for (let y = clampedY; y < clampedY + clampedH; y += blockSize) {
        for (let x = clampedX; x < clampedX + clampedW; x += blockSize) {
          const bw = Math.min(blockSize, clampedX + clampedW - x);
          const bh = Math.min(blockSize, clampedY + clampedH - y);
          ctx.fillStyle = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0
            ? 'rgba(15, 23, 42, 0.98)'
            : 'rgba(30, 41, 59, 0.96)';
          ctx.fillRect(x, y, bw, bh);
        }
      }

      ctx.restore();
    }

    const maskedImageDataUrl = canvas.toDataURL('image/png');
    return { maskedImageDataUrl, encryptedRegionRecords };
  }

  // In-Place Region Restoration over target base image
  static async decryptImageRegions(
    targetImageSource: string,
    regionRecords: EncryptedRegionRecord[],
    dek: CryptoKey,
    originalDimensions?: { width: number; height: number }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('Canvas context error');

          // Draw the base target image (contains any user modifications/compression)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          // Determine base dimensions for coordinate scaling if image was resized
          const baseW = originalDimensions?.width || canvas.width;
          const baseH = originalDimensions?.height || canvas.height;
          const scaleX = canvas.width / baseW;
          const scaleY = canvas.height / baseH;

          for (const region of regionRecords) {
            const { box, encryptedDataB64, ivB64 } = region;
            const ciphertext = this.base64ToBuffer(encryptedDataB64);
            const iv = this.base64ToBuffer(ivB64);

            const decryptedBuffer = await this.decryptBuffer(
              ciphertext.buffer.slice(0) as ArrayBuffer,
              iv,
              dek
            );
            const decryptedPixels = new Uint8ClampedArray(decryptedBuffer);
            const restoredImageData = new ImageData(decryptedPixels, box.width, box.height);

            // If image resolution matches, patch directly
            if (scaleX === 1 && scaleY === 1) {
              ctx.putImageData(restoredImageData, box.x, box.y);
            } else {
              // In-place patch with scaled coordinate mapping
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = box.width;
              tempCanvas.height = box.height;
              const tempCtx = tempCanvas.getContext('2d');
              tempCtx?.putImageData(restoredImageData, 0, 0);

              ctx.drawImage(
                tempCanvas,
                Math.round(box.x * scaleX),
                Math.round(box.y * scaleY),
                Math.round(box.width * scaleX),
                Math.round(box.height * scaleY)
              );
            }
          }

          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Failed to load target image for region restoration'));
      img.src = targetImageSource;
    });
  }
}
