import QRCode from 'qrcode';
import { CryptoEngine } from '../crypto';
import { vaultDB } from '../storage/db';
import { EncryptedFileRecord, EncryptedRegionRecord, SyntheticEntityMapping, FileCategory } from '../../types';

export interface P2PHandshakePayload {
  version: number;
  type: 'OFFER' | 'ANSWER';
  sdp: string;
  publicKeyB64: string;
  fingerprint: string;
}

export interface P2PTransferMetadata {
  transferId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  originalSize: number;
  encryptedSize: number;
  isRegionEncrypted: boolean;
  wrappedDekForRecipient: string; // RSA-OAEP encrypted DEK
  iv: string;
  originalHash: string;
  encryptedHash: string;
  pipelineUsed: string;
  encryptedRegions?: EncryptedRegionRecord[];
  syntheticMappings?: SyntheticEntityMapping[];
  metadata?: {
    category: FileCategory;
    riskScore: number;
    detectedPiiCount: number;
    explanation: string;
  };
  totalChunks: number;
  chunkSize: number;
}

// Handshake JSON validation type guard
export function isValidHandshakePayload(value: unknown): value is P2PHandshakePayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    p.version === 1 &&
    (p.type === 'OFFER' || p.type === 'ANSWER') &&
    typeof p.sdp === 'string' &&
    typeof p.publicKeyB64 === 'string' &&
    typeof p.fingerprint === 'string' &&
    p.publicKeyB64.length > 0 &&
    p.fingerprint.length === 12
  );
}

// Helper to prune redundant candidates from SDP to make QR codes significantly lighter & easier to scan
export function pruneSdpForQr(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter(line => {
      // Remove dummy TCP candidates (e.g. port 9 tcptype passive/active) that bloat QR codes
      if (line.startsWith('a=candidate:') && (line.includes(' typ tcp ') || line.includes(' tcptype '))) {
        return false;
      }
      return true;
    })
    .join('\r\n');
}

export class P2PTransport {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private localKeyPair: CryptoKeyPair | null = null;
  private remotePublicKey: CryptoKey | null = null;

  private onStatusChange?: (status: string) => void;
  private onProgress?: (pct: number) => void;
  private onFileReceived?: (meta: P2PTransferMetadata, encryptedData: ArrayBuffer) => void;

  constructor(handlers?: {
    onStatusChange?: (status: string) => void;
    onProgress?: (pct: number) => void;
    onFileReceived?: (meta: P2PTransferMetadata, encryptedData: ArrayBuffer) => void;
  }) {
    if (handlers) {
      this.onStatusChange = handlers.onStatusChange;
      this.onProgress = handlers.onProgress;
      this.onFileReceived = handlers.onFileReceived;
    }
  }

  // 1. Sender Step: Initialize PeerConnection and produce Vanilla ICE Offer QR Code
  async createOffer(): Promise<{ qrDataUrl: string; payloadJson: string }> {
    this.onStatusChange?.('Generating local cryptographic keypair and SDP offer...');
    this.localKeyPair = await CryptoEngine.generateP2PKeyPair();
    const publicKeyB64 = await CryptoEngine.exportPublicKey(this.localKeyPair.publicKey);
    const fingerprint = (await CryptoEngine.computeSHA256(publicKeyB64)).substring(0, 12);

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // Create Data Channel
    this.dataChannel = this.pc.createDataChannel('aegis-secure-p2p', {
      ordered: true,
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for Vanilla ICE gathering to complete so all candidates are in one payload
    await this.waitForIceGatheringComplete(this.pc);

    const sdpClean = pruneSdpForQr(this.pc.localDescription!.sdp);

    const payload: P2PHandshakePayload = {
      version: 1,
      type: 'OFFER',
      sdp: sdpClean,
      publicKeyB64,
      fingerprint,
    };

    const payloadJson = JSON.stringify(payload);
    const qrDataUrl = await QRCode.toDataURL(payloadJson, {
      errorCorrectionLevel: 'L',
      margin: 2,
      scale: 6,
    });

    this.onStatusChange?.('Vanilla ICE Offer generated. Displaying QR code for recipient...');
    return { qrDataUrl, payloadJson };
  }

  // 2. Receiver Step: Process Sender's Offer QR and produce Answer QR Code
  async acceptOfferAndCreateAnswer(offerJson: string): Promise<{ qrDataUrl: string; payloadJson: string }> {
    this.onStatusChange?.('Validating sender offer and generating answer...');

    let parsed: unknown;
    try {
      parsed = JSON.parse(offerJson);
    } catch {
      throw new Error('Invalid handshake JSON format');
    }

    if (!isValidHandshakePayload(parsed) || parsed.type !== 'OFFER') {
      throw new Error('Invalid or malformed OFFER handshake payload');
    }

    const offerPayload: P2PHandshakePayload = parsed;

    // Verify Sender Public Key Fingerprint Integrity
    const calculatedFingerprint = (await CryptoEngine.computeSHA256(offerPayload.publicKeyB64)).substring(0, 12);
    if (calculatedFingerprint !== offerPayload.fingerprint) {
      throw new Error('Sender public-key fingerprint mismatch! Connection rejected.');
    }

    this.localKeyPair = await CryptoEngine.generateP2PKeyPair();
    const myPublicKeyB64 = await CryptoEngine.exportPublicKey(this.localKeyPair.publicKey);
    const fingerprint = (await CryptoEngine.computeSHA256(myPublicKeyB64)).substring(0, 12);

    // Import Sender's Public Key
    this.remotePublicKey = await CryptoEngine.importPublicKey(offerPayload.publicKeyB64);

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };

    await this.pc.setRemoteDescription({
      type: 'offer',
      sdp: offerPayload.sdp,
    });

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // Wait for Vanilla ICE gathering
    await this.waitForIceGatheringComplete(this.pc);

    const sdpClean = pruneSdpForQr(this.pc.localDescription!.sdp);

    const answerPayload: P2PHandshakePayload = {
      version: 1,
      type: 'ANSWER',
      sdp: sdpClean,
      publicKeyB64: myPublicKeyB64,
      fingerprint,
    };

    const payloadJson = JSON.stringify(answerPayload);
    const qrDataUrl = await QRCode.toDataURL(payloadJson, {
      errorCorrectionLevel: 'L',
      margin: 2,
      scale: 6,
    });

    this.onStatusChange?.('Answer created. Scan back with sender to open direct channel...');
    return { qrDataUrl, payloadJson };
  }

  // 3. Sender Step: Accept Receiver's Answer QR to finalize P2P DataChannel
  async acceptAnswer(answerJson: string): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection not initialized on sender');

    let parsed: unknown;
    try {
      parsed = JSON.parse(answerJson);
    } catch {
      throw new Error('Invalid handshake JSON format');
    }

    if (!isValidHandshakePayload(parsed) || parsed.type !== 'ANSWER') {
      throw new Error('Invalid or malformed ANSWER handshake payload');
    }

    const answerPayload: P2PHandshakePayload = parsed;

    // Verify Receiver Public Key Fingerprint Integrity
    const calculatedFingerprint = (await CryptoEngine.computeSHA256(answerPayload.publicKeyB64)).substring(0, 12);
    if (calculatedFingerprint !== answerPayload.fingerprint) {
      throw new Error('Receiver public-key fingerprint mismatch! Connection rejected.');
    }

    this.remotePublicKey = await CryptoEngine.importPublicKey(answerPayload.publicKeyB64);

    if (this.pc.signalingState === 'have-local-offer') {
      await this.pc.setRemoteDescription({
        type: 'answer',
        sdp: answerPayload.sdp,
      });
    } else if (this.pc.signalingState === 'stable') {
      console.log('PeerConnection is already in stable state, proceeding with active connection.');
    } else {
      throw new Error(`Cannot apply answer in signaling state "${this.pc.signalingState}". Please generate a fresh Offer & Answer.`);
    }

    this.onStatusChange?.('Handshake complete! Establishing direct browser-to-browser data channel...');
  }

  // 4. Send Encrypted File Direct to Peer with Recipient Key Wrapping (C4)
  async sendEncryptedFile(
    fileRecord: EncryptedFileRecord,
    rawDEK: CryptoKey | null,
    rawEncryptedBytes: ArrayBuffer
  ): Promise<void> {
    if (!this.dataChannel) {
      throw new Error('WebRTC DataChannel not initialized');
    }

    if (this.dataChannel.readyState !== 'open') {
      this.onStatusChange?.('Connecting P2P direct data channel with recipient...');
      await this.waitForDataChannelOpen();
    }

    let wrappedDekForRecipient = fileRecord.wrappedDek || '';
    if (rawDEK && this.remotePublicKey) {
      try {
        this.onStatusChange?.('Wrapping Data Encryption Key with recipient RSA-OAEP public key...');
        wrappedDekForRecipient = await CryptoEngine.wrapDEKForRecipient(rawDEK, this.remotePublicKey);
      } catch (e) {
        console.warn('Could not wrap DEK for recipient with RSA key, using record wrapped key:', e);
      }
    }

    const chunkSize = 16 * 1024; // 16KB chunks
    const totalChunks = Math.ceil(rawEncryptedBytes.byteLength / chunkSize);
    const transferId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tx_${Date.now()}`;
    const computedEncHash = await CryptoEngine.computeSHA256(rawEncryptedBytes);

    const meta: P2PTransferMetadata = {
      transferId,
      fileId: fileRecord.id,
      fileName: fileRecord.fileName,
      mimeType: fileRecord.originalMimeType,
      originalSize: fileRecord.originalSize,
      encryptedSize: rawEncryptedBytes.byteLength,
      isRegionEncrypted: fileRecord.isRegionEncrypted,
      wrappedDekForRecipient,
      iv: fileRecord.iv,
      originalHash: fileRecord.originalHash,
      encryptedHash: fileRecord.encryptedHash || computedEncHash,
      pipelineUsed: fileRecord.pipelineUsed,
      encryptedRegions: fileRecord.encryptedRegions,
      syntheticMappings: fileRecord.syntheticMappings,
      metadata: fileRecord.metadata,
      totalChunks,
      chunkSize,
    };

    this.onStatusChange?.(`Streaming ${fileRecord.fileName} (${(rawEncryptedBytes.byteLength / 1024).toFixed(1)} KB)...`);

    // Chunk the Metadata header into <= 16KB packets to strictly stay under RTCDataChannel message limit
    const headerStr = JSON.stringify(meta);
    const headerBytes = new TextEncoder().encode(headerStr);
    const headerChunkSize = 16 * 1024;
    const totalHeaderChunks = Math.ceil(headerBytes.byteLength / headerChunkSize);

    this.dataChannel.send(JSON.stringify({
      type: 'START_TRANSFER',
      totalHeaderChunks,
      fileName: fileRecord.fileName,
      mimeType: fileRecord.originalMimeType,
      fileSize: rawEncryptedBytes.byteLength
    }));

    for (let h = 0; h < totalHeaderChunks; h++) {
      const start = h * headerChunkSize;
      const end = Math.min(start + headerChunkSize, headerBytes.byteLength);
      const chunk = headerBytes.slice(start, end);
      const chunkB64 = CryptoEngine.bufferToBase64(chunk.buffer.slice(0) as ArrayBuffer);

      if (this.dataChannel.bufferedAmount > 64 * 1024) {
        await new Promise((r) => setTimeout(r, 10));
      }
      this.dataChannel.send(JSON.stringify({
        type: 'HEADER_CHUNK',
        index: h,
        data: chunkB64
      }));
    }

    this.dataChannel.send(JSON.stringify({ type: 'HEADER_COMPLETE' }));

    // Send payload chunk by chunk with flow control (16KB per chunk)
    let sent = 0;
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, rawEncryptedBytes.byteLength);
      const chunk = rawEncryptedBytes.slice(start, end);

      if (this.dataChannel.bufferedAmount > 64 * 1024) {
        await new Promise((r) => setTimeout(r, 10));
      }

      this.dataChannel.send(chunk);
      sent += chunk.byteLength;
      this.onProgress?.(Math.round((sent / rawEncryptedBytes.byteLength) * 100));
    }

    await new Promise((r) => setTimeout(r, 50));
    this.dataChannel.send(JSON.stringify({ type: 'TRANSFER_COMPLETE' }));
    this.onProgress?.(100);
    this.onStatusChange?.('Encrypted file transferred directly to peer with zero server contact.');

    await vaultDB.logEvent({
      eventType: 'SHARE_P2P',
      severity: 'SUCCESS',
      source: 'WEB_APP',
      fileId: fileRecord.id,
      fileName: fileRecord.fileName,
      actionTaken: 'Transferred encrypted file via serverless WebRTC QR channel',
      details: {
        recipientKeyFingerprint: this.remotePublicKey
          ? (await CryptoEngine.computeSHA256(await CryptoEngine.exportPublicKey(this.remotePublicKey))).substring(0, 12)
          : 'DIRECT_CIPHERTEXT',
        sizeBytes: rawEncryptedBytes.byteLength,
      },
    });
  }

  // Set up Data Channel Listeners
  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    let headerChunks: string[] = [];
    let incomingMeta: P2PTransferMetadata | null = null;
    let receivedChunks: ArrayBuffer[] = [];
    let receivedBytes = 0;
    const MAX_TRANSFER_SIZE = 100 * 1024 * 1024; // 100 MB Limit

    channel.onopen = () => {
      this.onStatusChange?.('🟢 Direct P2P DataChannel OPEN and ACTIVE.');
    };

    channel.onclose = () => {
      this.onStatusChange?.('P2P DataChannel closed.');
    };

    channel.onerror = (e) => {
      console.error('DataChannel error:', e);
      this.onStatusChange?.('P2P DataChannel error occurred.');
    };

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'START_TRANSFER') {
            headerChunks = [];
            incomingMeta = null;
            receivedChunks = [];
            receivedBytes = 0;
            this.onStatusChange?.(`Receiving metadata for: ${msg.fileName}...`);
          } else if (msg.type === 'HEADER_CHUNK') {
            headerChunks[msg.index] = msg.data;
          } else if (msg.type === 'HEADER_COMPLETE') {
            let totalLength = 0;
            const decodedParts = headerChunks.map((b64) => {
              const u8 = CryptoEngine.base64ToBuffer(b64);
              totalLength += u8.length;
              return u8;
            });
            const fullHeaderBuf = new Uint8Array(totalLength);
            let offset = 0;
            for (const p of decodedParts) {
              fullHeaderBuf.set(p, offset);
              offset += p.length;
            }
            const jsonText = new TextDecoder().decode(fullHeaderBuf);
            incomingMeta = JSON.parse(jsonText) as P2PTransferMetadata;
            this.onStatusChange?.(`Receiving incoming encrypted file: ${incomingMeta?.fileName}...`);
          } else if (msg.type === 'TRANSFER_HEADER') {
            incomingMeta = msg.meta as P2PTransferMetadata;
            receivedChunks = [];
            receivedBytes = 0;
            this.onStatusChange?.(`Receiving incoming encrypted file: ${incomingMeta?.fileName}...`);
          } else if (msg.type === 'TRANSFER_COMPLETE') {
            if (incomingMeta) {
              // Combine received chunks
              const totalBuffer = new Uint8Array(receivedBytes);
              let offset = 0;
              for (const chunk of receivedChunks) {
                totalBuffer.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
              }

              this.onStatusChange?.('File reception complete. Verifying SHA-256 checksum...');
              this.onFileReceived?.(incomingMeta, totalBuffer.buffer);
            }
          }
        } catch (e) {
          console.error('Error parsing transfer message:', e);
        }
      } else if (event.data instanceof ArrayBuffer) {
        receivedBytes += event.data.byteLength;

        if (receivedBytes > MAX_TRANSFER_SIZE) {
          channel.close();
          throw new Error('Incoming transfer exceeds maximum allowed size of 100MB');
        }

        receivedChunks.push(event.data);
        if (incomingMeta && incomingMeta.encryptedSize > 0) {
          this.onProgress?.(Math.min(100, Math.round((receivedBytes / incomingMeta.encryptedSize) * 100)));
        }
      }
    };
  }

  // Helper: Wait for Vanilla ICE Gathering to complete
  private waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      pc.addEventListener('icegatheringstatechange', checkState);

      // Safety timeout after 2 seconds
      setTimeout(() => {
        resolve();
      }, 2000);
    });
  }

  private waitForDataChannelOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        resolve();
        return;
      }
      if (!this.dataChannel) {
        reject(new Error('DataChannel not initialized'));
        return;
      }

      let timeout: any;
      const onOpen = () => {
        clearTimeout(timeout);
        this.onStatusChange?.('🟢 Direct P2P DataChannel OPEN and ACTIVE.');
        resolve();
      };

      const onError = (e: any) => {
        clearTimeout(timeout);
        reject(new Error('DataChannel connection failed: ' + (e?.message || 'error')));
      };

      timeout = setTimeout(() => {
        if (this.dataChannel?.readyState === 'open') {
          resolve();
        } else {
          reject(new Error('WebRTC DataChannel connection timed out. Please check that tokens were pasted accurately.'));
        }
      }, 10000);

      this.dataChannel.addEventListener('open', onOpen, { once: true });
      this.dataChannel.addEventListener('error', onError, { once: true });
    });
  }

  // Get local private key for unwrapping received files
  getLocalPrivateKey(): CryptoKey | null {
    return this.localKeyPair ? this.localKeyPair.privateKey : null;
  }

  close() {
    this.dataChannel?.close();
    this.pc?.close();
    this.pc = null;
    this.dataChannel = null;
  }
}
