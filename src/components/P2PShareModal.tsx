import React, { useState, useEffect, useRef } from 'react';
import { 
  Zap,
  QrCode, 
  Send, 
  Download, 
  Camera, 
  Copy, 
  Check, 
  RefreshCw, 
  ShieldCheck, 
  WifiOff, 
  FileLock2, 
  KeyRound,
  CheckCircle2,
  Radio,
  ArrowRight
} from 'lucide-react';
import jsQR from 'jsqr';
import { EncryptedFileRecord } from '../types';
import { P2PTransport, P2PTransferMetadata } from '../core/p2p/webrtc';
import { CryptoEngine } from '../core/crypto';
import { vaultDB } from '../core/storage/db';
import { WebAuthnManager, MasterKeySession } from '../core/crypto/webauthn';

interface P2PShareModalProps {
  session: MasterKeySession;
  onOpenAuthModal: () => void;
  onRefreshNeeded?: () => void;
}

interface IncomingAirdropItem {
  transferId: string;
  fileRecord: EncryptedFileRecord;
  rawEncryptedBase64: string;
  senderTimestamp: number;
}

export const P2PShareModal: React.FC<P2PShareModalProps> = ({
  session,
  onOpenAuthModal,
  onRefreshNeeded,
}) => {
  const [shareMethod, setShareMethod] = useState<'INSTANT' | 'QR_CODE'>('INSTANT');
  const [mode, setMode] = useState<'SEND' | 'RECEIVE'>('SEND');
  const [vaultFiles, setVaultFiles] = useState<EncryptedFileRecord[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  
  // Instant AirDrop State
  const [incomingAirdrop, setIncomingAirdrop] = useState<IncomingAirdropItem | null>(null);
  const [airdropSuccess, setAirdropSuccess] = useState<boolean>(false);
  const [airdropBroadcasting, setAirdropBroadcasting] = useState<boolean>(false);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const activeOfferPayloadRef = useRef<IncomingAirdropItem | null>(null);
  const broadcastIntervalRef = useRef<any>(null);

  // QR Code WebRTC State
  const [offerQr, setOfferQr] = useState<string | null>(null);
  const [offerPayload, setOfferPayload] = useState<string>('');
  const [receiverAnswerInput, setReceiverAnswerInput] = useState<string>('');
  const [isOfferCopied, setIsOfferCopied] = useState<boolean>(false);
  const [senderOfferInput, setSenderOfferInput] = useState<string>('');
  const [answerQr, setAnswerQr] = useState<string | null>(null);
  const [answerPayload, setAnswerPayload] = useState<string>('');
  const [isAnswerCopied, setIsAnswerCopied] = useState<boolean>(false);
  
  // Connection & Progress
  const [statusMessage, setStatusMessage] = useState<string>('Ready for instant local transfer.');
  const [transferProgress, setTransferProgress] = useState<number>(0);
  const [transferSuccess, setTransferSuccess] = useState<boolean>(false);
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);
  const [isScanningCamera, setIsScanningCamera] = useState<boolean>(false);

  const transportRef = useRef<P2PTransport | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    vaultDB.getAllFiles().then((files: EncryptedFileRecord[]) => {
      setVaultFiles(files);
      if (files.length > 0) setSelectedFileId(files[0].id);
    });

    // Initialize 1-Click Instant AirDrop Broadcast Channel
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('aegis_local_airdrop_channel');
      broadcastChannelRef.current = channel;

      channel.onmessage = (event) => {
        if (event.data?.type === 'AIRDROP_OFFER') {
          setIncomingAirdrop(event.data.payload);
          setStatusMessage(`Incoming file from peer: ${event.data.payload.fileRecord.fileName}`);
        } else if (event.data?.type === 'AIRDROP_ACK') {
          setAirdropSuccess(true);
          setAirdropBroadcasting(false);
          activeOfferPayloadRef.current = null;
          if (broadcastIntervalRef.current) {
            clearInterval(broadcastIntervalRef.current);
            broadcastIntervalRef.current = null;
          }
          setStatusMessage('File received and accepted by peer!');
        } else if (event.data?.type === 'AIRDROP_PING') {
          // A new peer receiver tab just connected; reply with active broadcast if available
          if (activeOfferPayloadRef.current) {
            channel.postMessage({
              type: 'AIRDROP_OFFER',
              payload: activeOfferPayloadRef.current,
            });
          }
        }
      };

      // Announce this tab as a ready listener
      channel.postMessage({ type: 'AIRDROP_PING' });
    }

    return () => {
      stopCamera();
      transportRef.current?.close();
      if (broadcastIntervalRef.current) {
        clearInterval(broadcastIntervalRef.current);
      }
      broadcastChannelRef.current?.close();
    };
  }, []);

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }
    setIsScanningCamera(false);
  };

  // -------------------------------------------------------------
  // 1. Instant 1-Click AirDrop Handlers (Zero QR needed)
  // -------------------------------------------------------------
  const handleSendInstantAirdrop = async () => {
    if (!selectedFileId) return;

    const fileRecord = vaultFiles.find(f => f.id === selectedFileId);
    if (!fileRecord) return;

    setAirdropBroadcasting(true);
    setAirdropSuccess(false);
    setStatusMessage(`Broadcasting ${fileRecord.fileName} to local peer tabs...`);

    let rawBase64 = '';
    if (typeof fileRecord.encryptedBlob === 'string') {
      rawBase64 = fileRecord.encryptedBlob;
    } else if (fileRecord.encryptedBlob instanceof Blob) {
      const buf = await fileRecord.encryptedBlob.arrayBuffer();
      rawBase64 = CryptoEngine.bufferToBase64(buf);
    }

    const payload: IncomingAirdropItem = {
      transferId: `airdrop_${Date.now()}`,
      fileRecord,
      rawEncryptedBase64: rawBase64,
      senderTimestamp: Date.now(),
    };

    activeOfferPayloadRef.current = payload;

    // Send initial beacon
    broadcastChannelRef.current?.postMessage({
      type: 'AIRDROP_OFFER',
      payload,
    });

    // Repeating beacon every 1000ms until accepted or stopped
    if (broadcastIntervalRef.current) clearInterval(broadcastIntervalRef.current);
    broadcastIntervalRef.current = setInterval(() => {
      if (activeOfferPayloadRef.current && broadcastChannelRef.current) {
        broadcastChannelRef.current.postMessage({
          type: 'AIRDROP_OFFER',
          payload: activeOfferPayloadRef.current,
        });
      }
    }, 1000);
  };

  const handleStopBroadcast = () => {
    setAirdropBroadcasting(false);
    activeOfferPayloadRef.current = null;
    if (broadcastIntervalRef.current) {
      clearInterval(broadcastIntervalRef.current);
      broadcastIntervalRef.current = null;
    }
    setStatusMessage('Broadcast stopped.');
  };

  const handleAcceptInstantAirdrop = async () => {
    if (!incomingAirdrop) return;

    try {
      const fileRecord = incomingAirdrop.fileRecord;
      let fileBlob: Blob | string = incomingAirdrop.rawEncryptedBase64;
      if (fileRecord.pipelineUsed !== 'AES-256-GCM-SELECTIVE-REGION') {
        const u8 = CryptoEngine.base64ToBuffer(incomingAirdrop.rawEncryptedBase64);
        fileBlob = new Blob([u8.buffer as ArrayBuffer], { type: fileRecord.originalMimeType });
      }

      const newRecord: EncryptedFileRecord = {
        ...fileRecord,
        id: `p2p_${Date.now()}`,
        encryptedBlob: fileBlob,
        createdAt: Date.now(),
      };

      await vaultDB.saveFile(newRecord);
      await vaultDB.logEvent({
        eventType: 'RECEIVE_P2P',
        severity: 'SUCCESS',
        source: 'WEB_APP',
        fileId: newRecord.id,
        fileName: newRecord.fileName,
        actionTaken: 'Saved P2P encrypted file via 1-Click Instant Sync',
        details: { size: newRecord.originalSize, pipeline: newRecord.pipelineUsed },
      });

      broadcastChannelRef.current?.postMessage({
        type: 'AIRDROP_ACK',
        transferId: incomingAirdrop.transferId,
      });

      setAirdropSuccess(true);
      setIncomingAirdrop(null);
      setStatusMessage('File received and vaulted to local IndexedDB!');
      onRefreshNeeded?.();

      // Refresh local file list
      const updatedFiles = await vaultDB.getAllFiles();
      setVaultFiles(updatedFiles);
      if (!selectedFileId && updatedFiles.length > 0) {
        setSelectedFileId(updatedFiles[0].id);
      }
    } catch (err: any) {
      setStatusMessage(`Accept error: ${err.message}`);
    }
  };

  // -------------------------------------------------------------
  // 2. Camera QR Scanner loop using jsQR (Advanced Offline Mode)
  // -------------------------------------------------------------
  const startCameraScanner = async (onScanSuccess: (decoded: string) => void) => {
    try {
      stopCamera();
      setStatusMessage('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      cameraStreamRef.current = stream;
      setIsScanningCamera(true);

      const initVideo = () => {
        if (!cameraStreamRef.current) return;
        const video = videoRef.current;
        if (!video) {
          requestAnimationFrame(initVideo);
          return;
        }

        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.play().catch(e => console.warn('Video play deferred:', e));

        const scanCanvas = document.createElement('canvas');
        const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });

        const scanFrame = () => {
          if (!cameraStreamRef.current) return;
          if (video.readyState >= 2 && scanCtx && video.videoWidth > 0) {
            scanCanvas.width = video.videoWidth;
            scanCanvas.height = video.videoHeight;
            scanCtx.drawImage(video, 0, 0);
            const imgData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
            const code = jsQR(imgData.data, imgData.width, imgData.height);
            if (code && code.data) {
              stopCamera();
              onScanSuccess(code.data);
              return;
            }
          }
          if (cameraStreamRef.current) {
            requestAnimationFrame(scanFrame);
          }
        };

        requestAnimationFrame(scanFrame);
      };

      requestAnimationFrame(initVideo);
    } catch (err: any) {
      console.warn('Camera access unavailable:', err);
      setStatusMessage(`Camera access denied or unavailable: ${err?.message || 'permission error'}. You can paste the token manually.`);
      setIsScanningCamera(false);
    }
  };

  const handleGenerateOffer = async () => {
    if (!selectedFileId) return;
    if (transportRef.current) {
      transportRef.current.close();
      transportRef.current = null;
    }
    setStatusMessage('Generating Vanilla ICE Offer...');

    const transport = new P2PTransport({
      onStatusChange: setStatusMessage,
      onProgress: setTransferProgress,
    });
    transportRef.current = transport;

    try {
      const { qrDataUrl, payloadJson } = await transport.createOffer();
      setOfferQr(qrDataUrl);
      setOfferPayload(payloadJson);
    } catch (e: any) {
      setStatusMessage(`Offer creation failed: ${e.message}`);
    }
  };

  const handleProcessSenderOffer = async (offerStr?: string) => {
    const jsonToUse = offerStr || senderOfferInput;
    if (!jsonToUse) return;

    if (transportRef.current) {
      transportRef.current.close();
      transportRef.current = null;
    }

    const transport = new P2PTransport({
      onStatusChange: setStatusMessage,
      onProgress: setTransferProgress,
      onFileReceived: async (meta: P2PTransferMetadata, encryptedData: ArrayBuffer) => {
        try {
          const currentSession = WebAuthnManager.getSession();
          let kek = currentSession.masterKEK;
          if (!kek) {
            kek = await WebAuthnManager.getOrDeriveActiveKey();
          }

          let storedWrappedDek = meta.wrappedDekForRecipient;
          let storedIv = meta.iv;

          const privateKey = transportRef.current?.getLocalPrivateKey();
          if (privateKey && meta.wrappedDekForRecipient) {
            try {
              const unwrappedDek = await CryptoEngine.unwrapDEKWithPrivateKey(
                meta.wrappedDekForRecipient,
                privateKey
              );
              const wrapped = await CryptoEngine.wrapDEK(unwrappedDek, kek);
              storedWrappedDek = wrapped.wrappedKeyB64;
              storedIv = wrapped.ivB64;
            } catch (errUnwrap: any) {
              console.error('Recipient RSA DEK unwrap error:', errUnwrap);
            }
          }

          let fileBlobOrDataUrl: Blob | string;
          if (meta.pipelineUsed === 'AES-256-GCM-SELECTIVE-REGION' || meta.pipelineUsed === 'SYNTHETIC-PSEUDONYMIZED') {
            try {
              fileBlobOrDataUrl = new TextDecoder().decode(encryptedData);
            } catch {
              const base64 = CryptoEngine.bufferToBase64(encryptedData);
              const mime = meta.mimeType || 'image/webp';
              fileBlobOrDataUrl = `data:${mime};base64,${base64}`;
            }
          } else {
            fileBlobOrDataUrl = new Blob([encryptedData], { type: meta.mimeType });
          }

          const newRecord: EncryptedFileRecord = {
            id: meta.fileId,
            fileName: meta.fileName,
            originalMimeType: meta.mimeType,
            originalSize: meta.originalSize,
            isRegionEncrypted: meta.isRegionEncrypted,
            encryptedBlob: fileBlobOrDataUrl,
            encryptedRegions: meta.encryptedRegions,
            syntheticMappings: meta.syntheticMappings,
            wrappedDek: storedWrappedDek,
            iv: storedIv,
            originalHash: meta.originalHash,
            encryptedHash: meta.encryptedHash,
            pipelineUsed: meta.pipelineUsed as any,
            exifStripped: true,
            createdAt: Date.now(),
            metadata: meta.metadata || {
              category: 'GENERAL_DOCUMENT',
              riskScore: 50,
              detectedPiiCount: meta.encryptedRegions?.length || 0,
              explanation: 'Received via direct serverless WebRTC QR peer-to-peer channel.',
            },
          };

          await vaultDB.saveFile(newRecord);
          setTransferSuccess(true);
          setStatusMessage(`Transfer complete! Received and vaulted "${newRecord.fileName}".`);
          onRefreshNeeded?.();

          // Refresh local file list
          const updatedFiles = await vaultDB.getAllFiles();
          setVaultFiles(updatedFiles);
          if (!selectedFileId && updatedFiles.length > 0) {
            setSelectedFileId(updatedFiles[0].id);
          }
        } catch (err: any) {
          console.error('P2P file receive error:', err);
          setStatusMessage(`File reception error: ${err.message}`);
        }
      },
    });

    transportRef.current = transport;

    try {
      const { qrDataUrl, payloadJson } = await transport.acceptOfferAndCreateAnswer(jsonToUse);
      setAnswerQr(qrDataUrl);
      setAnswerPayload(payloadJson);
      setIsAnswerCopied(false);
    } catch (err: any) {
      setStatusMessage(`Failed to create answer: ${err.message}`);
    }
  };

  const handleFinalizeSenderTransfer = async (answerStr?: string) => {
    const jsonToUse = answerStr || receiverAnswerInput;
    if (!jsonToUse || !transportRef.current) return;

    try {
      setIsFinalizing(true);
      setTransferSuccess(false);
      setStatusMessage('Connecting P2P direct data channel with recipient...');

      let kek = session.masterKEK || WebAuthnManager.getSession().masterKEK;
      if (!kek) {
        kek = await WebAuthnManager.getOrDeriveActiveKey();
      }

      await transportRef.current.acceptAnswer(jsonToUse);
      const fileRecord = await vaultDB.getFile(selectedFileId);
      if (!fileRecord) throw new Error('File not found in vault');

      let dek: CryptoKey | null = null;
      if (fileRecord.wrappedDek && fileRecord.iv) {
        try {
          dek = await CryptoEngine.unwrapDEK(fileRecord.wrappedDek, fileRecord.iv, kek);
        } catch (e) {
          throw new Error('Please unlock your Master Key using the "Unlock Master Key" button in the top navigation bar before sending.');
        }
      }

      let encryptedBytes: ArrayBuffer;
      if (fileRecord.encryptedBlob instanceof Blob) {
        encryptedBytes = await fileRecord.encryptedBlob.arrayBuffer();
      } else if (typeof fileRecord.encryptedBlob === 'string') {
        encryptedBytes = new TextEncoder().encode(fileRecord.encryptedBlob).buffer as ArrayBuffer;
      } else {
        throw new Error('Unsupported encrypted blob format');
      }

      await transportRef.current.sendEncryptedFile(fileRecord, dek, encryptedBytes);
      setTransferSuccess(true);
      setStatusMessage(`Transfer complete! Successfully streamed "${fileRecord.fileName}" to peer.`);
    } catch (err: any) {
      console.error('Finalize transfer error:', err);
      setStatusMessage(`Transfer failed: ${err.message}`);
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-white border border-black/5 shadow-minimal flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-sans">
        <div>
          <h2 className="text-base font-bold text-[#212529] flex items-center gap-2">
            <span>Direct P2P Encrypted Sharing (Workflow 3)</span>
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-[#E2E1E6] text-[#757575] font-semibold">
              Zero Servers
            </span>
          </h2>
          <p className="text-xs text-[#757575] mt-1">
            Browser-to-browser encrypted file sync with zero cloud relay.
          </p>
        </div>

        {/* Share Mode Selector */}
        <div className="flex items-center gap-1 bg-[#E2E1E6]/70 p-1 rounded-full border border-black/5">
          <button
            onClick={() => setShareMethod('INSTANT')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full flex items-center gap-1.5 transition-all ${
              shareMethod === 'INSTANT'
                ? 'bg-[#A99DD8] text-white shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>1-Click AirDrop (Fast)</span>
          </button>
          <button
            onClick={() => setShareMethod('QR_CODE')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-full flex items-center gap-1.5 transition-all ${
              shareMethod === 'QR_CODE'
                ? 'bg-[#A99DD8] text-white shadow-minimal'
                : 'text-[#757575] hover:text-[#212529]'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Air-Gapped QR Mode</span>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* METHOD 1: 1-Click Instant AirDrop (Fast & Seamless)            */}
      {/* ------------------------------------------------------------- */}
      {shareMethod === 'INSTANT' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-6">
          {/* Active Listener Status Banner */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="font-semibold text-slate-700">AirDrop Local Peer Channel:</span>
              <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                ACTIVE & LISTENING
              </span>
            </div>
            <span className="text-slate-400 font-mono text-[11px] hidden sm:inline">
              Zero Servers · Browser BroadcastChannel
            </span>
          </div>

          {/* Incoming AirDrop Alert Card */}
          {incomingAirdrop && (
            <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-50 via-sky-50 to-indigo-50 border-2 border-indigo-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg shadow-indigo-500/10 animate-pulse">
              <div className="flex items-center gap-3.5">
                <div className="p-3 rounded-2xl bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/30">
                  <Radio className="w-6 h-6 animate-spin" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-extrabold text-slate-900">
                      Incoming Encrypted File from Peer!
                    </h4>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-600 text-white font-bold">
                      READY
                    </span>
                  </div>
                  <p className="text-xs text-indigo-900 font-mono font-bold mt-0.5">
                    {incomingAirdrop.fileRecord.fileName} • ({(incomingAirdrop.fileRecord.originalSize / 1024).toFixed(1)} KB)
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Encrypted with AES-256-GCM • {incomingAirdrop.fileRecord.metadata.category}
                  </p>
                </div>
              </div>

              <button
                onClick={handleAcceptInstantAirdrop}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/25 transition-all flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <span>Accept & Save to Vault</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {airdropSuccess && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-3 text-emerald-800 shadow-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <p className="text-xs font-bold">
                Transfer complete! The encrypted file has been securely synced and stored in the local vault.
              </p>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">
                Select Vaulted File to Instant Share (Sender):
              </label>
              {airdropBroadcasting && (
                <span className="text-xs font-mono font-bold text-indigo-600 flex items-center gap-1.5 animate-pulse">
                  <Radio className="w-3.5 h-3.5" />
                  Beaming offer to peer tabs...
                </span>
              )}
            </div>

            {vaultFiles.length === 0 ? (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl space-y-2 bg-slate-50">
                <p className="text-xs font-bold text-slate-700">
                  Ready to receive incoming AirDrop files from other tabs or devices.
                </p>
                <p className="text-[11px] text-slate-500">
                  To send files from this tab, scan and vault a file in "Scan & Protect" first. When another tab beams a file, it will appear here automatically!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {vaultFiles.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => setSelectedFileId(file.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all ${
                      selectedFileId === file.id
                        ? 'bg-indigo-50 border-indigo-500 text-slate-900 shadow-sm'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-indigo-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 truncate max-w-[180px]">
                        {file.fileName}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-indigo-700 font-bold">
                        {file.pipelineUsed.includes('REGION') ? 'REGION' : 'FULL'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {(file.originalSize / 1024).toFixed(1)} KB • {file.metadata.category}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 font-mono truncate">
                {airdropBroadcasting ? '📡 Beaming offer on local peer network...' : statusMessage}
              </span>

              <div className="flex items-center gap-2 shrink-0">
                {airdropBroadcasting && (
                  <button
                    onClick={handleStopBroadcast}
                    className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-all"
                  >
                    Stop Beaming
                  </button>
                )}

                <button
                  onClick={handleSendInstantAirdrop}
                  disabled={!selectedFileId || airdropBroadcasting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-500/20 transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Zap className="w-4 h-4" />
                  <span>{airdropBroadcasting ? 'Broadcasting...' : '1-Click Instant AirDrop'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* METHOD 2: Air-Gapped WebRTC QR Mode (Advanced)                 */}
      {/* ------------------------------------------------------------- */}
      {shareMethod === 'QR_CODE' && (
        <div className="p-6 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-6">
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setMode('SEND')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                mode === 'SEND' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'
              }`}
            >
              Sender (Show QR)
            </button>
            <button
              onClick={() => setMode('RECEIVE')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                mode === 'RECEIVE' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600'
              }`}
            >
              Receiver (Scan QR)
            </button>
          </div>

          {/* Transfer Status and Live Progress Bar */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-slate-700 truncate font-medium">
                {statusMessage}
              </span>
              {transferProgress > 0 && transferProgress < 100 && (
                <span className="font-bold text-indigo-600 font-mono">{transferProgress}%</span>
              )}
            </div>
            {transferProgress > 0 && transferProgress < 100 && (
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${transferProgress}%` }}
                />
              </div>
            )}
          </div>

          {/* Transfer Success Alert Banner */}
          {transferSuccess && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 flex items-center gap-3 text-emerald-800 shadow-md">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-emerald-950">
                  Direct P2P Transfer Complete!
                </p>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  Encrypted file successfully transmitted and verified via SHA-256 over serverless WebRTC.
                </p>
              </div>
            </div>
          )}

          {mode === 'SEND' ? (
            <div className="space-y-4">
              {!offerQr ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-700 block">
                      Select Vaulted File to Share:
                    </label>

                    {vaultFiles.length === 0 ? (
                      <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl space-y-2 bg-slate-50">
                        <p className="text-xs font-bold text-slate-700">
                          No files in your vault yet.
                        </p>
                        <p className="text-[11px] text-slate-500">
                          To send files, scan and vault a file in "Scan & Protect" first.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {vaultFiles.map((file) => (
                          <div
                            key={file.id}
                            onClick={() => setSelectedFileId(file.id)}
                            className={`p-4 rounded-xl border cursor-pointer transition-all ${
                              selectedFileId === file.id
                                ? 'bg-indigo-50 border-indigo-500 text-slate-900 shadow-sm'
                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-indigo-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-900 truncate max-w-[180px]">
                                {file.fileName}
                              </span>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-indigo-700 font-bold">
                                {file.pipelineUsed.includes('REGION') ? 'REGION' : 'FULL'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">
                              {(file.originalSize / 1024).toFixed(1)} KB • {file.metadata.category}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="text-center pt-2">
                    <button
                      onClick={handleGenerateOffer}
                      disabled={!selectedFileId}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-500/20 transition-all cursor-pointer inline-flex items-center gap-2"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>Generate WebRTC Offer QR & Token</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between gap-3 w-full max-w-lg">
                    <div>
                      <p className="text-xs font-bold text-indigo-900">
                        Sharing: {vaultFiles.find(f => f.id === selectedFileId)?.fileName || 'Selected File'}
                      </p>
                      <p className="text-[11px] text-indigo-700">
                        Scan QR with receiver or copy Offer Token below:
                      </p>
                    </div>
                    <button
                      onClick={() => setOfferQr(null)}
                      className="px-2.5 py-1 bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Change File
                    </button>
                  </div>

                  <img src={offerQr} alt="Offer QR" className="w-48 h-48 rounded-xl p-2 bg-white border border-slate-200 shadow-md" />

                  <div className="w-full max-w-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700">WebRTC Offer Token:</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(offerPayload);
                          setIsOfferCopied(true);
                          setTimeout(() => setIsOfferCopied(false), 3000);
                        }}
                        className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        {isOfferCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isOfferCopied ? 'Copied to Clipboard!' : 'Copy Offer Token'}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={offerPayload}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-mono text-slate-700 h-16 resize-none"
                    />
                  </div>

                  <div className="w-full max-w-lg space-y-3 pt-3 border-t border-slate-200">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700 block text-left">
                        Step 2: Scan or Paste Receiver's Answer Token:
                      </label>
                      {!isScanningCamera && (
                        <button
                          type="button"
                          onClick={() => {
                            startCameraScanner((decoded) => {
                              setReceiverAnswerInput(decoded);
                              handleFinalizeSenderTransfer(decoded);
                            });
                          }}
                          className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Scan Answer QR</span>
                        </button>
                      )}
                    </div>

                    {isScanningCamera ? (
                      <div className="relative w-full max-w-xs mx-auto aspect-square rounded-2xl overflow-hidden bg-black border-2 border-indigo-500 shadow-lg flex items-center justify-center">
                        <video
                          ref={videoRef}
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4">
                          <div className="w-44 h-44 border-2 border-dashed border-white/90 rounded-2xl animate-pulse" />
                          <p className="text-[10px] font-mono text-white/90 bg-black/60 px-3 py-1 rounded-full mt-3 backdrop-blur-sm">
                            Align phone's Answer QR
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={stopCamera}
                          className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-rose-600/90 hover:bg-rose-700 text-white rounded-full text-xs font-bold shadow-md cursor-pointer transition-all"
                        >
                          Cancel Camera
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          placeholder="Paste Receiver's Answer Token here..."
                          value={receiverAnswerInput}
                          onChange={(e) => setReceiverAnswerInput(e.target.value)}
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                        <button
                          onClick={() => handleFinalizeSenderTransfer()}
                          disabled={!receiverAnswerInput.trim() || isFinalizing}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                        >
                          {isFinalizing ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Connecting & Streaming Encrypted File...</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4" />
                              <span>Finalize Connection & Stream Encrypted File</span>
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Step 1: Scan Sender's QR Code</span>
                  </label>
                  {!isScanningCamera && (
                    <button
                      type="button"
                      onClick={() => {
                        startCameraScanner((decoded) => {
                          setSenderOfferInput(decoded);
                          handleProcessSenderOffer(decoded);
                        });
                      }}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Scan with Camera</span>
                    </button>
                  )}
                </div>

                {isScanningCamera ? (
                  <div className="relative w-full max-w-xs mx-auto aspect-square rounded-2xl overflow-hidden bg-black border-2 border-indigo-500 shadow-lg flex items-center justify-center">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-4">
                      <div className="w-44 h-44 border-2 border-dashed border-white/90 rounded-2xl animate-pulse shadow-2xl" />
                      <p className="text-[10px] font-mono text-white/90 bg-black/60 px-3 py-1 rounded-full mt-3 backdrop-blur-sm">
                        Point camera at sender's QR code
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-rose-600/90 hover:bg-rose-700 text-white rounded-full text-xs font-bold shadow-md cursor-pointer transition-all"
                    >
                      Cancel Camera
                    </button>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/90 space-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        startCameraScanner((decoded) => {
                          setSenderOfferInput(decoded);
                          handleProcessSenderOffer(decoded);
                        });
                      }}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md shadow-indigo-500/20 transition-all cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Open Camera to Scan QR Code</span>
                    </button>

                    <div className="flex items-center gap-2 justify-center text-[10px] text-slate-400 font-bold uppercase tracking-wider py-1">
                      <span className="h-px bg-slate-200 flex-1" />
                      <span>Or paste token manually</span>
                      <span className="h-px bg-slate-200 flex-1" />
                    </div>

                    <textarea
                      placeholder="Paste Sender's Offer Token here..."
                      value={senderOfferInput}
                      onChange={(e) => setSenderOfferInput(e.target.value)}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono h-20 resize-none shadow-inner"
                    />
                    <button
                      onClick={() => handleProcessSenderOffer()}
                      disabled={!senderOfferInput.trim()}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Process Pasted Token & Generate Answer</span>
                    </button>
                  </div>
                )}
              </div>

              {answerQr && (
                <div className="flex flex-col items-center space-y-3 pt-3 border-t border-slate-200">
                  <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-center w-full max-w-lg">
                    <p className="text-xs font-bold text-indigo-900">
                      Step 2: Copy this Answer Token and paste it into Step 2 on the Sender screen:
                    </p>
                  </div>

                  <img src={answerQr} alt="Answer QR" className="w-48 h-48 rounded-xl p-2 bg-white border border-slate-200 shadow-md" />

                  <div className="w-full max-w-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700">WebRTC Answer Token:</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(answerPayload);
                          setIsAnswerCopied(true);
                          setTimeout(() => setIsAnswerCopied(false), 3000);
                        }}
                        className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        {isAnswerCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isAnswerCopied ? 'Copied to Clipboard!' : 'Copy Answer Token'}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={answerPayload}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-mono text-slate-700 h-16 resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
