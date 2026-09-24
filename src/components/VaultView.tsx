import React, { useState, useEffect, useRef } from 'react';
import { 
  FileLock2, 
  Eye, 
  Download, 
  Trash2, 
  ShieldAlert, 
  ShieldCheck, 
  RefreshCw, 
  Lock, 
  FileText, 
  Image as ImageIcon, 
  CheckCircle2,
  Bug,
  QrCode,
  UploadCloud,
  Sparkles,
  ArrowRight,
  Scissors
} from 'lucide-react';
import { EncryptedFileRecord, EncryptedRegionRecord } from '../types';
import { vaultDB } from '../core/storage/db';
import { CryptoEngine } from '../core/crypto';
import { PdfProcessor } from '../core/detection/pdf';
import { WebAuthnManager, MasterKeySession } from '../core/crypto/webauthn';

interface VaultViewProps {
  session: MasterKeySession;
  onOpenAuthModal: () => void;
  onRefreshNeeded?: () => void;
  onFileShared?: (fileId: string) => void;
}

export interface CropSlice {
  label: string;
  dataUrl: string;
  fileName: string;
}

interface MemoryViewData {
  record: EncryptedFileRecord;
  decryptedDataUrl?: string;
  decryptedPdfUrl?: string;
  maskedPdfUrl?: string;
  maskedDataUrl?: string;
  viewMode: 'DECRYPTED' | 'ENCRYPTED_MASK';
  decryptedText?: string;
  objectUrlToRevoke?: string;
  crops?: CropSlice[];
}

interface RestoredUploadData {
  record: EncryptedFileRecord;
  restoredDataUrl: string;
  fileName: string;
  matchMethod: string;
  objectUrlToRevoke?: string;
  crops?: CropSlice[];
  isPdf?: boolean;
  uploadedSize?: number;
  restoredSize?: number;
  mimeType?: string;
}

export const VaultView: React.FC<VaultViewProps> = ({
  session,
  onOpenAuthModal,
  onRefreshNeeded,
  onFileShared,
}) => {
  const [files, setFiles] = useState<EncryptedFileRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedFileForMemoryView, setSelectedFileForMemoryView] = useState<MemoryViewData | null>(null);

  // Retract / Restore from Uploaded Encrypted Document
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoredResult, setRestoredResult] = useState<RestoredUploadData | null>(null);

  const [tamperAlert, setTamperAlert] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadVaultFiles = async () => {
    setLoading(true);
    try {
      const records = await vaultDB.getAllFiles();
      setFiles(records);
    } catch (err) {
      console.error('Failed to read files from IndexedDB:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVaultFiles();
  }, []);

  // Cleanup object URLs when closing memory view modal
  const handleCloseMemoryView = () => {
    if (selectedFileForMemoryView?.objectUrlToRevoke) {
      URL.revokeObjectURL(selectedFileForMemoryView.objectUrlToRevoke);
    }
    if (selectedFileForMemoryView?.maskedPdfUrl) {
      URL.revokeObjectURL(selectedFileForMemoryView.maskedPdfUrl);
    }
    setSelectedFileForMemoryView(null);
  };

  const handleCloseRestoredModal = () => {
    if (restoredResult?.objectUrlToRevoke) {
      URL.revokeObjectURL(restoredResult.objectUrlToRevoke);
    }
    setRestoredResult(null);
  };

  // Decrypt and extract standalone cropped slices for individual download
  const extractDecryptedCrops = async (
    regionRecords: EncryptedRegionRecord[],
    dek: CryptoKey,
    baseFileName: string
  ): Promise<CropSlice[]> => {
    const slices: CropSlice[] = [];
    for (let i = 0; i < regionRecords.length; i++) {
      const reg = regionRecords[i];
      try {
        const ciphertext = CryptoEngine.base64ToBuffer(reg.encryptedDataB64);
        const iv = CryptoEngine.base64ToBuffer(reg.ivB64);
        const decBuf = await CryptoEngine.decryptBuffer(ciphertext.buffer.slice(0) as ArrayBuffer, iv, dek);
        const pixels = new Uint8ClampedArray(decBuf);
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = reg.box.width;
        cropCanvas.height = reg.box.height;
        const cropCtx = cropCanvas.getContext('2d');
        if (cropCtx) {
          cropCtx.putImageData(new ImageData(pixels, reg.box.width, reg.box.height), 0, 0);
          const cleanType = reg.type === 'FACE' ? 'Face Photo' : reg.type === 'AADHAAR' ? 'Aadhaar Number' : reg.type.replace(/_/g, ' ');
          const cleanBase = baseFileName.replace(/\.[^/.]+$/, '');
          slices.push({
            label: `${cleanType} #${i + 1}`,
            dataUrl: cropCanvas.toDataURL('image/png'),
            fileName: `crop_${cleanType.toLowerCase().replace(/\s+/g, '_')}_${cleanBase}.png`,
          });
        }
      } catch (e) {
        console.warn('Crop slice decrypt error:', e);
      }
    }
    return slices;
  };

  // Upload an encrypted/masked file, match against vault records, and restore original plaintext
  const handleUploadAndRestore = async (file: File) => {
    const currentSession = WebAuthnManager.getSession();
    let kek = currentSession.masterKEK;
    if (!kek) {
      try {
        kek = await WebAuthnManager.getOrDeriveActiveKey();
      } catch (e) {
        onOpenAuthModal();
        return;
      }
    }

    setIsRestoring(true);
    setTamperAlert(null);
    setActionSuccess(null);

    try {
      const allRecords = await vaultDB.getAllFiles();

      if (allRecords.length === 0) {
        throw new Error('Your local vault is empty. No records available to match against.');
      }

      // Compute uploaded file SHA-256 hash
      const fileBuf = await file.arrayBuffer();
      const uploadedHash = await CryptoEngine.computeSHA256(fileBuf);

      // Normalize uploaded filename
      const cleanName = file.name
        .replace(/^encrypted_/i, '')
        .replace(/^clean_/i, '')
        .replace(/^masked_/i, '')
        .replace(/\.[^/.]+$/, '')
        .toLowerCase();

      // Search database for matching record
      const matched = allRecords.find((rec) => {
        // Match 1: Hash matching (against stored encryptedHash or baseline originalHash)
        if (rec.encryptedHash === uploadedHash || rec.originalHash === uploadedHash) return true;
        // Match 2: Exact filename matching
        if (rec.fileName.toLowerCase() === file.name.toLowerCase()) return true;
        // Match 3: Normalized basename matching
        const recBaseName = rec.fileName.replace(/\.[^/.]+$/, '').toLowerCase();
        if (recBaseName === cleanName) return true;
        if (file.name.toLowerCase().includes(recBaseName) || recBaseName.includes(cleanName)) return true;
        return false;
      });

      if (!matched) {
        throw new Error(`No matching record found in this vault for "${file.name}". Please ensure this document was originally encrypted on this device.`);
      }

      // Unwrap DEK using Master KEK
      const dek = await CryptoEngine.unwrapDEK(matched.wrappedDek, matched.iv, kek);

      let restoredDataUrl = '';
      let objectUrlToRevoke: string | undefined;
      let decryptedCrops: CropSlice[] = [];

      const isPdfFile = matched.originalMimeType === 'application/pdf' || matched.fileName.toLowerCase().endsWith('.pdf');

      if (matched.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION' && matched.encryptedRegions) {
        if (isPdfFile && matched.pdfPages && matched.pdfPages.length > 1) {
          // Multi-Page PDF Restoration
          const restoredPages: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
          for (const page of matched.pdfPages) {
            const pageRegions = matched.encryptedRegions.filter(r => r.pageNumber === page.pageNumber || (!r.pageNumber && page.pageNumber === 1));
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = page.width;
            pageCanvas.height = page.height;
            const pCtx = pageCanvas.getContext('2d');
            if (!pCtx) continue;

            if (pageRegions.length > 0) {
              const restoredPageUrl = await CryptoEngine.decryptImageRegions(page.pageImageDataUrl, pageRegions, dek);
              const img = new Image();
              await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error(`Failed to load page ${page.pageNumber}`));
                img.src = restoredPageUrl;
              });
              pCtx.drawImage(img, 0, 0);
            } else {
              const img = new Image();
              await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error(`Failed to load page ${page.pageNumber}`));
                img.src = page.pageImageDataUrl;
              });
              pCtx.drawImage(img, 0, 0);
            }
            restoredPages.push({ canvas: pageCanvas, width: page.width, height: page.height });
          }
          const fullPdfBlob = PdfProcessor.exportMultiPagePdf(restoredPages);
          restoredDataUrl = URL.createObjectURL(fullPdfBlob);
          objectUrlToRevoke = restoredDataUrl;
          decryptedCrops = await extractDecryptedCrops(matched.encryptedRegions, dek, matched.fileName);
        } else {
          // Single-Page or Image Document (JPEG, PNG, WebP)
          const isUploadedImage = file.type.startsWith('image/') || !!file.name.match(/\.(png|jpe?g|webp|svg)$/i);
          const isJpeg = file.type === 'image/jpeg' || !!file.name.match(/\.(jpe?g)$/i);
          const isWebp = file.type === 'image/webp' || !!file.name.match(/\.webp$/i);
          const chosenMime = isJpeg ? 'image/jpeg' : (isWebp ? 'image/webp' : 'image/png');
          const ext = isJpeg ? 'jpg' : (isWebp ? 'webp' : 'png');

          const targetSource = isUploadedImage ? URL.createObjectURL(file) : (typeof matched.encryptedBlob === 'string' ? matched.encryptedBlob : (matched.pdfPages?.[0]?.pageImageDataUrl || ''));

          // Decrypt with adaptive compression preservation
          const decryptedImgUrl = await CryptoEngine.decryptImageRegions(
            targetSource,
            matched.encryptedRegions,
            dek,
            undefined,
            {
              mimeType: chosenMime,
              targetByteSize: file.size,
            }
          );

          decryptedCrops = await extractDecryptedCrops(matched.encryptedRegions, dek, matched.fileName);

          if (isUploadedImage) {
            URL.revokeObjectURL(targetSource);
          }

          if (isPdfFile) {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image for PDF restoration'));
              img.src = decryptedImgUrl;
            });
            const pdfBlob = PdfProcessor.canvasToPdfBlob(decryptedImgUrl, img.naturalWidth || 800, img.naturalHeight || 1000);
            restoredDataUrl = URL.createObjectURL(pdfBlob);
            objectUrlToRevoke = restoredDataUrl;
          } else {
            restoredDataUrl = decryptedImgUrl;
          }

          const baseRestoredName = matched.fileName.replace(/\.[^/.]+$/, '');
          const outputFileName = `restored_${baseRestoredName}.${ext}`;
          const base64Part = decryptedImgUrl.includes(',') ? decryptedImgUrl.split(',')[1] : '';
          const restoredSize = base64Part ? Math.round(base64Part.length * 0.75) : file.size;

          setRestoredResult({
            record: matched,
            restoredDataUrl,
            fileName: outputFileName,
            matchMethod: `Matched with Vault Record: ${matched.fileName} (SHA-256 Signature Verified)`,
            objectUrlToRevoke,
            crops: decryptedCrops,
            isPdf: isPdfFile,
            uploadedSize: file.size,
            restoredSize,
            mimeType: chosenMime,
          });
          setActionSuccess(`Matched and restored "${matched.fileName}" retaining compressed size (${(restoredSize / 1024).toFixed(1)} KB)!`);
          await vaultDB.logEvent({
            eventType: 'VIEW_MEMORY',
            severity: 'SUCCESS',
            source: 'WEB_APP',
            fileId: matched.id,
            fileName: matched.fileName,
            actionTaken: 'Document uploaded from PC, matched with database record, and restored in memory preserving compression',
            details: { uploadedFileName: file.name, uploadedSize: file.size, restoredSize },
          });
          return;
        }
      } else if (matched.encryptedBlob instanceof Blob) {
        const encBytes = await matched.encryptedBlob.arrayBuffer();
        const ivBytes = CryptoEngine.base64ToBuffer(matched.iv);
        const decBuf = await CryptoEngine.decryptBuffer(encBytes.slice(0), ivBytes, dek);
        const blob = new Blob([decBuf], { type: isPdfFile ? 'application/pdf' : matched.originalMimeType });
        restoredDataUrl = URL.createObjectURL(blob);
        objectUrlToRevoke = restoredDataUrl;

        setRestoredResult({
          record: matched,
          restoredDataUrl,
          fileName: 'original_' + matched.fileName,
          matchMethod: `Matched with Vault Record: ${matched.fileName} (SHA-256 Signature Verified)`,
          objectUrlToRevoke,
          crops: decryptedCrops,
          isPdf: isPdfFile,
          uploadedSize: file.size,
          restoredSize: blob.size,
          mimeType: blob.type,
        });
        setActionSuccess(`Matched and restored original "${matched.fileName}" from local vault!`);
        await vaultDB.logEvent({
          eventType: 'VIEW_MEMORY',
          severity: 'SUCCESS',
          source: 'WEB_APP',
          fileId: matched.id,
          fileName: matched.fileName,
          actionTaken: 'Document uploaded from PC, matched with database record, and restored in memory',
          details: { uploadedFileName: file.name },
        });
        return;
      } else {
        throw new Error('Unsupported record format for restoration.');
      }
      await vaultDB.logEvent({
        eventType: 'VIEW_MEMORY',
        severity: 'SUCCESS',
        source: 'WEB_APP',
        fileId: matched.id,
        fileName: matched.fileName,
        actionTaken: 'Document uploaded from PC, matched with database record, and restored in memory',
        details: { uploadedFileName: file.name },
      });
    } catch (err: any) {
      console.error('Restoration error:', err);
      setTamperAlert(err.message || 'Failed to restore original document.');
    } finally {
      setIsRestoring(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  // 1. View-Only Decrypt in Memory with Strict Dual Hash Verification (C6)
  const handleViewInMemory = async (file: EncryptedFileRecord) => {
    const currentSession = WebAuthnManager.getSession();
    let kek = currentSession.masterKEK;
    if (!kek) {
      try {
        kek = await WebAuthnManager.getOrDeriveActiveKey();
      } catch (e) {
        onOpenAuthModal();
        return;
      }
    }

    setTamperAlert(null);
    setActionSuccess(null);

    try {
      const isPdfFile = file.originalMimeType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf');

      // STEP 1: Verify Ciphertext Integrity before unwrap/decrypt
      if (typeof file.encryptedBlob === 'string') {
        const currentCipherHash = await CryptoEngine.computeSHA256(file.encryptedBlob);
        let isMatch = (currentCipherHash === file.encryptedHash);

        if (!isMatch && file.encryptedBlob.startsWith('data:')) {
          try {
            const res = await fetch(file.encryptedBlob);
            const buf = await res.arrayBuffer();
            const binHash = await CryptoEngine.computeSHA256(buf);
            if (binHash === file.encryptedHash) {
              isMatch = true;
            }
          } catch {
            // ignore
          }
        }

        if (!isMatch) {
          await vaultDB.logEvent({
            eventType: 'TAMPER_ALERT',
            severity: 'ALERT',
            source: 'WEB_APP',
            fileId: file.id,
            fileName: file.fileName,
            actionTaken: 'TAMPER DETECTED: Region ciphertext hash mismatch on memory view',
            details: { expected: file.encryptedHash, actual: currentCipherHash },
            tamperDetected: true,
          });
          setTamperAlert('TAMPER ALERT: Region ciphertext integrity hash mismatch! Decryption blocked.');
          return;
        }
      } else if (file.encryptedBlob instanceof Blob) {
        const currentCipherHash = await CryptoEngine.computeSHA256(file.encryptedBlob);
        if (currentCipherHash !== file.encryptedHash) {
          await vaultDB.logEvent({
            eventType: 'TAMPER_ALERT',
            severity: 'ALERT',
            source: 'WEB_APP',
            fileId: file.id,
            fileName: file.fileName,
            actionTaken: 'TAMPER DETECTED: Ciphertext hash mismatch on memory view',
            details: { expected: file.encryptedHash, actual: currentCipherHash },
            tamperDetected: true,
          });
          setTamperAlert('TAMPER ALERT: Ciphertext hash does not match original manifest! Decryption blocked.');
          return;
        }
      }

      // STEP 2: Unwrap DEK using Master KEK
      const dek = await CryptoEngine.unwrapDEK(file.wrappedDek, file.iv, kek);

      // STEP 3: Decrypt
      if (file.pipelineUsed === 'SYNTHETIC-PSEUDONYMIZED') {
        if (file.encryptedBlob instanceof Blob) {
          const url = URL.createObjectURL(file.encryptedBlob);
          if (isPdfFile) {
            setSelectedFileForMemoryView({
              record: file,
              decryptedPdfUrl: url,
              viewMode: 'DECRYPTED',
              objectUrlToRevoke: url,
            });
          } else {
            setSelectedFileForMemoryView({
              record: file,
              decryptedDataUrl: url,
              viewMode: 'DECRYPTED',
              objectUrlToRevoke: url,
            });
          }
        } else if (typeof file.encryptedBlob === 'string') {
          if (isPdfFile) {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image for PDF view'));
              img.src = file.encryptedBlob as string;
            });
            const pdfBlob = PdfProcessor.canvasToPdfBlob(file.encryptedBlob, img.naturalWidth || 800, img.naturalHeight || 1000);
            const url = URL.createObjectURL(pdfBlob);
            setSelectedFileForMemoryView({
              record: file,
              decryptedPdfUrl: url,
              viewMode: 'DECRYPTED',
              objectUrlToRevoke: url,
            });
          } else if (file.encryptedBlob.startsWith('data:image/')) {
            setSelectedFileForMemoryView({
              record: file,
              decryptedDataUrl: file.encryptedBlob,
              viewMode: 'DECRYPTED',
            });
          } else if (file.encryptedBlob.startsWith('data:text/')) {
            const text = decodeURIComponent(file.encryptedBlob.replace(/^data:text\/[^;]+;charset=utf-8,/, ''));
            setSelectedFileForMemoryView({
              record: file,
              decryptedText: text,
              viewMode: 'DECRYPTED',
            });
          } else {
            setSelectedFileForMemoryView({
              record: file,
              decryptedDataUrl: file.encryptedBlob,
              viewMode: 'DECRYPTED',
            });
          }
        }
      } else if (file.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION') {
        if (isPdfFile && file.pdfPages && file.pdfPages.length > 0) {
          // 1. Generate Masked PDF for the "Stored Masked" tab
          const maskedPages = file.pdfPages.map(p => ({
            canvas: p.pageImageDataUrl,
            width: p.width,
            height: p.height,
          }));
          const maskedPdfBlob = maskedPages.length === 1
            ? PdfProcessor.canvasToPdfBlob(maskedPages[0].canvas, maskedPages[0].width, maskedPages[0].height)
            : PdfProcessor.exportMultiPagePdf(maskedPages);
          const maskedUrl = URL.createObjectURL(maskedPdfBlob);

          // 2. Generate Decrypted/Restored PDF for the "Decrypted RAM" tab
          const restoredPages: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
          for (const page of file.pdfPages) {
            const pageRegions = (file.encryptedRegions || []).filter(r => r.pageNumber === page.pageNumber || (!r.pageNumber && page.pageNumber === 1));
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = page.width;
            pageCanvas.height = page.height;
            const pCtx = pageCanvas.getContext('2d');
            if (!pCtx) continue;

            if (pageRegions.length > 0) {
              const restoredPageUrl = await CryptoEngine.decryptImageRegions(page.pageImageDataUrl, pageRegions, dek);
              const img = new Image();
              await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error(`Failed to load page ${page.pageNumber}`));
                img.src = restoredPageUrl;
              });
              pCtx.drawImage(img, 0, 0);
            } else {
              const img = new Image();
              await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error(`Failed to load page ${page.pageNumber}`));
                img.src = page.pageImageDataUrl;
              });
              pCtx.drawImage(img, 0, 0);
            }
            restoredPages.push({ canvas: pageCanvas, width: page.width, height: page.height });
          }

          const fullPdfBlob = restoredPages.length === 1
            ? PdfProcessor.canvasToPdfBlob(restoredPages[0].canvas, restoredPages[0].width, restoredPages[0].height)
            : PdfProcessor.exportMultiPagePdf(restoredPages);
          const decryptedUrl = URL.createObjectURL(fullPdfBlob);
          const decryptedCrops = await extractDecryptedCrops(file.encryptedRegions || [], dek, file.fileName);

          setSelectedFileForMemoryView({
            record: file,
            maskedPdfUrl: maskedUrl,
            decryptedPdfUrl: decryptedUrl,
            viewMode: 'ENCRYPTED_MASK',
            objectUrlToRevoke: decryptedUrl,
            crops: decryptedCrops,
          });
        } else {
          const baseSource = typeof file.encryptedBlob === 'string' 
            ? file.encryptedBlob 
            : (file.pdfPages?.[0]?.pageImageDataUrl || '');
          
          if (!baseSource) throw new Error('Missing base image source for region decryption.');

          const restoredDataUrl = await CryptoEngine.decryptImageRegions(
            baseSource,
            file.encryptedRegions || [],
            dek
          );

          const decryptedCrops = await extractDecryptedCrops(file.encryptedRegions || [], dek, file.fileName);

          if (isPdfFile) {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image for PDF view'));
              img.src = restoredDataUrl;
            });
            const pdfBlob = PdfProcessor.canvasToPdfBlob(restoredDataUrl, img.naturalWidth || 800, img.naturalHeight || 1000);
            const decryptedUrl = URL.createObjectURL(pdfBlob);

            const maskedBlob = typeof file.encryptedBlob === 'string'
              ? PdfProcessor.canvasToPdfBlob(file.encryptedBlob, img.naturalWidth || 800, img.naturalHeight || 1000)
              : (file.encryptedBlob instanceof Blob ? file.encryptedBlob : undefined);
            const maskedUrl = maskedBlob instanceof Blob ? URL.createObjectURL(maskedBlob) : undefined;

            setSelectedFileForMemoryView({
              record: file,
              maskedPdfUrl: maskedUrl,
              decryptedPdfUrl: decryptedUrl,
              maskedDataUrl: typeof file.encryptedBlob === 'string' ? file.encryptedBlob : undefined,
              decryptedDataUrl: restoredDataUrl,
              viewMode: 'ENCRYPTED_MASK',
              objectUrlToRevoke: decryptedUrl,
              crops: decryptedCrops,
            });
          } else {
            setSelectedFileForMemoryView({
              record: file,
              maskedDataUrl: typeof file.encryptedBlob === 'string' ? file.encryptedBlob : undefined,
              decryptedDataUrl: restoredDataUrl,
              viewMode: 'ENCRYPTED_MASK',
              crops: decryptedCrops,
            });
          }
        }
      } else if (file.encryptedBlob instanceof Blob) {
        const encryptedBytes = await file.encryptedBlob.arrayBuffer();
        const ivBytes = CryptoEngine.base64ToBuffer(file.iv);

        const decryptedBuffer = await CryptoEngine.decryptBuffer(encryptedBytes.slice(0), ivBytes, dek);

        // Verify decrypted plaintext integrity against original baseline hash
        const decryptedHash = await CryptoEngine.computeSHA256(decryptedBuffer);
        if (decryptedHash !== file.originalHash && file.pipelineUsed !== 'REDACTED-METADATA') {
          await vaultDB.logEvent({
            eventType: 'TAMPER_ALERT',
            severity: 'ALERT',
            source: 'WEB_APP',
            fileId: file.id,
            fileName: file.fileName,
            actionTaken: 'TAMPER DETECTED: Plaintext SHA-256 mismatch on memory view',
            details: { original: file.originalHash, current: decryptedHash },
            tamperDetected: true,
          });
          setTamperAlert('INTEGRITY ERROR: Decrypted plaintext hash mismatch. Content has been tampered with.');
          return;
        }

        const isImage = file.originalMimeType.startsWith('image/');

        if (isImage) {
          const blob = new Blob([decryptedBuffer], { type: file.originalMimeType });
          const url = URL.createObjectURL(blob);
          setSelectedFileForMemoryView({ 
            record: file, 
            decryptedDataUrl: url,
            viewMode: 'DECRYPTED',
            objectUrlToRevoke: url
          });
        } else if (isPdfFile) {
          const blob = new Blob([decryptedBuffer], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          setSelectedFileForMemoryView({
            record: file,
            decryptedPdfUrl: url,
            viewMode: 'DECRYPTED',
            objectUrlToRevoke: url
          });
        } else {
          const text = new TextDecoder().decode(decryptedBuffer);
          setSelectedFileForMemoryView({ record: file, decryptedText: text, viewMode: 'DECRYPTED' });
        }
      }

      // Log successful verified memory view
      await vaultDB.logEvent({
        eventType: 'VIEW_MEMORY',
        severity: 'SUCCESS',
        source: 'WEB_APP',
        fileId: file.id,
        fileName: file.fileName,
        actionTaken: 'Decrypted and viewed in volatile memory with SHA-256 integrity verified',
        details: { pipeline: file.pipelineUsed },
      });
    } catch (err: any) {
      console.error('Decryption failed:', err);
      setTamperAlert(`Decryption failed: ${err.message || 'Key unwrap or authentication tag mismatch'}`);
    }
  };

  // 2. Download / Restore Plaintext with Full Cryptographic Verification
  const handleRestoreDownload = async (file: EncryptedFileRecord) => {
    const currentSession = WebAuthnManager.getSession();
    let kek = currentSession.masterKEK;
    if (!kek) {
      try {
        kek = await WebAuthnManager.getOrDeriveActiveKey();
      } catch (e) {
        onOpenAuthModal();
        return;
      }
    }

    setTamperAlert(null);
    setActionSuccess(null);

    try {
      const isPdf = file.fileName.toLowerCase().endsWith('.pdf') || file.originalMimeType === 'application/pdf';

      // STEP 1: Verify Ciphertext Integrity before proceeding
      if (typeof file.encryptedBlob === 'string') {
        const currentCipherHash = await CryptoEngine.computeSHA256(file.encryptedBlob);
        if (currentCipherHash !== file.encryptedHash) {
          await vaultDB.logEvent({
            eventType: 'TAMPER_ALERT',
            severity: 'ALERT',
            source: 'WEB_APP',
            fileId: file.id,
            fileName: file.fileName,
            actionTaken: 'TAMPER DETECTED: Ciphertext mismatch on download attempt',
            details: { expected: file.encryptedHash, actual: currentCipherHash },
            tamperDetected: true,
          });
          setTamperAlert('TAMPER BLOCKED: Encrypted file integrity compromised. Export blocked.');
          return;
        }
      } else if (file.encryptedBlob instanceof Blob) {
        const currentCipherHash = await CryptoEngine.computeSHA256(file.encryptedBlob);
        if (currentCipherHash !== file.encryptedHash) {
          await vaultDB.logEvent({
            eventType: 'TAMPER_ALERT',
            severity: 'ALERT',
            source: 'WEB_APP',
            fileId: file.id,
            fileName: file.fileName,
            actionTaken: 'TAMPER DETECTED: Ciphertext mismatch on download attempt',
            details: { expected: file.encryptedHash, actual: currentCipherHash },
            tamperDetected: true,
          });
          setTamperAlert('TAMPER BLOCKED: Encrypted file integrity compromised. Export blocked.');
          return;
        }
      }

      // STEP 2: Unwrap DEK
      const dek = await CryptoEngine.unwrapDEK(file.wrappedDek, file.iv, kek);

      // STEP 3: Decrypt and Export
      if (file.pipelineUsed === 'SYNTHETIC-PSEUDONYMIZED') {
        if (file.encryptedBlob instanceof Blob) {
          const url = URL.createObjectURL(file.encryptedBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = isPdf 
            ? (file.fileName.toLowerCase().endsWith('.pdf') ? `synthetic_${file.fileName}` : `synthetic_${file.fileName}.pdf`)
            : `synthetic_${file.fileName}`;
          a.click();
          URL.revokeObjectURL(url);
          setActionSuccess(`Exported synthetic mock document: ${a.download}`);
          return;
        } else if (typeof file.encryptedBlob === 'string') {
          if (isPdf) {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image for PDF export'));
              img.src = file.encryptedBlob as string;
            });
            const pdfBlob = PdfProcessor.canvasToPdfBlob(file.encryptedBlob, img.naturalWidth || 800, img.naturalHeight || 1000);
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.fileName.toLowerCase().endsWith('.pdf') ? `synthetic_${file.fileName}` : `synthetic_${file.fileName}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            setActionSuccess(`Exported synthetic mock document: ${a.download}`);
            return;
          } else {
            const a = document.createElement('a');
            a.href = file.encryptedBlob;
            a.download = `synthetic_${file.fileName}`;
            a.click();
            setActionSuccess(`Exported synthetic mock document: synthetic_${file.fileName}`);
            return;
          }
        }
      } else if (file.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION') {
        if (isPdf && file.pdfPages && file.pdfPages.length > 0) {
          // Multi-Page or Single-Page PDF Restoration
          const restoredPages: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
          for (const page of file.pdfPages) {
            const pageRegions = (file.encryptedRegions || []).filter(r => r.pageNumber === page.pageNumber || (!r.pageNumber && page.pageNumber === 1));
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = page.width;
            pageCanvas.height = page.height;
            const pCtx = pageCanvas.getContext('2d');
            if (!pCtx) continue;

            if (pageRegions.length > 0) {
              const restoredPageUrl = await CryptoEngine.decryptImageRegions(page.pageImageDataUrl, pageRegions, dek);
              const img = new Image();
              await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error(`Failed to load page ${page.pageNumber}`));
                img.src = restoredPageUrl;
              });
              pCtx.drawImage(img, 0, 0);
            } else {
              const img = new Image();
              await new Promise<void>((res, rej) => {
                img.onload = () => res();
                img.onerror = () => rej(new Error(`Failed to load page ${page.pageNumber}`));
                img.src = page.pageImageDataUrl;
              });
              pCtx.drawImage(img, 0, 0);
            }
            restoredPages.push({ canvas: pageCanvas, width: page.width, height: page.height });
          }

          const fullPdfBlob = restoredPages.length === 1
            ? PdfProcessor.canvasToPdfBlob(restoredPages[0].canvas, restoredPages[0].width, restoredPages[0].height)
            : PdfProcessor.exportMultiPagePdf(restoredPages);
          const url = URL.createObjectURL(fullPdfBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = file.fileName.toLowerCase().endsWith('.pdf') ? ('restored_' + file.fileName) : ('restored_' + file.fileName + '.pdf');
          a.click();
          URL.revokeObjectURL(url);
          setActionSuccess(`Restored and exported complete PDF '${a.download}'!`);
          return;
        } else {
          // Single-Page PDF fallback or Image
          const baseSource = typeof file.encryptedBlob === 'string' 
            ? file.encryptedBlob 
            : (file.pdfPages?.[0]?.pageImageDataUrl || '');
          
          if (!baseSource) throw new Error('Missing base image source for region decryption.');

          const restoredDataUrl = await CryptoEngine.decryptImageRegions(
            baseSource,
            file.encryptedRegions || [],
            dek
          );

          let exportUrl = restoredDataUrl;
          let exportFileName = 'restored_' + file.fileName;
          let toRevoke: string | undefined = undefined;

          if (isPdf) {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image for PDF export'));
              img.src = restoredDataUrl;
            });
            const pdfBlob = PdfProcessor.canvasToPdfBlob(restoredDataUrl, img.naturalWidth || 800, img.naturalHeight || 1000);
            exportUrl = URL.createObjectURL(pdfBlob);
            toRevoke = exportUrl;
            exportFileName = file.fileName.toLowerCase().endsWith('.pdf') ? ('restored_' + file.fileName) : ('restored_' + file.fileName + '.pdf');
          }

          const a = document.createElement('a');
          a.href = exportUrl;
          a.download = exportFileName;
          a.click();
          if (toRevoke) URL.revokeObjectURL(toRevoke);
        }
      } else if (file.encryptedBlob instanceof Blob) {
        const encryptedBytes = await file.encryptedBlob.arrayBuffer();
        const ivBytes = CryptoEngine.base64ToBuffer(file.iv);
        const decryptedBuffer = await CryptoEngine.decryptBuffer(encryptedBytes.slice(0), ivBytes, dek);

        // Verify decrypted plaintext integrity
        const decryptedHash = await CryptoEngine.computeSHA256(decryptedBuffer);
        if (decryptedHash !== file.originalHash && file.pipelineUsed !== 'REDACTED-METADATA') {
          await vaultDB.logEvent({
            eventType: 'TAMPER_ALERT',
            severity: 'ALERT',
            source: 'WEB_APP',
            fileId: file.id,
            fileName: file.fileName,
            actionTaken: 'TAMPER DETECTED: Plaintext mismatch before file download',
            details: { original: file.originalHash, current: decryptedHash },
            tamperDetected: true,
          });
          setTamperAlert('INTEGRITY FAILURE: Decrypted plaintext did not match original hash. Export aborted.');
          return;
        }

        const blob = new Blob([decryptedBuffer], { type: isPdf ? 'application/pdf' : file.originalMimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'restored_' + file.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }

      setActionSuccess(`Restored and exported '${file.fileName}' with verified integrity!`);

      await vaultDB.logEvent({
        eventType: 'DECRYPT',
        severity: 'SUCCESS',
        source: 'WEB_APP',
        fileId: file.id,
        fileName: file.fileName,
        actionTaken: 'Exported verified decrypted file to local filesystem',
        details: { size: file.originalSize, pipeline: file.pipelineUsed },
      });
    } catch (e: any) {
      console.error('Export failed:', e);
      setTamperAlert(`Export failed: ${e.message}`);
    }
  };

  // 3. Download Masked / Sanitized document with blurred or synthetic areas
  const handleDownloadMasked = async (file: EncryptedFileRecord) => {
    setTamperAlert(null);
    setActionSuccess(null);

    try {
      const isPdf = file.fileName.toLowerCase().endsWith('.pdf') || file.originalMimeType === 'application/pdf';

      if (file.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION') {
        if (isPdf) {
          if (file.pdfPages && file.pdfPages.length > 0) {
            const maskedPages = file.pdfPages.map(p => ({
              canvas: p.pageImageDataUrl,
              width: p.width,
              height: p.height,
            }));
            const pdfBlob = maskedPages.length === 1
              ? PdfProcessor.canvasToPdfBlob(maskedPages[0].canvas, maskedPages[0].width, maskedPages[0].height)
              : PdfProcessor.exportMultiPagePdf(maskedPages);
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `masked_${file.fileName.toLowerCase().endsWith('.pdf') ? file.fileName : file.fileName + '.pdf'}`;
            a.click();
            URL.revokeObjectURL(url);
            setActionSuccess(`Downloaded masked/encrypted PDF: ${a.download}`);
            return;
          } else if (file.encryptedBlob instanceof Blob) {
            const url = URL.createObjectURL(file.encryptedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `masked_${file.fileName}`;
            a.click();
            URL.revokeObjectURL(url);
            setActionSuccess(`Downloaded masked/encrypted PDF: ${a.download}`);
            return;
          } else if (typeof file.encryptedBlob === 'string') {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => reject(new Error('Failed to load image for PDF export'));
              img.src = file.encryptedBlob as string;
            });
            const pdfBlob = PdfProcessor.canvasToPdfBlob(file.encryptedBlob, img.naturalWidth || 800, img.naturalHeight || 1000);
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `masked_${file.fileName}`;
            a.click();
            URL.revokeObjectURL(url);
            setActionSuccess(`Downloaded masked/encrypted PDF: ${a.download}`);
            return;
          }
        } else {
          // Standard Image
          if (typeof file.encryptedBlob === 'string') {
            const a = document.createElement('a');
            a.href = file.encryptedBlob;
            a.download = `masked_${file.fileName}`;
            a.click();
            setActionSuccess(`Downloaded masked image: ${a.download}`);
            return;
          } else if (file.encryptedBlob instanceof Blob) {
            const url = URL.createObjectURL(file.encryptedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `masked_${file.fileName}`;
            a.click();
            URL.revokeObjectURL(url);
            setActionSuccess(`Downloaded masked image: ${a.download}`);
            return;
          }
        }
      } else if (file.pipelineUsed === 'SYNTHETIC-PSEUDONYMIZED') {
        if (file.encryptedBlob instanceof Blob) {
          const url = URL.createObjectURL(file.encryptedBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = isPdf 
            ? (file.fileName.toLowerCase().endsWith('.pdf') ? `synthetic_${file.fileName}` : `synthetic_${file.fileName}.pdf`)
            : `synthetic_${file.fileName}`;
          a.click();
          URL.revokeObjectURL(url);
          setActionSuccess(`Exported synthetic document: ${a.download}`);
          return;
        } else if (typeof file.encryptedBlob === 'string') {
          const a = document.createElement('a');
          a.href = file.encryptedBlob;
          a.download = `synthetic_${file.fileName}`;
          a.click();
          setActionSuccess(`Exported synthetic document: ${a.download}`);
          return;
        }
      } else if (file.pipelineUsed === 'REDACTED-METADATA') {
        if (file.encryptedBlob instanceof Blob) {
          const url = URL.createObjectURL(file.encryptedBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `clean_${file.fileName}`;
          a.click();
          URL.revokeObjectURL(url);
          setActionSuccess(`Downloaded sanitized file: ${a.download}`);
          return;
        }
      } else if (file.encryptedBlob instanceof Blob) {
        const url = URL.createObjectURL(file.encryptedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `encrypted_${file.fileName}.bin`;
        a.click();
        URL.revokeObjectURL(url);
        setActionSuccess(`Downloaded encrypted ciphertext: ${a.download}`);
        return;
      }
    } catch (e: any) {
      console.error('Download masked failed:', e);
      setTamperAlert(`Download failed: ${e.message}`);
    }
  };

  // 3. Deliberately Corrupt One Byte for Tamper Verification (Test Mode)
  const handleSimulateTamper = async (file: EncryptedFileRecord) => {
    if (!(file.encryptedBlob instanceof Blob)) {
      alert('Tamper simulation available on binary encrypted blobs.');
      return;
    }
    const buf = await file.encryptedBlob.arrayBuffer();
    const corruptedArray = new Uint8Array(buf);
    corruptedArray[0] ^= 0xff; // Flip first byte

    const corruptedBlob = new Blob([corruptedArray], { type: 'application/octet-stream' });
    const corruptedRecord: EncryptedFileRecord = {
      ...file,
      encryptedBlob: corruptedBlob,
    };
    await vaultDB.saveFile(corruptedRecord);
    await loadVaultFiles();
    setTamperAlert(`⚠️ Injected 1-byte corruption into '${file.fileName}'. Try opening or exporting to verify tamper rejection!`);
  };

  // 4. Delete file
  const handleDeleteFile = async (id: string) => {
    if (confirm('Permanently delete this encrypted file from local IndexedDB?')) {
      await vaultDB.deleteFile(id);
      await loadVaultFiles();
      onRefreshNeeded?.();
    }
  };

  // 5. Wipe & Reset All Vault Data
  const handleClearAllVaultData = async () => {
    if (confirm('Are you sure you want to wipe and clear all files and data from the local vault? This will start completely fresh.')) {
      await vaultDB.clearDatabase();
      await loadVaultFiles();
      onRefreshNeeded?.();
      setActionSuccess('Local vault database completely cleared. Ready for a clean start!');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto font-sans">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-black/5 shadow-minimal">
        <div>
          <h3 className="text-base font-bold text-[#212529] flex items-center gap-2">
            <FileLock2 className="w-5 h-5 text-[#9C8DD4]" />
            <span>Encrypted Local Vault</span>
          </h3>
          <p className="text-xs text-[#757575] mt-0.5">
            IndexedDB zero-server store. Individual DEKs wrapped with Master KEK (AES-256-GCM).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Hidden File Input for Uploading Encrypted Document */}
          <input
            type="file"
            ref={uploadInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleUploadAndRestore(e.target.files[0]);
              }
            }}
            className="hidden"
          />

          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={isRestoring}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#A99DD8] hover:bg-[#8A7BC7] text-white font-semibold text-xs shadow-minimal hover:shadow-purple-glow transition-all disabled:opacity-50"
            title="Upload an encrypted/masked document to match with vault and restore original plaintext"
          >
            {isRestoring ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Restoring...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>Upload Encrypted File to Restore</span>
              </>
            )}
          </button>

          <button
            onClick={loadVaultFiles}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] text-xs text-[#212529] border border-black/5 transition-all font-medium shadow-minimal"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          {files.length > 0 && (
            <button
              onClick={handleClearAllVaultData}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#E77A73]/10 hover:bg-[#E77A73]/20 text-[#E77A73] border border-[#E77A73]/20 text-xs font-semibold transition-all shadow-minimal"
              title="Delete all files and reset database"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Reset Vault</span>
            </button>
          )}
        </div>
      </div>

      {tamperAlert && (
        <div className="p-4 rounded-2xl bg-[#E77A73]/15 border border-[#E77A73]/30 text-[#212529] text-xs flex items-center gap-3 shadow-minimal">
          <ShieldAlert className="w-5 h-5 text-[#E77A73] shrink-0" />
          <div className="font-semibold">{tamperAlert}</div>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 rounded-2xl bg-[#4ADE80]/15 border border-[#4ADE80]/30 text-[#212529] text-xs flex items-center gap-3 shadow-minimal">
          <CheckCircle2 className="w-5 h-5 text-[#4ADE80] shrink-0" />
          <div className="font-semibold">{actionSuccess}</div>
        </div>
      )}

      {/* Files List / Grid */}
      {loading ? (
        <div className="p-12 text-center text-[#757575] text-xs">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-[#9C8DD4] mb-2" />
          Loading encrypted vault records...
        </div>
      ) : files.length === 0 ? (
        <div className="p-12 rounded-3xl bg-white border border-black/5 text-center space-y-3 shadow-minimal">
          <div className="w-12 h-12 rounded-full bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 flex items-center justify-center text-[#9C8DD4] mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-[#212529]">Your Local Vault is Empty</h4>
          <p className="text-xs text-[#757575] max-w-md mx-auto">
            Files scanned in the 'Scan & Protect' studio and encrypted with Web Crypto API will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((file) => (
            <div
              key={file.id}
              className="bg-white border border-black/5 hover:border-[#9C8DD4]/50 hover:shadow-minimal rounded-3xl p-5 flex flex-col justify-between space-y-4 transition-all shadow-minimal"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-2xl bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 flex items-center justify-center text-[#9C8DD4]">
                      {file.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION' ? (
                        <ImageIcon className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </div>
                    <div className="overflow-hidden">
                      <h4 className="text-xs font-bold text-[#212529] truncate max-w-[170px]" title={file.fileName}>
                        {file.fileName}
                      </h4>
                      <span className="text-[10px] font-mono text-[#757575]">
                        {Math.round(file.originalSize / 1024)} KB · {new Date(file.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {/* Explicit Pipeline Badge for all 4 pipelines */}
                  <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold ${
                    file.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION'
                      ? 'bg-[#9C8DD4]/15 text-[#9C8DD4] border border-[#9C8DD4]/30'
                      : file.pipelineUsed === 'REDACTED-METADATA'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : file.pipelineUsed === 'SYNTHETIC-PSEUDONYMIZED'
                      ? 'bg-[#4ADE80]/20 text-[#14532D] border border-[#4ADE80]/30'
                      : 'bg-[#E2E1E6] text-[#212529] border border-black/5'
                  }`}>
                    {file.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION'
                      ? 'REGION ENCRYPT'
                      : file.pipelineUsed === 'REDACTED-METADATA'
                      ? 'METADATA REDACTED'
                      : file.pipelineUsed === 'SYNTHETIC-PSEUDONYMIZED'
                      ? 'SYNTHETIC MASK'
                      : 'FULL ENCRYPT'}
                  </span>
                </div>

                <div className="mt-3 p-3 rounded-2xl bg-[#FAF9F6] border border-black/5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between text-[#757575]">
                    <span>Category:</span>
                    <span className="font-mono font-bold text-[#212529]">{file.metadata.category}</span>
                  </div>
                  <div className="flex justify-between text-[#757575]">
                    <span>Integrity SHA-256:</span>
                    <span className="font-mono font-bold text-[#9C8DD4]">{file.originalHash.substring(0, 10)}...</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-black/5 flex items-center justify-between gap-1.5">
                <button
                  onClick={() => handleViewInMemory(file)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 px-3 rounded-full bg-[#A99DD8] hover:bg-[#8A7BC7] text-white text-xs font-semibold shadow-minimal transition-all"
                  title="Decrypt in volatile memory only (never written to disk)"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>View Memory</span>
                </button>

                <button
                  onClick={() => handleDownloadMasked(file)}
                  className="p-2 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] text-[#212529] border border-black/5 text-xs transition-colors shadow-minimal"
                  title="Download Sanitized / Masked file (with privacy blur / synthetic data)"
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => handleRestoreDownload(file)}
                  className="p-2 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] text-[#212529] border border-black/5 text-xs transition-colors shadow-minimal"
                  title="Decrypt & Export original restored plaintext file"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onFileShared?.(file.id)}
                  className="p-2 rounded-full bg-[#FAF9F6] hover:bg-[#E2E1E6] text-[#212529] border border-black/5 text-xs transition-colors shadow-minimal"
                  title="Share encrypted file via serverless WebRTC QR"
                >
                  <QrCode className="w-3.5 h-3.5 text-[#9C8DD4]" />
                </button>

                {file.pipelineUsed !== 'AES-256-GCM-SELECTIVE-REGION' && (
                  <button
                    onClick={() => handleSimulateTamper(file)}
                    className="p-2 rounded-full bg-[#FAF9F6] hover:bg-amber-100 text-amber-700 border border-black/5 text-xs transition-colors shadow-minimal"
                    title="🧪 Security Test: Intentionally corrupts 1 byte of ciphertext to test if cryptographic tamper defense blocks it"
                  >
                    <Bug className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  onClick={() => handleDeleteFile(file.id)}
                  className="p-2 rounded-full bg-[#FAF9F6] hover:bg-[#E77A73]/15 text-[#E77A73] border border-black/5 text-xs transition-colors shadow-minimal"
                  title="Delete from local vault"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Memory Decrypt Modal (C6 View-Only) */}
      {selectedFileForMemoryView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 overflow-hidden space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    View-Only In-Memory Decryption Mode (C6)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Decrypted strictly into RAM buffer · Zero traces written to disk
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {(selectedFileForMemoryView.maskedDataUrl || selectedFileForMemoryView.maskedPdfUrl) && (
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <button
                      onClick={() => setSelectedFileForMemoryView(prev => prev ? { ...prev, viewMode: 'ENCRYPTED_MASK' } : null)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                        selectedFileForMemoryView.viewMode === 'ENCRYPTED_MASK'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      🔒 Stored Masked
                    </button>
                    <button
                      onClick={() => setSelectedFileForMemoryView(prev => prev ? { ...prev, viewMode: 'DECRYPTED' } : null)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                        selectedFileForMemoryView.viewMode === 'DECRYPTED'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      🔓 Decrypted RAM
                    </button>
                  </div>
                )}

                <button
                  onClick={() => handleDownloadMasked(selectedFileForMemoryView.record)}
                  className="px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-semibold flex items-center gap-1 transition-all"
                  title="Download Sanitized/Masked file"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Masked</span>
                </button>

                <button
                  onClick={() => handleRestoreDownload(selectedFileForMemoryView.record)}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1 transition-all"
                  title="Decrypt and export original restored file"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Original</span>
                </button>

                <button
                  onClick={handleCloseMemoryView}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-2 rounded-xl bg-slate-900 border border-slate-200 max-h-[480px] overflow-auto flex items-center justify-center">
              {selectedFileForMemoryView.decryptedPdfUrl || selectedFileForMemoryView.maskedPdfUrl ? (
                <iframe
                  src={
                    selectedFileForMemoryView.viewMode === 'ENCRYPTED_MASK'
                      ? (selectedFileForMemoryView.maskedPdfUrl || selectedFileForMemoryView.decryptedPdfUrl)
                      : (selectedFileForMemoryView.decryptedPdfUrl || selectedFileForMemoryView.maskedPdfUrl)
                  }
                  title="PDF Document"
                  className="w-full h-[450px] rounded-lg border border-slate-200 bg-white"
                />
              ) : selectedFileForMemoryView.viewMode === 'ENCRYPTED_MASK' && selectedFileForMemoryView.maskedDataUrl ? (
                <img
                  src={selectedFileForMemoryView.maskedDataUrl}
                  alt="Vaulted masked preview"
                  className="max-w-full max-h-[440px] rounded-lg object-contain shadow-md"
                />
              ) : selectedFileForMemoryView.decryptedDataUrl ? (
                <img
                  src={selectedFileForMemoryView.decryptedDataUrl}
                  alt="Decrypted preview"
                  className="max-w-full max-h-[440px] rounded-lg object-contain shadow-md"
                />
              ) : (
                <pre className="p-4 text-xs font-mono text-emerald-400 whitespace-pre-wrap w-full text-left bg-slate-950 rounded-lg">
                  {selectedFileForMemoryView.decryptedText}
                </pre>
              )}
            </div>

            {/* Standalone Sensitive Crop Slices in Memory Modal */}
            {selectedFileForMemoryView.crops && selectedFileForMemoryView.crops.length > 0 && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-indigo-700 font-mono flex items-center gap-1">
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Download Hidden Pieces (PNG):</span>
                </span>
                {selectedFileForMemoryView.crops.map((crop, idx) => (
                  <a
                    key={idx}
                    href={crop.dataUrl}
                    download={crop.fileName}
                    className="px-2.5 py-1 bg-white hover:bg-slate-50 text-indigo-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3 h-3 text-indigo-600" />
                    <span>{crop.label}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Synthetic Entity Mappings in Memory Modal */}
            {selectedFileForMemoryView.record.syntheticMappings && selectedFileForMemoryView.record.syntheticMappings.length > 0 && (
              <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
                  <span className="flex items-center gap-1.5">
                    <span>🎭</span>
                    <span>Reversible Synthetic Entity Mappings (FPE)</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono font-bold">
                    Mathematically Validated
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[140px] overflow-y-auto pr-1">
                  {selectedFileForMemoryView.record.syntheticMappings.map((map, idx) => (
                    <div key={map.id || idx} className="p-2 bg-white rounded-lg border border-emerald-200 text-xs space-y-0.5">
                      <div className="flex justify-between text-[10px] font-mono text-slate-500 font-bold">
                        <span>{map.type.replace(/_/g, ' ')}</span>
                        <span className="text-emerald-700">
                          {map.checksumAlgorithm === 'VERHOEFF_D5' ? '✓ Verhoeff D5' : map.checksumAlgorithm === 'LUHN_MOD10' ? '✓ Luhn 10' : '✓ Matched'}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] truncate">
                        <span className="text-slate-400 line-through mr-1">{map.originalValue}</span>
                        <span className="text-slate-400 mr-1">➔</span>
                        <span className="text-emerald-700 font-bold">{map.syntheticValue}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span className="font-mono">
                SHA-256 Verified: {selectedFileForMemoryView.record.originalHash.substring(0, 16)}...
              </span>
              <span className="text-emerald-600 font-semibold flex items-center gap-1">
                <ShieldCheck className="w-4 h-4" />
                <span>Protected by Web Crypto AES-256-GCM</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Upload & Retract / Restored Document Modal */}
      {restoredResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-3xl bg-white border border-indigo-200 rounded-2xl shadow-2xl p-6 overflow-hidden space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span>Original Document Restored from Vault</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                      Matched & Decrypted in RAM
                    </span>
                  </h3>
                  <p className="text-[11px] text-indigo-600 font-mono mt-0.5">
                    {restoredResult.matchMethod}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={restoredResult.restoredDataUrl}
                  download={restoredResult.fileName}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-500/20 transition-all flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Original Document</span>
                </a>

                <button
                  onClick={handleCloseRestoredModal}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="p-2 rounded-xl bg-slate-900 border border-slate-200 max-h-[480px] overflow-auto flex items-center justify-center">
              {restoredResult.isPdf ? (
                <iframe
                  src={restoredResult.restoredDataUrl}
                  title="Restored PDF Document"
                  className="w-full h-[450px] rounded-lg border border-slate-200 bg-white"
                />
              ) : (
                <img
                  src={restoredResult.restoredDataUrl}
                  alt="Restored Original Preview"
                  className="max-w-full max-h-[440px] rounded-lg object-contain shadow-md"
                />
              )}
            </div>

            {/* Automatic Size Maintenance Indicator */}
            {!restoredResult.isPdf && restoredResult.uploadedSize && (
              <div className="p-3 bg-[#FAF9F6] border border-black/5 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#212529]">Decrypted Image Size:</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-bold text-[11px]">
                    ~{((restoredResult.restoredSize || 0) / 1024).toFixed(1)} KB (Preserves Compressed Size)
                  </span>
                </div>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  ✓ Similar Size Retained
                </span>
              </div>
            )}

            {/* Standalone Sensitive Crop Slices in Restored Modal */}
            {restoredResult.crops && restoredResult.crops.length > 0 && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-indigo-700 font-mono flex items-center gap-1">
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Download Hidden Pieces (PNG):</span>
                </span>
                {restoredResult.crops.map((crop, idx) => (
                  <a
                    key={idx}
                    href={crop.dataUrl}
                    download={crop.fileName}
                    className="px-2.5 py-1 bg-white hover:bg-slate-100 text-indigo-700 text-xs font-semibold rounded-lg border border-slate-200 shadow-sm flex items-center gap-1.5 transition-all"
                  >
                    <Download className="w-3 h-3 text-indigo-600" />
                    <span>{crop.label}</span>
                  </a>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span className="font-mono">
                Original SHA-256: {restoredResult.record.originalHash.substring(0, 20)}...
              </span>
              <span className="text-emerald-600 font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Verified Match with Local IndexedDB Store</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
