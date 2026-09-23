import React, { useState, useRef, useEffect } from 'react';
import { 
  UploadCloud, 
  Scan, 
  ShieldCheck, 
  ShieldAlert, 
  Eye, 
  EyeOff, 
  Lock, 
  Sparkles, 
  FileText, 
  MapPin, 
  Cpu, 
  CheckCircle, 
  RefreshCw, 
  ChevronRight,
  HelpCircle,
  FileCode,
  CreditCard,
  UserCheck,
  AlertCircle,
  X,
  Trash2,
  Download,
  Scissors,
  Brain,
  Zap,
  Bot,
  Activity
} from 'lucide-react';
import { 
  DetectionResult, 
  AgentDecision, 
  AgentAction, 
  BoundingBox, 
  DetectedItem,
  EncryptedFileRecord,
  EncryptedRegionRecord,
  SyntheticEntityMapping,
  PiiType,
  LocalAiHardwareInfo,
  LocalAiModelStatus,
  ContextualPiiEntity
} from '../types';
import { MasterDetector } from '../core/detection';
import { RegexDetector } from '../core/detection/regex';
import { PdfProcessor } from '../core/detection/pdf';
import { AgentLayer } from '../core/agents';
import { LocalOrchestrator } from '../core/orchestrator';
import { LocalAiEngine } from '../core/ai/webEngine';
import { CryptoEngine } from '../core/crypto';
import { ExifInspector } from '../core/detection/exif';
import { vaultDB } from '../core/storage/db';
import { WebAuthnManager, MasterKeySession } from '../core/crypto/webauthn';
import { SyntheticEngine } from '../core/fpe';

interface ScanStudioProps {
  session: MasterKeySession;
  onOpenAuthModal: () => void;
  onFileEncrypted: () => void;
}

interface SensitiveCropItem {
  label: string;
  downloadUrl: string;
  fileName: string;
}

export const ScanStudio: React.FC<ScanStudioProps> = ({
  session,
  onOpenAuthModal,
  onFileEncrypted,
}) => {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isEncrypting, setIsEncrypting] = useState<boolean>(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [decision, setDecision] = useState<AgentDecision | null>(null);
  const [selectedAction, setSelectedAction] = useState<AgentAction | null>(null);
  const [previewMode, setPreviewMode] = useState<'ORIGINAL' | 'BLURRED_REGIONS' | 'ENCRYPTED_MASK' | 'SYNTHETIC_DATA'>('BLURRED_REGIONS');
  const [syntheticMappings, setSyntheticMappings] = useState<SyntheticEntityMapping[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [encryptionSuccess, setEncryptionSuccess] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);
  const [lastEncryptedFile, setLastEncryptedFile] = useState<{
    downloadUrl: string;
    fileName: string;
    objectUrlToRevoke?: string;
    crops?: SensitiveCropItem[];
  } | null>(null);
  const [customActionOverridden, setCustomActionOverridden] = useState<boolean>(false);
  const [aiModelProgress, setAiModelProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // WebGPU & In-Browser AI Engine state
  const [aiHardwareInfo, setAiHardwareInfo] = useState<LocalAiHardwareInfo | null>(null);
  const [aiModelStatus, setAiModelStatus] = useState<LocalAiModelStatus>(LocalAiEngine.getStatus());
  const [isAiScanning, setIsAiScanning] = useState<boolean>(false);
  const [deepAiRan, setDeepAiRan] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState<number>(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [dragMode, setDragMode] = useState<'DRAW_NEW' | 'MOVE' | 'RESIZE_TL' | 'RESIZE_TR' | 'RESIZE_BL' | 'RESIZE_BR' | null>(null);
  const [dragAnchor, setDragAnchor] = useState<{ startX: number; startY: number; origBox: BoundingBox } | null>(null);
  const [canvasCursor, setCanvasCursor] = useState<string>('crosshair');

  // Detect WebGPU hardware acceleration capabilities on mount
  useEffect(() => {
    LocalAiEngine.getHardwareInfo().then((info) => {
      setAiHardwareInfo(info);
    });
  }, []);

  // Handle page switching for multi-page documents (PDFs)
  const handlePageChange = (newIndex: number) => {
    if (!detection?.pages || newIndex < 0 || newIndex >= detection.pages.length) return;
    setCurrentPageIndex(newIndex);
    setPreviewImageUrl(detection.pages[newIndex].pageImageDataUrl);
    setSelectedItemId(null);
  };

  // Render visual bounding boxes, handles & blur previews
  const redrawCanvas = () => {
    if (!previewImageUrl || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      if (!detection) return;
      const targetPageNum = currentPageIndex + 1;
      const itemsToRender = detection.detectedItems.filter(
        i => !!i.boundingBox && (!i.pageNumber || !detection.pages || detection.pages.length <= 1 || i.pageNumber === targetPageNum)
      );

      if (previewMode === 'SYNTHETIC_DATA') {
        // Render 100% format-preserving synthetic data overlay
        SyntheticEngine.renderSyntheticCanvasOverlay(canvas, itemsToRender, syntheticMappings, selectedItemId);
      } else if (previewMode === 'BLURRED_REGIONS' || previewMode === 'ENCRYPTED_MASK') {
        // Render aesthetic cyber-lock blurred/pixelated masks on detected regions
        itemsToRender.forEach((item) => {
          const box = item.boundingBox!;
          const bx = box.x <= 1 ? Math.floor(box.x * canvas.width) : Math.floor(box.x);
          const by = box.y <= 1 ? Math.floor(box.y * canvas.height) : Math.floor(box.y);
          const bw = Math.max(20, box.width <= 1 ? Math.ceil(box.width * canvas.width) : Math.ceil(box.width));
          const bh = Math.max(15, box.height <= 1 ? Math.ceil(box.height * canvas.height) : Math.ceil(box.height));

          // Pixelate effect
          const blockSize = Math.max(6, Math.floor(Math.min(bw, bh) / 8));
          for (let y = by; y < by + bh; y += blockSize) {
            for (let x = bx; x < bx + bw; x += blockSize) {
              const curW = Math.min(blockSize, bx + bw - x);
              const curH = Math.min(blockSize, by + bh - y);
              ctx.fillStyle = (Math.floor(x / blockSize) + Math.floor(y / blockSize)) % 2 === 0
                ? 'rgba(15, 23, 42, 0.92)'
                : 'rgba(30, 41, 59, 0.88)';
              ctx.fillRect(x, y, curW, curH);
            }
          }

          // Border
          const isSelected = item.id === selectedItemId;
          ctx.strokeStyle = isSelected ? '#4f46e5' : '#6366f1';
          ctx.lineWidth = isSelected ? 3 : Math.max(2, Math.floor(canvas.width / 400));
          ctx.strokeRect(bx, by, bw, bh);

          // Region Tag
          const fontSize = Math.max(11, Math.min(14, Math.floor(canvas.width / 50)));
          ctx.font = `bold ${fontSize}px "Fira Code", monospace`;
          ctx.fillStyle = isSelected ? '#3730a3' : '#4f46e5';
          ctx.fillText(`🔒 ${item.type}`, bx + 4, Math.max(by + fontSize + 2, fontSize + 4));

          // Draw Interactive Corner Handles if Selected
          if (isSelected) {
            const handleSize = 10;
            const halfH = handleSize / 2;
            const corners = [
              [bx, by],                   // TL
              [bx + bw, by],              // TR
              [bx, by + bh],              // BL
              [bx + bw, by + bh],         // BR
            ];

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 2;
            corners.forEach(([hx, hy]) => {
              ctx.fillRect(hx - halfH, hy - halfH, handleSize, handleSize);
              ctx.strokeRect(hx - halfH, hy - halfH, handleSize, handleSize);
            });
          }
        });
      } else {
        // Original mode: show thin colored bounding boxes
        itemsToRender.forEach((item) => {
          const box = item.boundingBox!;
          const bx = box.x <= 1 ? Math.floor(box.x * canvas.width) : Math.floor(box.x);
          const by = box.y <= 1 ? Math.floor(box.y * canvas.height) : Math.floor(box.y);
          const bw = Math.max(20, box.width <= 1 ? Math.ceil(box.width * canvas.width) : Math.ceil(box.width));
          const bh = Math.max(15, box.height <= 1 ? Math.ceil(box.height * canvas.height) : Math.ceil(box.height));

          const isSelected = item.id === selectedItemId;
          ctx.strokeStyle = isSelected ? '#22d3ee' : item.type === 'FACE' ? '#8b5cf6' : '#06b6d4';
          ctx.lineWidth = isSelected ? 3 : Math.max(2, Math.floor(canvas.width / 450));
          ctx.strokeRect(bx, by, bw, bh);

          const fontSize = Math.max(10, Math.min(13, Math.floor(canvas.width / 55)));
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.fillStyle = item.type === 'FACE' ? '#c084fc' : '#38bdf8';
          ctx.fillText(`[${item.label}]`, bx + 4, Math.max(by - 4, fontSize + 2));

          if (isSelected) {
            const handleSize = 10;
            const halfH = handleSize / 2;
            const corners = [
              [bx, by],
              [bx + bw, by],
              [bx, by + bh],
              [bx + bw, by + bh],
            ];
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#0891b2';
            ctx.lineWidth = 2;
            corners.forEach(([hx, hy]) => {
              ctx.fillRect(hx - halfH, hy - halfH, handleSize, handleSize);
              ctx.strokeRect(hx - halfH, hy - halfH, handleSize, handleSize);
            });
          }
        });
      }
    };
    img.src = previewImageUrl;
  };

  useEffect(() => {
    redrawCanvas();
  }, [previewImageUrl, detection, previewMode, selectedItemId, syntheticMappings, currentPageIndex]);

  // Convert client mouse event to canvas coordinate space
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  // Hit-test for corner resize handles
  const hitTestHandles = (coords: { x: number; y: number }, box: BoundingBox) => {
    const tol = 14;
    const { x, y, width: w, height: h } = box;
    if (Math.abs(coords.x - x) <= tol && Math.abs(coords.y - y) <= tol) return 'RESIZE_TL';
    if (Math.abs(coords.x - (x + w)) <= tol && Math.abs(coords.y - y) <= tol) return 'RESIZE_TR';
    if (Math.abs(coords.x - x) <= tol && Math.abs(coords.y - (y + h)) <= tol) return 'RESIZE_BL';
    if (Math.abs(coords.x - (x + w)) <= tol && Math.abs(coords.y - (y + h)) <= tol) return 'RESIZE_BR';
    return null;
  };

  // Hit-test for interior of box
  const hitTestBox = (coords: { x: number; y: number }, box: BoundingBox) => {
    return coords.x >= box.x && coords.x <= box.x + box.width &&
           coords.y >= box.y && coords.y <= box.y + box.height;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!detection) return;
    const coords = getCanvasCoords(e);

    // 1. Check if clicking on resize handles of selected item
    if (selectedItemId) {
      const selectedItem = detection.detectedItems.find(i => i.id === selectedItemId && i.boundingBox);
      if (selectedItem?.boundingBox) {
        const handleMode = hitTestHandles(coords, selectedItem.boundingBox);
        if (handleMode) {
          setDragMode(handleMode);
          setDragAnchor({ startX: coords.x, startY: coords.y, origBox: { ...selectedItem.boundingBox } });
          return;
        }
      }
    }

    // 2. Check if clicking inside any detected box to select & move
    for (let i = detection.detectedItems.length - 1; i >= 0; i--) {
      const item = detection.detectedItems[i];
      if (item.boundingBox && hitTestBox(coords, item.boundingBox)) {
        setSelectedItemId(item.id);
        const handleMode = hitTestHandles(coords, item.boundingBox);
        if (handleMode) {
          setDragMode(handleMode);
        } else {
          setDragMode('MOVE');
        }
        setDragAnchor({ startX: coords.x, startY: coords.y, origBox: { ...item.boundingBox } });
        return;
      }
    }

    // 3. Otherwise start drawing a new custom box
    setSelectedItemId(null);
    setDragMode('DRAW_NEW');
    setDragAnchor({ startX: coords.x, startY: coords.y, origBox: { x: coords.x, y: coords.y, width: 0, height: 0, label: 'Custom' } });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const coords = getCanvasCoords(e);

    // Update cursor when hovering
    if (!dragMode && detection) {
      let cursor = 'crosshair';
      if (selectedItemId) {
        const sel = detection.detectedItems.find(i => i.id === selectedItemId && i.boundingBox);
        if (sel?.boundingBox) {
          const handle = hitTestHandles(coords, sel.boundingBox);
          if (handle === 'RESIZE_TL' || handle === 'RESIZE_BR') cursor = 'nwse-resize';
          else if (handle === 'RESIZE_TR' || handle === 'RESIZE_BL') cursor = 'nesw-resize';
          else if (hitTestBox(coords, sel.boundingBox)) cursor = 'move';
        }
      }
      if (cursor === 'crosshair') {
        const hit = detection.detectedItems.some(i => i.boundingBox && hitTestBox(coords, i.boundingBox));
        if (hit) cursor = 'pointer';
      }
      setCanvasCursor(cursor);
      return;
    }

    if (!dragMode || !dragAnchor || !detection || !selectedItemId && dragMode !== 'DRAW_NEW') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dx = coords.x - dragAnchor.startX;
    const dy = coords.y - dragAnchor.startY;
    const orig = dragAnchor.origBox;

    if (dragMode === 'DRAW_NEW') {
      redrawCanvas();
      const minX = Math.min(dragAnchor.startX, coords.x);
      const minY = Math.min(dragAnchor.startY, coords.y);
      const w = Math.abs(coords.x - dragAnchor.startX);
      const h = Math.abs(coords.y - dragAnchor.startY);

      ctx.fillStyle = 'rgba(6, 182, 212, 0.25)';
      ctx.fillRect(minX, minY, w, h);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(minX, minY, w, h);
      ctx.setLineDash([]);
      return;
    }

    // Live update box position or size
    setDetection(prev => {
      if (!prev) return null;
      return {
        ...prev,
        detectedItems: prev.detectedItems.map(item => {
          if (item.id !== selectedItemId || !item.boundingBox) return item;
          let newBox = { ...item.boundingBox };

          if (dragMode === 'MOVE') {
            newBox.x = Math.max(0, Math.min(canvas.width - orig.width, orig.x + dx));
            newBox.y = Math.max(0, Math.min(canvas.height - orig.height, orig.y + dy));
          } else if (dragMode === 'RESIZE_BR') {
            newBox.width = Math.max(20, orig.width + dx);
            newBox.height = Math.max(15, orig.height + dy);
          } else if (dragMode === 'RESIZE_TL') {
            const newX = Math.min(orig.x + orig.width - 20, Math.max(0, orig.x + dx));
            const newY = Math.min(orig.y + orig.height - 15, Math.max(0, orig.y + dy));
            newBox.width = orig.width + (orig.x - newX);
            newBox.height = orig.height + (orig.y - newY);
            newBox.x = newX;
            newBox.y = newY;
          } else if (dragMode === 'RESIZE_TR') {
            const newY = Math.min(orig.y + orig.height - 15, Math.max(0, orig.y + dy));
            newBox.width = Math.max(20, orig.width + dx);
            newBox.height = orig.height + (orig.y - newY);
            newBox.y = newY;
          } else if (dragMode === 'RESIZE_BL') {
            const newX = Math.min(orig.x + orig.width - 20, Math.max(0, orig.x + dx));
            newBox.width = orig.width + (orig.x - newX);
            newBox.height = Math.max(15, orig.height + dy);
            newBox.x = newX;
          }

          return { ...item, boundingBox: newBox };
        })
      };
    });
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragMode || !dragAnchor) return;
    const coords = getCanvasCoords(e);

    if (dragMode === 'DRAW_NEW') {
      const minX = Math.min(dragAnchor.startX, coords.x);
      const minY = Math.min(dragAnchor.startY, coords.y);
      const width = Math.abs(coords.x - dragAnchor.startX);
      const height = Math.abs(coords.y - dragAnchor.startY);

      if (width > 15 && height > 15) {
        const newItemId = `custom_region_${Date.now()}`;
        const newItem: DetectedItem = {
          id: newItemId,
          type: 'CUSTOM',
          label: 'Custom Redacted Area',
          value: 'MANUAL_USER_SELECTION',
          confidence: 1.0,
          complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
          recommendation: 'Manual custom user privacy redaction.',
          pageNumber: currentPageIndex + 1,
          boundingBox: {
            x: minX,
            y: minY,
            width,
            height,
            label: 'Custom Redacted Area',
            isNormalized: false,
          },
        };

        setDetection((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            detectedItems: [...prev.detectedItems, newItem],
            isSensitive: true,
          };
        });

        setSelectedItemId(newItemId);
      }
    }

    setDragMode(null);
    setDragAnchor(null);
  };

  // Quick 1-click scale adjustment (+15% or -15% padding)
  const handleScaleRegion = (itemId: string, factor: number) => {
    setDetection(prev => {
      if (!prev) return null;
      return {
        ...prev,
        detectedItems: prev.detectedItems.map(item => {
          if (item.id !== itemId || !item.boundingBox) return item;
          const box = item.boundingBox;
          const dw = Math.round(box.width * factor);
          const dh = Math.round(box.height * factor);
          const newW = Math.max(20, box.width + dw);
          const newH = Math.max(15, box.height + dh);
          const newX = Math.max(0, box.x - Math.round(dw / 2));
          const newY = Math.max(0, box.y - Math.round(dh / 2));
          return {
            ...item,
            boundingBox: { ...box, x: newX, y: newY, width: newW, height: newH }
          };
        })
      };
    });
  };

  // Quick 1-click helper for Indian ID Demographic & QR regions
  const handleAddIdRegions = (regionType: 'DEMOGRAPHIC' | 'QR_CODE') => {
    if (!detection || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const w = canvas.width;
    const h = canvas.height;

    let newItem: DetectedItem;
    if (regionType === 'DEMOGRAPHIC') {
      newItem = {
        id: `demographic_${Date.now()}`,
        type: 'CUSTOM',
        label: 'Demographic Details (Name/DOB)',
        value: 'NAME_DOB_ADDRESS',
        confidence: 0.98,
        complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
        recommendation: 'Redacted demographic identity block.',
        boundingBox: {
          x: Math.round(w * 0.32),
          y: Math.round(h * 0.22),
          width: Math.round(w * 0.45),
          height: Math.round(h * 0.35),
          label: 'Demographic Details',
          isNormalized: false,
        },
      };
    } else {
      newItem = {
        id: `qr_matrix_${Date.now()}`,
        type: 'CUSTOM',
        label: 'Aadhaar QR Matrix',
        value: 'BIOMETRIC_QR_BLOCK',
        confidence: 0.99,
        complianceTags: ['DPDP_INDIA', 'IDENTITY_THEFT_PREVENTION'],
        recommendation: 'Digitally signed QR code matrix containing demographic details.',
        boundingBox: {
          x: Math.round(w * 0.72),
          y: Math.round(h * 0.62),
          width: Math.round(w * 0.24),
          height: Math.round(h * 0.32),
          label: 'QR Matrix',
          isNormalized: false,
        },
      };
    }

    setDetection((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        detectedItems: [...prev.detectedItems, newItem],
        isSensitive: true,
      };
    });
  };

  // Delete a specific flagged region
  const handleDeleteRegion = (itemId: string) => {
    setDetection((prev) => {
      if (!prev) return null;
      const updated = prev.detectedItems.filter((item) => item.id !== itemId);
      return {
        ...prev,
        detectedItems: updated,
        isSensitive: updated.length > 0,
      };
    });
  };

  // Clear all flagged regions
  const handleClearAllRegions = () => {
    setDetection((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        detectedItems: [],
        isSensitive: false,
      };
    });
    setSelectedItemId(null);
  };

  // Update item entity type (e.g. from CUSTOM to AADHAAR or PAN)
  const handleUpdateItemType = (itemId: string, newType: PiiType) => {
    let newLabel = newType.replace(/_/g, ' ');
    if (newType === 'AADHAAR') newLabel = 'Aadhaar UID Number';
    else if (newType === 'PAN_CARD') newLabel = 'Income Tax PAN Card';
    else if (newType === 'FACE') newLabel = 'Biometric Face Photo';
    else if (newType === 'DOB') newLabel = 'Date of Birth (DOB)';
    else if (newType === 'EMAIL') newLabel = 'Email Address';
    else if (newType === 'PHONE') newLabel = 'Phone Number';
    else if (newType === 'CREDIT_CARD') newLabel = 'Credit Card Number';
    else if (newType === 'API_KEY') newLabel = 'Secret Token / Key';
    else if (newType === 'MEDICAL_CONDITION') newLabel = 'Medical Diagnosis / PHI';
    else if (newType === 'TRADE_SECRET') newLabel = 'Proprietary Trade Secret';
    else if (newType === 'ORGANIZATION') newLabel = 'Corporate Entity / Institution';
    else if (newType === 'LEGAL_CLAUSE') newLabel = 'Confidential Legal Clause';
    else if (newType === 'CUSTOM') newLabel = 'Name / Custom Field';

    setDetection(prev => {
      if (!prev) return null;
      return {
        ...prev,
        detectedItems: prev.detectedItems.map(item => {
          if (item.id !== itemId) return item;
          return {
            ...item,
            type: newType,
            label: newLabel,
          };
        })
      };
    });

    setSyntheticMappings(prev => {
      return prev.map(m => {
        if (m.id !== itemId) return m;
        const tempItem: DetectedItem = {
          id: itemId,
          type: newType,
          label: newLabel,
          value: m.originalValue,
          confidence: 1,
          complianceTags: [],
          recommendation: ''
        };
        return SyntheticEngine.generateEntityMapping(tempItem);
      });
    });
  };

  // User input for custom synthetic/mock value
  const handleUpdateSyntheticValue = (itemId: string, customValue: string) => {
    setSyntheticMappings(prev => {
      return prev.map(m => {
        if (m.id !== itemId) return m;
        let checksumValid = true;
        let alg = m.checksumAlgorithm;
        if (m.type === 'AADHAAR') {
          checksumValid = SyntheticEngine.validateAadhaarVerhoeff(customValue);
          alg = 'VERHOEFF_D5';
        } else if (m.type === 'CREDIT_CARD') {
          checksumValid = SyntheticEngine.validateCreditCardLuhn(customValue);
          alg = 'LUHN_MOD10';
        } else if (m.type === 'DOB') {
          checksumValid = RegexDetector.validateDOB(customValue);
          alg = 'FORMAT_REGEX';
        }
        return {
          ...m,
          syntheticValue: customValue,
          checksumValidated: checksumValid,
          checksumAlgorithm: alg,
        };
      });
    });
  };

  // Generate a random valid mock value for this item
  const handleRegenerateSyntheticValue = (itemId: string) => {
    const item = detection?.detectedItems.find(i => i.id === itemId);
    if (!item) return;
    const newMapping = SyntheticEngine.generateEntityMapping(item);
    setSyntheticMappings(prev => {
      const exists = prev.some(m => m.id === itemId);
      if (exists) {
        return prev.map(m => m.id === itemId ? newMapping : m);
      } else {
        return [...prev, newMapping];
      }
    });
  };

  // Synchronize synthetic entity mappings whenever detection results change (preserving user edits)
  useEffect(() => {
    if (detection?.detectedItems && detection.detectedItems.length > 0) {
      setSyntheticMappings(prev => {
        return detection.detectedItems.map(item => {
          const existing = prev.find(p => p.id === item.id);
          if (existing && existing.type === item.type && existing.syntheticValue) {
            return {
              ...existing,
              label: item.label,
              originalValue: item.value || existing.originalValue,
            };
          }
          return SyntheticEngine.generateEntityMapping(item, detection.fileHash);
        });
      });
    } else {
      setSyntheticMappings([]);
    }
  }, [detection?.detectedItems, detection?.fileHash]);

  // Handle incoming file scan
  const handleProcessFile = async (file: File) => {
    if (isScanning || isEncrypting) return;

    setIsScanning(true);
    setError(null);
    setEncryptionSuccess(false);
    setSuccessMessage(null);
    setLastEncryptedFile(null);
    setCustomActionOverridden(false);
    setDeepAiRan(false);
    setCurrentFile(file);
    setCurrentPageIndex(0);

    try {
      // 1. Run Deterministic Multi-Modal Detection (Face, OCR, Regex, EXIF, Hash)
      const detectResult = await MasterDetector.scanFile(file);
      setDetection(detectResult);

      // Generate Format-Preserving Synthetic Mappings
      const synMaps = SyntheticEngine.generateAllMappings(detectResult.detectedItems, detectResult.fileHash);
      setSyntheticMappings(synMaps);

      if (detectResult.previewDataUrl) {
        setPreviewImageUrl(detectResult.previewDataUrl);
      } else if (file.type.startsWith('image/')) {
        const objectUrl = URL.createObjectURL(file);
        setPreviewImageUrl(objectUrl);
      } else {
        // Generate high-res visual document page preview for text documents
        const docPreviewUrl = MasterDetector.generateDocumentPagePreview(
          file.name,
          detectResult.extractedText,
          detectResult.detectedItems
        );
        setPreviewImageUrl(docPreviewUrl);
      }

      // 2. Run Local Hybrid Orchestration Layer (Deterministic Rules + On-Device Model)
      const agentDecision = await LocalOrchestrator.orchestrate(detectResult, {
        onProgress: (status) => setAiModelProgress(status),
      });
      setDecision(agentDecision);
      setSelectedAction(agentDecision.action);
    } catch (err) {
      console.error('File scan error:', err);
      setError(err instanceof Error ? err.message : 'File scan encountered an error.');
    } finally {
      setIsScanning(false);
      setAiModelProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Trigger Deep In-Browser Context AI Scan (Contextual NER & Zero-Shot SLM)
  const handleRunDeepAiScan = async () => {
    if (!detection || isAiScanning || isScanning) return;
    setIsAiScanning(true);
    setError(null);

    try {
      // Gather all text from document
      let fullText = detection.extractedText || '';
      if (detection.pages && detection.pages.length > 0) {
        const pageTexts = detection.pages.map((p) => p.extractedText || '').filter(Boolean).join('\n');
        if (pageTexts) fullText += '\n' + pageTexts;
      }

      if (!fullText.trim()) {
        fullText = detection.fileName.replace(/[_-]/g, ' ');
      }

      // Execute on-device contextual entity extraction via WebGPU / WASM pipeline
      const contextualEntities = await LocalAiEngine.extractContextualEntities(
        fullText,
        (status) => setAiModelStatus(status)
      );

      if (contextualEntities.length > 0) {
        const newDetectedItems = LocalAiEngine.convertToDetectedItems(
          contextualEntities,
          currentPageIndex + 1
        );

        // Merge without duplicate values
        const existingValues = new Set(detection.detectedItems.map((i) => (i.value || '').toLowerCase()));
        const uniqueNewItems = newDetectedItems.filter(
          (item) => !existingValues.has((item.value || '').toLowerCase())
        );

        if (uniqueNewItems.length > 0) {
          const mergedItems = [...detection.detectedItems, ...uniqueNewItems];

          const updatedDetection: DetectionResult = {
            ...detection,
            detectedItems: mergedItems,
            isSensitive: mergedItems.length > 0,
          };

          // Recalculate hybrid orchestrator decision with new contextual entities
          const updatedDecision = await LocalOrchestrator.orchestrate(updatedDetection, {
            onProgress: (status) => setAiModelProgress(status),
          });

          setDetection(updatedDetection);
          setDecision(updatedDecision);
          setSelectedAction(updatedDecision.action);

          // Update synthetic mappings
          const updatedMappings = SyntheticEngine.generateAllMappings(mergedItems, updatedDetection.fileHash);
          setSyntheticMappings(updatedMappings);
        }
      }

      setDeepAiRan(true);
    } catch (err: any) {
      console.error('Deep AI scan error:', err);
      setError(err?.message || 'Deep Context AI scan encountered an error.');
    } finally {
      setIsAiScanning(false);
    }
  };

  // Handle User Override (G1, G2, Task 5)
  const handleOverrideAction = async (newAction: AgentAction) => {
    let justification: string | undefined = undefined;

    if (
      decision &&
      decision.riskScore >= 60 &&
      (decision.action === 'WARN' || decision.action.startsWith('ENCRYPT') || decision.action === 'REDACT_METADATA') &&
      newAction === 'NO_ACTION'
    ) {
      const reason = window.prompt(
        `⚠️ High-Risk Override (Risk Score: ${decision.riskScore}/100)\nYou are overriding the recommended protection (${decision.action}) to NO_ACTION (Plaintext).\nPlease enter a justification / business reason for this override:`,
        'Authorized internal testing / Public non-confidential sample'
      );
      if (reason === null) {
        // User cancelled prompt, do not override
        return;
      }
      justification = reason.trim() || 'User override without specified note';
    }

    setSelectedAction(newAction);
    setCustomActionOverridden(true);

    if (decision && decision.action !== newAction) {
      await vaultDB.recordOverride({
        fileCategory: decision.fileCategory,
        recommendedAction: decision.action,
        chosenAction: newAction,
        filePiiSummary: detection?.detectedItems.map(i => i.type) || [],
        justification,
        riskScore: decision.riskScore,
        fileName: detection?.fileName,
      });

      await vaultDB.logEvent({
        eventType: 'OVERRIDE',
        severity: decision.riskScore >= 60 && newAction === 'NO_ACTION' ? 'WARNING' : 'INFO',
        source: 'WEB_APP',
        fileId: detection?.fileId,
        fileName: detection?.fileName,
        actionTaken: `User manually changed action from ${decision.action} to ${newAction}${justification ? ` (Reason: "${justification}")` : ''}`,
        details: {
          originalAction: decision.action,
          newAction,
          fileCategory: decision.fileCategory,
          justification,
        },
        riskScore: decision.riskScore,
      });
    }
  };

  // Finalize & Execute Cryptographic Pipeline
  const handleExecuteEncryption = async () => {
    if (!detection || !currentFile || !selectedAction) return;

    const currentSession = WebAuthnManager.getSession();
    if (!currentSession.unlocked || !currentSession.masterKEK) {
      onOpenAuthModal();
      return;
    }

    setIsEncrypting(true);
    setError(null);

    try {
      const kek = currentSession.masterKEK;

      switch (selectedAction) {
        case 'NO_ACTION': {
          setEncryptionSuccess(true);
          setSuccessMessage('No cryptographic action needed. Document approved for plaintext use.');
          await vaultDB.logEvent({
            eventType: 'OVERRIDE',
            severity: 'INFO',
            source: 'WEB_APP',
            fileId: detection.fileId,
            fileName: detection.fileName,
            actionTaken: 'User approved plaintext storage (NO_ACTION)',
            details: { category: decision?.fileCategory, riskScore: decision?.riskScore ?? 0 },
            riskScore: decision?.riskScore ?? 0,
          });
          onFileEncrypted();
          return;
        }

        case 'WARN': {
          setEncryptionSuccess(true);
          setSuccessMessage('Warning acknowledged. File reviewed and permitted.');
          onFileEncrypted();
          return;
        }

        case 'SYNTHETIC_REPLACE': {
          // Format-Preserving Pseudonymization Pipeline (100% Client-Side)
          const isOriginalPdf = currentFile.name.toLowerCase().endsWith('.pdf') || currentFile.type === 'application/pdf';
          const isOriginalImage = currentFile.type.startsWith('image/') || currentFile.name.match(/\.(png|jpe?g|webp|svg|bmp)$/i);
          const baseName = detection.fileName.replace(/\.[^/.]+$/, '');

          let syntheticBlob: Blob;
          let syntheticDataUrl: string;

          if (isOriginalImage || isOriginalPdf) {
            // Render on offscreen canvas
            const synCanvas = document.createElement('canvas');
            const synCtx = synCanvas.getContext('2d');
            if (!synCtx) throw new Error('Canvas context initialization failed');

            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                synCanvas.width = img.naturalWidth;
                synCanvas.height = img.naturalHeight;
                synCtx.drawImage(img, 0, 0);
                resolve();
              };
              img.onerror = () => reject(new Error('Failed to load image for synthetic transformation'));
              img.src = detection.previewDataUrl || (currentFile.type.startsWith('image/') ? URL.createObjectURL(currentFile) : (previewImageUrl || ''));
            });

            // Overlay synthetic replacements on the canvas
            SyntheticEngine.renderSyntheticCanvasOverlay(
              synCanvas,
              detection.detectedItems.filter(i => !!i.boundingBox && (!i.pageNumber || !detection.pages || detection.pages.length <= 1 || i.pageNumber === 1)),
              syntheticMappings
            );

            syntheticDataUrl = synCanvas.toDataURL('image/png');
            if (isOriginalPdf && detection.pages && detection.pages.length > 1) {
              const maskedPages: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
              for (const page of detection.pages) {
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = page.pageDimensions.width;
                pageCanvas.height = page.pageDimensions.height;
                const pageCtx = pageCanvas.getContext('2d');
                if (!pageCtx) continue;

                const pageImg = new Image();
                await new Promise<void>((resolve, reject) => {
                  pageImg.onload = () => resolve();
                  pageImg.onerror = () => reject(new Error(`Failed to load page ${page.pageNumber}`));
                  pageImg.src = page.pageImageDataUrl;
                });

                pageCtx.drawImage(pageImg, 0, 0);
                const pageItems = detection.detectedItems.filter(i => !!i.boundingBox && i.pageNumber === page.pageNumber);
                SyntheticEngine.renderSyntheticCanvasOverlay(pageCanvas, pageItems, syntheticMappings);
                maskedPages.push({ canvas: pageCanvas, width: pageCanvas.width, height: pageCanvas.height });
              }
              syntheticBlob = PdfProcessor.exportMultiPagePdf(maskedPages);
              syntheticDataUrl = maskedPages[0].canvas.toDataURL('image/png');
            } else if (isOriginalPdf) {
              syntheticBlob = PdfProcessor.canvasToPdfBlob(syntheticDataUrl, synCanvas.width, synCanvas.height);
            } else {
              const u8 = CryptoEngine.base64ToBuffer(syntheticDataUrl.split(',')[1]);
              syntheticBlob = new Blob([u8.buffer as ArrayBuffer], { type: 'image/png' });
            }
          } else {
            // Text / Source Code File
            const synText = SyntheticEngine.pseudonymizeText(detection.extractedText || '', syntheticMappings);
            syntheticBlob = new Blob([synText], { type: currentFile.type || 'text/plain' });
            syntheticDataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(synText)}`;
          }

          // Generate DEK & Vault the synthetic record
          const dek = await CryptoEngine.generateDEK();
          const { wrappedKeyB64, ivB64: wrapIvB64 } = await CryptoEngine.wrapDEK(dek, kek);
          const encHash = await CryptoEngine.computeSHA256(syntheticBlob);

          const record: EncryptedFileRecord = {
            id: detection.fileId,
            fileName: detection.fileName,
            originalMimeType: isOriginalPdf ? 'application/pdf' : (currentFile.type || (isOriginalImage ? 'image/png' : 'text/plain')),
            originalSize: syntheticBlob.size,
            isRegionEncrypted: false,
            originalHash: detection.fileHash,
            encryptedHash: encHash,
            wrappedDek: wrappedKeyB64,
            iv: wrapIvB64,
            pipelineUsed: 'SYNTHETIC-PSEUDONYMIZED',
            exifStripped: true,
            encryptedBlob: isOriginalPdf ? syntheticBlob : syntheticDataUrl,
            syntheticMappings,
            pdfPages: isOriginalPdf && detection.pages ? detection.pages.map(p => ({
              pageNumber: p.pageNumber,
              pageImageDataUrl: p.pageImageDataUrl,
              width: p.pageDimensions.width,
              height: p.pageDimensions.height,
            })) : undefined,
            metadata: {
              category: decision?.fileCategory || 'GENERAL_DOCUMENT',
              riskScore: decision?.riskScore ?? 0,
              detectedPiiCount: detection.detectedItems.length,
              explanation: decision?.explanation || 'Format-preserving synthetic data substitution applied.',
              totalPages: isOriginalPdf && detection.pages ? detection.pages.length : undefined,
            },
            createdAt: Date.now(),
          };

          await vaultDB.saveFile(record);
          await vaultDB.logEvent({
            eventType: 'SYNTHETIC_TRANSFORM',
            severity: 'SUCCESS',
            source: 'WEB_APP',
            fileId: record.id,
            fileName: record.fileName,
            actionTaken: `Vaulted with SYNTHETIC-PSEUDONYMIZED (${syntheticMappings.length} entities substituted with valid mock data)`,
            details: { count: syntheticMappings.length, pipeline: record.pipelineUsed },
          });

          const downloadObjUrl = URL.createObjectURL(syntheticBlob);
          const extension = isOriginalPdf ? 'pdf' : isOriginalImage ? 'png' : currentFile.name.split('.').pop() || 'txt';
          setLastEncryptedFile({
            downloadUrl: downloadObjUrl,
            fileName: `synthetic_${baseName}.${extension}`,
            objectUrlToRevoke: downloadObjUrl,
          });

          setEncryptionSuccess(true);
          setSuccessMessage(`Format-Preserving Pseudonymization complete! Substituted ${syntheticMappings.length} entity/entities with valid checksum-compliant synthetic data.`);
          onFileEncrypted();
          break;
        }

        case 'REDACT_METADATA': {
          // EXIF Stripping Pipeline
          if (!currentFile.type.startsWith('image/')) {
            throw new Error('Metadata redaction is only applicable to image files.');
          }

          const img = new Image();
          const cleanBlob = await new Promise<Blob>((resolve, reject) => {
            img.onload = async () => {
              try {
                const stripped = await ExifInspector.stripExifFromImage(img, currentFile.type);
                resolve(stripped);
              } catch (e) {
                reject(e);
              }
            };
            img.onerror = () => reject(new Error('Failed to load image for metadata stripping'));
            img.src = URL.createObjectURL(currentFile);
          });

          // Generate DEK & encrypt stripped image buffer
          const dek = await CryptoEngine.generateDEK();
          const { wrappedKeyB64, ivB64: wrapIvB64 } = await CryptoEngine.wrapDEK(dek, kek);
          const rawBuffer = await cleanBlob.arrayBuffer();
          const { ciphertext, iv } = await CryptoEngine.encryptBuffer(rawBuffer.slice(0) as ArrayBuffer, dek);
          const encryptedBlob = new Blob([ciphertext], { type: 'application/octet-stream' });
          const encHash = await CryptoEngine.computeSHA256(encryptedBlob);

          const record: EncryptedFileRecord = {
            id: detection.fileId,
            fileName: detection.fileName,
            originalMimeType: currentFile.type,
            originalSize: cleanBlob.size,
            isRegionEncrypted: false,
            originalHash: detection.fileHash,
            encryptedHash: encHash,
            wrappedDek: wrappedKeyB64,
            iv: CryptoEngine.bufferToBase64(iv.buffer as ArrayBuffer),
            pipelineUsed: 'REDACTED-METADATA',
            exifStripped: true,
            encryptedBlob,
            metadata: {
              category: decision?.fileCategory || 'PERSONAL_PHOTO',
              riskScore: decision?.riskScore ?? 0,
              detectedPiiCount: detection.detectedItems.length,
              explanation: decision?.explanation || 'EXIF GPS and hardware metadata stripped.',
            },
            createdAt: Date.now(),
          };

          await vaultDB.saveFile(record);
          await vaultDB.logEvent({
            eventType: 'ENCRYPT',
            severity: 'SUCCESS',
            source: 'WEB_APP',
            fileId: record.id,
            fileName: record.fileName,
            actionTaken: 'Vaulted with REDACTED-METADATA',
            details: { originalSize: record.originalSize, pipeline: record.pipelineUsed },
          });

          const cleanUrl = URL.createObjectURL(cleanBlob);
          setLastEncryptedFile({
            downloadUrl: cleanUrl,
            fileName: `clean_${record.fileName}`,
            objectUrlToRevoke: cleanUrl,
          });

          setEncryptionSuccess(true);
          setSuccessMessage('EXIF metadata successfully stripped and file vaulted!');
          onFileEncrypted();
          break;
        }

        case 'ENCRYPT_REGION': {
          const isOriginalPdf = currentFile.name.toLowerCase().endsWith('.pdf') || currentFile.type === 'application/pdf';
          const isOriginalImage = currentFile.type.startsWith('image/') || currentFile.name.match(/\.(png|jpe?g|webp|svg|bmp)$/i);
          const baseName = detection.fileName.replace(/\.[^/.]+$/, '');

          const dek = await CryptoEngine.generateDEK();
          const { wrappedKeyB64, ivB64: wrapIvB64 } = await CryptoEngine.wrapDEK(dek, kek);

          const sensitiveCrops: SensitiveCropItem[] = [];
          let savedEncryptedBlob: Blob | string = '';
          let savedEncryptedRegions: EncryptedRegionRecord[] = [];
          let savedPdfPages: { pageNumber: number; pageImageDataUrl: string; width: number; height: number }[] | undefined = undefined;
          let finalDownloadUrl = '';
          let finalFileName = '';
          let objectUrlToRevoke: string | undefined = undefined;

          if (isOriginalPdf && detection.pages && detection.pages.length > 0) {
            const maskedPages: { canvas: HTMLCanvasElement | string; width: number; height: number }[] = [];
            const allRegionRecords: EncryptedRegionRecord[] = [];
            const savedPages: { pageNumber: number; pageImageDataUrl: string; width: number; height: number }[] = [];

            for (const page of detection.pages) {
              const pageCanvas = document.createElement('canvas');
              pageCanvas.width = page.pageDimensions.width;
              pageCanvas.height = page.pageDimensions.height;
              const pageCtx = pageCanvas.getContext('2d');
              if (!pageCtx) continue;

              const pageImg = new Image();
              await new Promise<void>((resolve, reject) => {
                pageImg.onload = () => resolve();
                pageImg.onerror = () => reject(new Error(`Failed to load page ${page.pageNumber}`));
                pageImg.src = page.pageImageDataUrl;
              });

              pageCtx.drawImage(pageImg, 0, 0);
              const pageRegions = detection.detectedItems
                .filter(i => !!i.boundingBox && (i.pageNumber === page.pageNumber || (!i.pageNumber && page.pageNumber === 1)))
                .map(i => ({ box: i.boundingBox!, type: i.type }));

              let maskedPageDataUrl = page.pageImageDataUrl;

              if (pageRegions.length > 0) {
                // Extract sensitive crops for this page
                pageRegions.forEach((reg, regIdx) => {
                  try {
                    const cropCanvas = document.createElement('canvas');
                    const px = Math.max(0, Math.min(reg.box.x <= 1 ? Math.floor(reg.box.x * pageCanvas.width) : Math.floor(reg.box.x), pageCanvas.width - 1));
                    const py = Math.max(0, Math.min(reg.box.y <= 1 ? Math.floor(reg.box.y * pageCanvas.height) : Math.floor(reg.box.y), pageCanvas.height - 1));
                    const pw = Math.max(1, Math.min(reg.box.width <= 1 ? Math.ceil(reg.box.width * pageCanvas.width) : Math.ceil(reg.box.width), pageCanvas.width - px));
                    const ph = Math.max(1, Math.min(reg.box.height <= 1 ? Math.ceil(reg.box.height * pageCanvas.height) : Math.ceil(reg.box.height), pageCanvas.height - py));
                    cropCanvas.width = pw;
                    cropCanvas.height = ph;
                    const cCtx = cropCanvas.getContext('2d');
                    if (cCtx) {
                      cCtx.drawImage(pageCanvas, px, py, pw, ph, 0, 0, pw, ph);
                      const cleanType = reg.type === 'FACE' ? 'Face Photo' : reg.type === 'AADHAAR' ? 'Aadhaar Number' : reg.type.replace(/_/g, ' ');
                      sensitiveCrops.push({
                        label: `${cleanType} (P${page.pageNumber} #${regIdx + 1})`,
                        downloadUrl: cropCanvas.toDataURL('image/png'),
                        fileName: `crop_${cleanType.toLowerCase().replace(/\s+/g, '_')}_p${page.pageNumber}_${baseName}.png`,
                      });
                    }
                  } catch (e) {}
                });

                // Encrypt regions on this page canvas and obtain masked image
                const { maskedImageDataUrl, encryptedRegionRecords } = await CryptoEngine.encryptImageRegions(pageCanvas, pageRegions, dek);
                encryptedRegionRecords.forEach(r => {
                  allRegionRecords.push({ ...r, pageNumber: page.pageNumber });
                });
                maskedPageDataUrl = maskedImageDataUrl;
              }

              maskedPages.push({ canvas: maskedPageDataUrl, width: pageCanvas.width, height: pageCanvas.height });
              savedPages.push({
                pageNumber: page.pageNumber,
                pageImageDataUrl: maskedPageDataUrl,
                width: page.pageDimensions.width,
                height: page.pageDimensions.height,
              });
            }

            const pdfBlob = maskedPages.length === 1
              ? PdfProcessor.canvasToPdfBlob(maskedPages[0].canvas, maskedPages[0].width, maskedPages[0].height)
              : PdfProcessor.exportMultiPagePdf(maskedPages);

            savedEncryptedBlob = pdfBlob;
            savedEncryptedRegions = allRegionRecords;
            savedPdfPages = savedPages;

            finalDownloadUrl = URL.createObjectURL(pdfBlob);
            finalFileName = `encrypted_${baseName}.pdf`;
            objectUrlToRevoke = finalDownloadUrl;
          } else {
            // Single Page Image or Document
            const cleanCanvas = document.createElement('canvas');
            const cleanCtx = cleanCanvas.getContext('2d');
            if (!cleanCtx) throw new Error('Offscreen canvas context error');

            const cleanImg = new Image();
            await new Promise<void>((resolve, reject) => {
              cleanImg.onload = () => {
                cleanCanvas.width = cleanImg.naturalWidth;
                cleanCanvas.height = cleanImg.naturalHeight;
                cleanCtx.drawImage(cleanImg, 0, 0);
                resolve();
              };
              cleanImg.onerror = () => reject(new Error('Failed to load clean image for encryption'));
              cleanImg.src = detection.previewDataUrl || (currentFile.type.startsWith('image/') ? URL.createObjectURL(currentFile) : (previewImageUrl || ''));
            });

            const regionsToEncrypt = detection.detectedItems
              .filter(i => !!i.boundingBox)
              .map(i => ({ box: i.boundingBox!, type: i.type }));

            if (regionsToEncrypt.length === 0) {
              throw new Error('No detectable visual bounding boxes available for selective region encryption.');
            }

            regionsToEncrypt.forEach((reg, index) => {
              try {
                const cropCanvas = document.createElement('canvas');
                const px = Math.max(0, Math.min(reg.box.x <= 1 ? Math.floor(reg.box.x * cleanCanvas.width) : Math.floor(reg.box.x), cleanCanvas.width - 1));
                const py = Math.max(0, Math.min(reg.box.y <= 1 ? Math.floor(reg.box.y * cleanCanvas.height) : Math.floor(reg.box.y), cleanCanvas.height - 1));
                const pw = Math.max(1, Math.min(reg.box.width <= 1 ? Math.ceil(reg.box.width * cleanCanvas.width) : Math.ceil(reg.box.width), cleanCanvas.width - px));
                const ph = Math.max(1, Math.min(reg.box.height <= 1 ? Math.ceil(reg.box.height * cleanCanvas.height) : Math.ceil(reg.box.height), cleanCanvas.height - py));
                cropCanvas.width = pw;
                cropCanvas.height = ph;
                const cropCtx = cropCanvas.getContext('2d');
                if (cropCtx) {
                  cropCtx.drawImage(cleanCanvas, px, py, pw, ph, 0, 0, pw, ph);
                  const cropUrl = cropCanvas.toDataURL('image/png');
                  const cleanType = reg.type === 'FACE' ? 'Face Photo' : reg.type === 'AADHAAR' ? 'Aadhaar Number' : reg.type.replace(/_/g, ' ');
                  sensitiveCrops.push({
                    label: `${cleanType} #${index + 1}`,
                    downloadUrl: cropUrl,
                    fileName: `crop_${cleanType.toLowerCase().replace(/\s+/g, '_')}_${baseName}.png`,
                  });
                }
              } catch (err) {
                console.warn('Crop slice extraction error:', err);
              }
            });

            const { maskedImageDataUrl, encryptedRegionRecords } = await CryptoEngine.encryptImageRegions(
              cleanCanvas,
              regionsToEncrypt,
              dek
            );

            if (isOriginalPdf) {
              const pdfBlob = PdfProcessor.canvasToPdfBlob(maskedImageDataUrl, cleanCanvas.width, cleanCanvas.height);
              savedEncryptedBlob = pdfBlob;
              savedEncryptedRegions = encryptedRegionRecords.map(r => ({ ...r, pageNumber: 1 }));
              savedPdfPages = [{
                pageNumber: 1,
                pageImageDataUrl: maskedImageDataUrl,
                width: cleanCanvas.width,
                height: cleanCanvas.height,
              }];
              finalDownloadUrl = URL.createObjectURL(pdfBlob);
              finalFileName = `encrypted_${baseName}.pdf`;
              objectUrlToRevoke = finalDownloadUrl;
            } else if (!isOriginalImage) {
              // Code / Configuration / Text File
              let redactedText = detection.extractedText || '';
              detection.detectedItems.forEach(item => {
                if (item.value && redactedText.includes(item.value)) {
                  redactedText = redactedText.split(item.value).join(`[REDACTED_${item.type}]`);
                }
              });
              const textBlob = new Blob([redactedText], { type: currentFile.type || 'text/plain' });
              savedEncryptedBlob = maskedImageDataUrl;
              savedEncryptedRegions = encryptedRegionRecords;
              finalDownloadUrl = URL.createObjectURL(textBlob);
              finalFileName = `redacted_${currentFile.name}`;
              objectUrlToRevoke = finalDownloadUrl;
            } else {
              // Standard Image (PNG/JPG)
              savedEncryptedBlob = maskedImageDataUrl;
              savedEncryptedRegions = encryptedRegionRecords;
              finalDownloadUrl = maskedImageDataUrl;
              finalFileName = `encrypted_${baseName}.png`;
            }
          }

          const encHash = await CryptoEngine.computeSHA256(savedEncryptedBlob);

          const record: EncryptedFileRecord = {
            id: detection.fileId,
            fileName: detection.fileName,
            originalMimeType: isOriginalPdf ? 'application/pdf' : (currentFile.type || (isOriginalImage ? 'image/png' : 'text/plain')),
            originalSize: typeof savedEncryptedBlob === 'string' ? detection.fileSize : savedEncryptedBlob.size,
            isRegionEncrypted: true,
            originalHash: detection.fileHash,
            encryptedHash: encHash,
            wrappedDek: wrappedKeyB64,
            iv: wrapIvB64,
            pipelineUsed: 'AES-256-GCM-SELECTIVE-REGION',
            exifStripped: true,
            encryptedBlob: savedEncryptedBlob,
            encryptedRegions: savedEncryptedRegions,
            pdfPages: savedPdfPages,
            metadata: {
              category: decision?.fileCategory || 'GENERAL_DOCUMENT',
              riskScore: decision?.riskScore ?? 0,
              detectedPiiCount: detection.detectedItems.length,
              explanation: decision?.explanation || '',
              totalPages: savedPdfPages?.length || 1,
            },
            createdAt: Date.now(),
          };

          await vaultDB.saveFile(record);
          await vaultDB.logEvent({
            eventType: 'ENCRYPT',
            severity: 'SUCCESS',
            source: 'WEB_APP',
            fileId: record.id,
            fileName: record.fileName,
            actionTaken: `Vaulted with AES-256-GCM-SELECTIVE-REGION (${savedEncryptedRegions.length} regions locked)`,
            details: { originalSize: record.originalSize, regionCount: savedEncryptedRegions.length },
          });

          setLastEncryptedFile({
            downloadUrl: finalDownloadUrl,
            fileName: finalFileName,
            crops: sensitiveCrops,
            objectUrlToRevoke,
          });

          setEncryptionSuccess(true);
          setSuccessMessage(`Successfully encrypted ${savedEncryptedRegions.length} region(s) with Web Crypto AES-256-GCM!`);
          onFileEncrypted();
          break;
        }

        case 'ENCRYPT_FULL':
        default: {
          // Full File Envelope Encryption
          const dek = await CryptoEngine.generateDEK();
          const { wrappedKeyB64, ivB64: wrapIvB64 } = await CryptoEngine.wrapDEK(dek, kek);

          const rawBuffer = await currentFile.arrayBuffer();
          const { ciphertext, iv } = await CryptoEngine.encryptBuffer(rawBuffer.slice(0) as ArrayBuffer, dek);
          const encryptedBlob = new Blob([ciphertext], { type: 'application/octet-stream' });
          const encHash = await CryptoEngine.computeSHA256(encryptedBlob);

          const record: EncryptedFileRecord = {
            id: detection.fileId,
            fileName: detection.fileName,
            originalMimeType: detection.fileType,
            originalSize: detection.fileSize,
            isRegionEncrypted: false,
            originalHash: detection.fileHash,
            encryptedHash: encHash,
            wrappedDek: wrappedKeyB64,
            iv: CryptoEngine.bufferToBase64(iv.buffer as ArrayBuffer),
            pipelineUsed: 'AES-256-GCM-FULL',
            exifStripped: false, // Full raw binary preserved inside ciphertext
            encryptedBlob,
            metadata: {
              category: decision?.fileCategory || 'GENERAL_DOCUMENT',
              riskScore: decision?.riskScore ?? 0,
              detectedPiiCount: detection.detectedItems.length,
              explanation: decision?.explanation || '',
            },
            createdAt: Date.now(),
          };

          await vaultDB.saveFile(record);
          await vaultDB.logEvent({
            eventType: 'ENCRYPT',
            severity: 'SUCCESS',
            source: 'WEB_APP',
            fileId: record.id,
            fileName: record.fileName,
            actionTaken: 'Vaulted with AES-256-GCM-FULL envelope encryption',
            details: { originalSize: record.originalSize, pipeline: record.pipelineUsed },
          });

          const encUrl = URL.createObjectURL(encryptedBlob);
          setLastEncryptedFile({
            downloadUrl: encUrl,
            fileName: `encrypted_${record.fileName}`,
            objectUrlToRevoke: encUrl,
          });

          setEncryptionSuccess(true);
          setSuccessMessage('Full binary envelope encryption completed and vaulted into IndexedDB!');
          onFileEncrypted();
          break;
        }
      }
    } catch (err) {
      console.error('Encryption execution failed:', err);
      setError(err instanceof Error ? err.message : 'Encryption failed. Please check master key and try again.');
    } finally {
      setIsEncrypting(false);
    }
  };

  // Quick Scenario Sample Loader
  const handleLoadSample = (type: 'ID' | 'FINANCE' | 'CODE' | 'PHOTO') => {
    let mockFile: File;
    if (type === 'ID') {
      const svg = `<svg width="800" height="500" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f1f5f9"/>
        <rect x="25" y="25" width="750" height="450" rx="16" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
        
        <!-- Header -->
        <rect x="25" y="25" width="750" height="70" rx="16" fill="#0f172a"/>
        <text x="50" y="65" font-family="sans-serif" font-size="18" font-weight="bold" fill="#38bdf8">UNIQUE IDENTIFICATION AUTHORITY OF INDIA</text>
        
        <!-- Photo Placeholder -->
        <rect x="50" y="125" width="160" height="200" rx="10" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5"/>
        <circle cx="130" cy="190" r="45" fill="#f97316"/>
        <ellipse cx="130" cy="275" rx="55" ry="35" fill="#ea580c"/>
        <text x="85" y="315" font-family="sans-serif" font-size="11" fill="#475569">PHOTO ID</text>
        
        <!-- User Details -->
        <text x="240" y="150" font-family="sans-serif" font-size="16" font-weight="bold" fill="#0f172a">Name: Rajesh Kumar Sharma</text>
        <text x="240" y="185" font-family="sans-serif" font-size="14" fill="#334155">DOB: 14/08/1988 | Gender: MALE</text>
        <text x="240" y="220" font-family="sans-serif" font-size="14" fill="#334155">Address: 42 Palm Avenue, Indiranagar, Bengaluru</text>
        
        <!-- Aadhaar Number Box -->
        <rect x="240" y="250" width="340" height="50" rx="8" fill="#f8fafc" stroke="#0284c7" stroke-width="1.5"/>
        <text x="260" y="283" font-family="monospace" font-size="22" font-weight="bold" fill="#0284c7">2345 6789 0123</text>
        
        <!-- PAN Number Box -->
        <rect x="50" y="355" width="400" height="45" rx="8" fill="#f8fafc" stroke="#64748b" stroke-width="1"/>
        <text x="65" y="383" font-family="monospace" font-size="15" font-weight="bold" fill="#0f172a">PAN Number: ABCDE1234F</text>
      </svg>`;
      mockFile = new File([svg], 'aadhaar_pan_sample.svg', { type: 'image/svg+xml' });
    } else if (type === 'FINANCE') {
      const text = `TAX INVOICE / STATEMENT OF ACCOUNT
Invoice Number: INV-2026-8941
Client: Apex Global Logistics
Primary Card: 4532 0150 9942 1825 (Luhn Verified)
Total Amount Due: $4,850.00
Account Balance: $12,400.00
Payment Status: PAID`;
      mockFile = new File([text], 'financial_statement.txt', { type: 'text/plain' });
    } else if (type === 'CODE') {
      const code = `// Cloud Infrastructure Config
const AWS_ACCESS_KEY = "AKIA1234567890ABCDEF";
const OPENAI_SECRET = "sk-proj-9876543210zyxwvutsrqponmlkjihgfedcba";
const DB_CONN = "postgres://admin:SecretPass2026@vault.internal:5432/core";
console.log("Starting secure daemon...");`;
      mockFile = new File([code], 'deploy_keys.env', { type: 'text/plain' });
    } else {
      const svg = `<svg width="600" height="600" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#0f172a"/>
        <circle cx="300" cy="240" r="120" fill="#fcd34d"/>
        <circle cx="260" cy="220" r="14" fill="#0f172a"/>
        <circle cx="340" cy="220" r="14" fill="#0f172a"/>
        <ellipse cx="300" cy="300" rx="40" ry="20" fill="#f87171"/>
        <text x="180" y="440" font-family="sans-serif" font-size="18" fill="#f8fafc">Profile Photo with Geotag</text>
      </svg>`;
      mockFile = new File([svg], '__aegis_demo_sample.jpg', { type: 'image/jpeg' });
    }

    handleProcessFile(mockFile);
  };

  return (
    <div className="space-y-6">
      {/* 🌟 Safety & Hardware Telemetry Bento Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center gap-2 text-indigo-600">
            <Brain className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider font-mono">On-Device SLM</span>
          </div>
          <p className="text-xs font-bold text-slate-900 mt-1">DistilBERT ONNX</p>
          <p className="text-[11px] text-slate-500">66M Params · WebAssembly SIMD</p>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center gap-2 text-sky-600">
            <Scan className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider font-mono">Perception AI</span>
          </div>
          <p className="text-xs font-bold text-slate-900 mt-1">LSTM OCR & Biometrics</p>
          <p className="text-[11px] text-slate-500">Tesseract WASM + Face Worker</p>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center gap-2 text-emerald-600">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider font-mono">Zero-Cloud Vault</span>
          </div>
          <p className="text-xs font-bold text-slate-900 mt-1">AES-256-GCM Envelope</p>
          <p className="text-[11px] text-slate-500">WebAuthn PRF Hardware Key</p>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center gap-2 text-amber-600">
            <Sparkles className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider font-mono">Math Guarantees</span>
          </div>
          <p className="text-xs font-bold text-slate-900 mt-1">Dihedral D5 & Luhn</p>
          <p className="text-[11px] text-slate-500">Zero False Positive Checksums</p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center gap-3 text-rose-800">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Success Notification */}
      {encryptionSuccess && successMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3 text-emerald-900 shadow-sm animate-fadeIn">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-bold">{successMessage}</p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  File is securely locked with AES-256-GCM and saved to your local on-device vault.
                </p>
              </div>
            </div>

            {lastEncryptedFile && (
              <a
                href={lastEncryptedFile.downloadUrl}
                download={lastEncryptedFile.fileName}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2 shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Download Encrypted Document</span>
              </a>
            )}
          </div>

          {/* Standalone Sensitive Crop Slices (Face, Aadhaar UID, etc.) */}
          {lastEncryptedFile?.crops && lastEncryptedFile.crops.length > 0 && (
            <div className="pt-2.5 border-t border-emerald-200 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-emerald-800 font-mono flex items-center gap-1">
                <Scissors className="w-3.5 h-3.5" />
                <span>Download Hidden Pieces Separately:</span>
              </span>
              {lastEncryptedFile.crops.map((crop, idx) => (
                <a
                  key={idx}
                  href={crop.downloadUrl}
                  download={crop.fileName}
                  className="px-2.5 py-1 bg-white hover:bg-emerald-100/60 text-emerald-900 text-xs font-semibold rounded-lg border border-emerald-300 shadow-sm flex items-center gap-1.5 transition-all"
                  title={`Download isolated ${crop.label} slice`}
                >
                  <Download className="w-3 h-3 text-emerald-600" />
                  <span>{crop.label}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top Demo Scenario Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            Quick Test Scenarios:
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleLoadSample('ID')}
              disabled={isScanning || isEncrypting}
              className="px-3 py-1.5 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 flex items-center gap-1.5 transition-all"
            >
              <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
              Govt ID (Aadhaar & PAN)
            </button>
            <button
              onClick={() => handleLoadSample('FINANCE')}
              disabled={isScanning || isEncrypting}
              className="px-3 py-1.5 bg-slate-50 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 flex items-center gap-1.5 transition-all"
            >
              <CreditCard className="w-3.5 h-3.5 text-amber-600" />
              Financial Invoice
            </button>
            <button
              onClick={() => handleLoadSample('CODE')}
              disabled={isScanning || isEncrypting}
              className="px-3 py-1.5 bg-slate-50 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 flex items-center gap-1.5 transition-all"
            >
              <FileCode className="w-3.5 h-3.5 text-rose-600" />
              API Secrets
            </button>
            <button
              onClick={() => handleLoadSample('PHOTO')}
              disabled={isScanning || isEncrypting}
              className="px-3 py-1.5 bg-slate-50 hover:bg-purple-50 hover:text-purple-700 disabled:opacity-50 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 flex items-center gap-1.5 transition-all"
            >
              <MapPin className="w-3.5 h-3.5 text-purple-600" />
              Photo + Geotag
            </button>
          </div>
        </div>
      </div>

      {/* Main Drag-and-Drop / Upload Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Dropzone & Live Canvas Preview */}
        <div className="lg:col-span-7 space-y-4">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
              currentFile 
                ? 'border-indigo-400 bg-indigo-50/20 shadow-sm' 
                : 'border-slate-300 hover:border-indigo-400 bg-white hover:bg-slate-50/80 shadow-sm'
            }`}
          >
            <input 
              ref={fileInputRef}
              type="file" 
              className="hidden" 
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleProcessFile(e.target.files[0]);
                }
              }}
            />

            {!currentFile ? (
              <div className="py-8 flex flex-col items-center justify-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
                  <UploadCloud className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    Click to select or drag & drop any file here
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Images, PDFs, Documents, Source Code (100% processed in local RAM)
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-left">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{currentFile.name}</h4>
                    <p className="text-xs text-slate-500 font-mono">
                      {(currentFile.size / 1024).toFixed(1)} KB • {currentFile.type || 'Unknown MIME'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 rounded-lg border border-slate-200 transition-all"
                >
                  Change File
                </button>
              </div>
            )}
          </div>

          {/* Live Preview Canvas Container */}
          {previewImageUrl && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Live Visual Inspection & Redaction
                </span>
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    onClick={() => setPreviewMode('ORIGINAL')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                      previewMode === 'ORIGINAL'
                        ? 'bg-white text-slate-900 font-bold shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Original
                  </button>
                  <button
                    onClick={() => setPreviewMode('BLURRED_REGIONS')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                      previewMode === 'BLURRED_REGIONS'
                        ? 'bg-indigo-600 text-white font-bold shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Live Masked
                  </button>
                  <button
                    onClick={() => setPreviewMode('SYNTHETIC_DATA')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                      previewMode === 'SYNTHETIC_DATA'
                        ? 'bg-emerald-600 text-white font-bold shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🎭 Synthetic (FPE)
                  </button>
                </div>
              </div>

              {/* Multi-Page Navigation Toolbar for PDFs and Multi-Page Documents */}
              {detection?.pages && detection.pages.length > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-indigo-50/80 border border-indigo-200/80 rounded-xl animate-fadeIn">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={currentPageIndex === 0}
                      onClick={() => handlePageChange(currentPageIndex - 1)}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center gap-1 transition-all"
                    >
                      ◀ Prev
                    </button>
                    <span className="text-xs font-extrabold text-indigo-950 font-mono">
                      Page {currentPageIndex + 1} of {detection.pages.length}
                    </span>
                    <button
                      type="button"
                      disabled={currentPageIndex === detection.pages.length - 1}
                      onClick={() => handlePageChange(currentPageIndex + 1)}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center gap-1 transition-all"
                    >
                      Next ▶
                    </button>
                  </div>
                  <div className="flex items-center gap-1 overflow-x-auto max-w-full py-0.5">
                    {detection.pages.map((p, idx) => (
                      <button
                        key={p.pageNumber}
                        type="button"
                        onClick={() => handlePageChange(idx)}
                        className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all ${
                          currentPageIndex === idx
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-100/60'
                        }`}
                      >
                        Page {p.pageNumber} {p.detectedItems.length > 0 ? `(${p.detectedItems.length})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div 
                className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-200 flex items-center justify-center min-h-[260px] select-none shadow-inner"
                style={{ cursor: canvasCursor }}
              >
                <canvas 
                  ref={canvasRef} 
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  className="max-w-full max-h-[420px] object-contain rounded-lg"
                />
              </div>

              {/* Interactive Redaction Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-indigo-700 flex items-center gap-1.5 font-mono">
                  <span>💡</span> Click any box to resize with corner handles, drag to move, or draw new
                </span>
                {decision?.fileCategory === 'GOVERNMENT_ID' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddIdRegions('DEMOGRAPHIC')}
                      className="px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 text-indigo-700 text-[11px] font-medium rounded-lg border border-slate-200 transition-all"
                    >
                      + Blur Demographic (Name/DOB)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddIdRegions('QR_CODE')}
                      className="px-2.5 py-1 bg-slate-50 hover:bg-indigo-50 text-indigo-700 text-[11px] font-medium rounded-lg border border-slate-200 transition-all"
                    >
                      + Blur QR Matrix
                    </button>
                  </div>
                )}
              </div>

              {/* Selected Field Properties & Custom Synthetic Input Drawer */}
              {selectedItemId && detection?.detectedItems.some(i => i.id === selectedItemId) && (() => {
                const selectedItem = detection.detectedItems.find(i => i.id === selectedItemId)!;
                const mapping = syntheticMappings.find(m => m.id === selectedItemId);
                const currentSynVal = mapping ? mapping.syntheticValue : '';

                return (
                  <div className="p-3.5 rounded-xl bg-indigo-50/80 border border-indigo-200 space-y-3 animate-fadeIn shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[11px] font-bold">
                          🎯 Selected Field
                        </span>
                        <span className="text-xs font-bold text-slate-800 truncate max-w-[220px]">
                          {selectedItem.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleScaleRegion(selectedItemId, 0.15)}
                          className="px-2 py-0.5 bg-white hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded border border-indigo-200 shadow-sm"
                          title="Expand boundary"
                        >
                          +15%
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScaleRegion(selectedItemId, -0.15)}
                          className="px-2 py-0.5 bg-white hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded border border-indigo-200 shadow-sm"
                          title="Shrink boundary"
                        >
                          -15%
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRegion(selectedItemId)}
                          className="p-1 bg-white hover:bg-rose-100 text-rose-600 rounded border border-rose-200 ml-1 transition-colors shadow-sm"
                          title="Delete this region"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Entity Type Picker */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        Assign Field Type:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {([
                          { type: 'AADHAAR', label: '🪪 Aadhaar' },
                          { type: 'PAN_CARD', label: '💳 PAN Card' },
                          { type: 'FACE', label: '👤 Face Photo' },
                          { type: 'DOB', label: '📅 Date of Birth' },
                          { type: 'EMAIL', label: '✉️ Email' },
                          { type: 'PHONE', label: '📞 Phone' },
                          { type: 'CREDIT_CARD', label: '💳 Card' },
                          { type: 'API_KEY', label: '🔑 Secret' },
                          { type: 'MEDICAL_CONDITION', label: '🏥 Medical / PHI' },
                          { type: 'TRADE_SECRET', label: '🔒 Trade Secret' },
                          { type: 'ORGANIZATION', label: '🏢 Institution' },
                          { type: 'LEGAL_CLAUSE', label: '📜 Legal Clause' },
                          { type: 'CUSTOM', label: '🏷️ Name/Text' },
                        ] as { type: PiiType; label: string }[]).map(t => (
                          <button
                            key={t.type}
                            type="button"
                            onClick={() => handleUpdateItemType(selectedItemId, t.type)}
                            className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all ${
                              selectedItem.type === t.type
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                : 'bg-white text-slate-700 border-slate-200 hover:bg-indigo-50'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Custom Synthetic Value Input */}
                    {selectedItem.type !== 'FACE' ? (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Custom Synthetic Mock Value:
                          </label>
                          {mapping?.checksumValidated && (
                            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-200">
                              {mapping.checksumAlgorithm === 'VERHOEFF_D5'
                                ? '✓ Verhoeff D5 Valid'
                                : mapping.checksumAlgorithm === 'LUHN_MOD10'
                                ? '✓ Luhn Mod-10 Valid'
                                : '✓ Valid Format'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={currentSynVal}
                            onChange={(e) => handleUpdateSyntheticValue(selectedItemId, e.target.value)}
                            placeholder="Enter custom mock data (e.g. 9876 5432 1098)..."
                            className="flex-1 px-3 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner"
                          />
                          <button
                            type="button"
                            onClick={() => handleRegenerateSyntheticValue(selectedItemId)}
                            className="px-2.5 py-1.5 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all shadow-sm shrink-0"
                            title="Generate a random checksum-compliant mock value for this type"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>🎲 New Mock</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 bg-white rounded-lg border border-indigo-100 flex items-center justify-between text-xs">
                        <span className="text-slate-600 font-medium">
                          👤 Authentic Synthetic Passport Portrait Active
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          AI Inpainted
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Right Column: Multi-Agent Reasoning, Risk Gauges & Action Confirmation */}
        <div className="lg:col-span-5 space-y-4">
          {isScanning && (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3 shadow-sm">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
              <h4 className="text-sm font-bold text-slate-900">
                {aiModelProgress || 'Analyzing Document Locally...'}
              </h4>
              <p className="text-xs text-slate-500">
                {aiModelProgress
                  ? 'Executing Transformers.js on-device neural classifier...'
                  : 'Running Tesseract OCR, Face Cascade Worker, and Deterministic Regex Matchers'}
              </p>
            </div>
          )}

          {decision && detection && !isScanning && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5 shadow-sm">
              {/* Local WebGPU AI Assistant Control Panel */}
              <div className="bg-gradient-to-br from-purple-900/95 via-indigo-900/90 to-slate-900 text-white rounded-2xl p-4 border border-purple-500/30 shadow-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-400/40 flex items-center justify-center text-purple-300">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>Local WebGPU AI Assistant</span>
                        <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-extrabold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          ON-DEVICE SLM
                        </span>
                      </h4>
                      <p className="text-[10px] text-slate-300">
                        Zero-Data-Exfiltration Semantic NER & Clause Reasoner
                      </p>
                    </div>
                  </div>

                  {/* Hardware Status Badge */}
                  <div className="text-right">
                    {aiHardwareInfo?.hasWebGpu ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        WebGPU Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                        <Cpu className="w-2.5 h-2.5" />
                        WASM CPU Engine
                      </span>
                    )}
                  </div>
                </div>

                {/* Hardware details subtext */}
                <div className="flex items-center justify-between text-[10px] text-slate-300 px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/5 font-mono">
                  <span className="truncate max-w-[220px]" title={aiHardwareInfo?.adapterName}>
                    Device: {aiHardwareInfo?.adapterName || 'In-Browser Runtime'}
                  </span>
                  <span className="text-purple-300">
                    {aiModelStatus.loaded ? '✓ Model Cached' : aiModelStatus.loading ? 'Compiling...' : 'Zero-Shot NER Ready'}
                  </span>
                </div>

                {/* Model Download / Progress Bar if loading */}
                {aiModelStatus.loading && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-purple-200">
                      <span>{aiModelStatus.statusText}</span>
                      <span>{aiModelStatus.progressPercent}%</span>
                    </div>
                    <div className="w-full bg-purple-950/60 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-purple-400 to-indigo-400 h-full transition-all duration-300"
                        style={{ width: `${aiModelStatus.progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Deep AI Scan Action Button */}
                <button
                  type="button"
                  onClick={handleRunDeepAiScan}
                  disabled={isAiScanning || isScanning}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md ${
                    deepAiRan
                      ? 'bg-purple-600/40 hover:bg-purple-600/60 text-purple-200 border border-purple-400/40'
                      : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-600/30'
                  } disabled:opacity-50`}
                >
                  {isAiScanning ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Analyzing Health & Legal Context via WebGPU...</span>
                    </>
                  ) : deepAiRan ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Deep Context Scan Complete (Re-run)</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                      <span>⚡ Run Deep Context AI Scan (Medical / Legal / Secrets)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Category & Risk Score Header */}
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    CLASSIFIED CATEGORY
                  </span>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2 mt-0.5">
                    {decision.fileCategory.replace(/_/g, ' ')}
                  </h3>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    RISK SCORE
                  </span>
                  <div className={`text-lg font-black ${
                    decision.riskScore >= 70 ? 'text-rose-600' : decision.riskScore >= 40 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {decision.riskScore}/100
                  </div>
                </div>
              </div>

              {/* Detected Items Pill List */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Discovered Sensitive Entities ({detection.detectedItems.length})
                  </span>
                  {detection.detectedItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllRegions}
                      className="text-[10px] text-slate-400 hover:text-rose-600 font-mono transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 mt-2 max-h-[160px] overflow-y-auto pr-1">
                  {detection.detectedItems.length === 0 ? (
                    <span className="text-xs text-slate-400 italic">No structured PII found (you can drag custom boxes on the preview)</span>
                  ) : (
                    detection.detectedItems.map((item, idx) => {
                      const isSelected = item.id === selectedItemId;
                      const isLocalAi = item.source === 'LOCAL_AI';
                      return (
                        <div
                          key={item.id || idx}
                          onClick={() => {
                            setSelectedItemId(item.id);
                            if (item.pageNumber && detection.pages && item.pageNumber - 1 !== currentPageIndex) {
                              handlePageChange(item.pageNumber - 1);
                            }
                          }}
                          className={`group px-2.5 py-1 text-xs rounded-lg border font-mono flex items-center gap-1.5 cursor-pointer transition-all ${
                            isSelected
                              ? isLocalAi
                                ? 'bg-purple-100 border-purple-500 text-purple-950 shadow-sm'
                                : 'bg-indigo-50 border-indigo-400 text-indigo-900 shadow-sm'
                              : isLocalAi
                              ? 'bg-purple-50/80 text-purple-900 border-purple-300 hover:border-purple-400'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-indigo-300'
                          }`}
                        >
                          {isLocalAi ? (
                            <Bot className={`w-3 h-3 shrink-0 ${isSelected ? 'text-purple-700' : 'text-purple-600'}`} />
                          ) : (
                            <ShieldAlert className={`w-3 h-3 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-amber-600'}`} />
                          )}
                          {isLocalAi && (
                            <span className="px-1 py-0.2 bg-purple-200 text-purple-900 text-[9px] font-extrabold rounded">
                              🤖 AI
                            </span>
                          )}
                          {item.pageNumber && detection.pages && detection.pages.length > 1 && (
                            <span className="px-1 py-0.5 bg-indigo-100 text-indigo-800 text-[9px] font-bold rounded">
                              p.{item.pageNumber}
                            </span>
                          )}
                          <span 
                            title={item.value ? `${item.label}: ${item.value}` : item.label}
                            className="truncate max-w-[200px]"
                          >
                            {item.label}
                          </span>

                          {/* Quick Scale Buttons */}
                          <div className="flex items-center gap-0.5 ml-1 pl-1 border-l border-slate-200">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleScaleRegion(item.id, 0.15);
                              }}
                              title="Expand boundary (+15%)"
                              className="px-1 text-slate-500 hover:text-indigo-600 hover:bg-slate-200 rounded font-bold text-[10px] transition-colors"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleScaleRegion(item.id, -0.15);
                              }}
                              title="Shrink boundary (-15%)"
                              className="px-1 text-slate-500 hover:text-indigo-600 hover:bg-slate-200 rounded font-bold text-[10px] transition-colors"
                            >
                              -
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRegion(item.id);
                            }}
                            title="Remove this redacted region"
                            className="ml-0.5 text-slate-400 hover:text-rose-600 p-0.5 rounded hover:bg-slate-200 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Explainer Agent Rationale & Compliance Tags */}
              <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  Agent Reasoning & Legal Context
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {decision.explanation}
                </p>

                {decision.complianceTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {decision.complianceTags.map((tag, i) => (
                      <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded border border-indigo-200 font-mono">
                        {tag.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Discovered EXIF & Hardware Metadata Inspector */}
              {(detection.exif.hasGps || detection.exif.deviceMake || detection.exif.deviceModel || detection.exif.dateTime || detection.exif.software || detection.detectedItems.some(i => i.type.startsWith('EXIF_'))) && (
                <div className="bg-purple-50 rounded-xl p-3.5 border border-purple-200 space-y-2.5 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs font-bold text-purple-900">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-purple-600" />
                      <span>Discovered EXIF & Hardware Metadata</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {detection.exif.isDemoSample && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-bold tracking-wide">
                          Demo Sample Data
                        </span>
                      )}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200 font-medium">
                        Stripped on Redact
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {detection.exif.hasGps && (
                      <div className="p-2 bg-white rounded-lg border border-purple-200 space-y-0.5 col-span-2">
                        <span className="text-[10px] text-purple-700 font-semibold uppercase tracking-wider block">
                          📍 GPS Geotag Location
                        </span>
                        <p className="font-mono text-slate-800 font-bold text-xs">
                          {detection.exif.latitude?.toFixed(5)}° N, {detection.exif.longitude?.toFixed(5)}° E
                          {detection.exif.altitude ? ` (${detection.exif.altitude.toFixed(0)}m alt)` : ''}
                        </p>
                      </div>
                    )}

                    {(detection.exif.deviceMake || detection.exif.deviceModel) && (
                      <div className="p-2 bg-white rounded-lg border border-purple-200 space-y-0.5">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                          📷 Camera / Device
                        </span>
                        <p className="font-mono text-slate-800 font-bold text-xs">
                          {detection.exif.deviceMake} {detection.exif.deviceModel}
                        </p>
                      </div>
                    )}

                    {detection.exif.dateTime && (
                      <div className="p-2 bg-white rounded-lg border border-purple-200 space-y-0.5">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                          🕒 Original Timestamp
                        </span>
                        <p className="font-mono text-slate-800 font-bold text-xs">
                          {detection.exif.dateTime}
                        </p>
                      </div>
                    )}

                    {detection.exif.software && (
                      <div className="p-2 bg-white rounded-lg border border-purple-200 space-y-0.5 col-span-2">
                        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">
                          ⚙️ Software / Firmware
                        </span>
                        <p className="font-mono text-slate-800 font-bold text-xs">
                          {detection.exif.software}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Format-Preserving Synthetic Entity Mappings Inspector (FPE) */}
              {syntheticMappings.length > 0 && (
                <div className="bg-emerald-50/80 rounded-xl p-3.5 border border-emerald-200 space-y-2.5 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-950">
                    <div className="flex items-center gap-1.5">
                      <span>🎭</span>
                      <span>Format-Preserving Synthetic Mappings</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold font-mono">
                      100% On-Device FPE
                    </span>
                  </div>

                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                    {syntheticMappings.map((map, idx) => (
                      <div key={map.id || idx} className="p-2 bg-white rounded-lg border border-emerald-200 text-xs space-y-1 shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] font-bold text-slate-500 uppercase">
                            {map.type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                            {map.checksumAlgorithm === 'VERHOEFF_D5'
                              ? '✓ Verhoeff D5 Valid'
                              : map.checksumAlgorithm === 'LUHN_MOD10'
                              ? '✓ Luhn Mod-10 Valid'
                              : '✓ Format Preserved'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <span className="text-slate-400 line-through truncate max-w-[120px]">{map.originalValue}</span>
                          <span className="text-slate-400">➔</span>
                          <span className="text-emerald-700 font-bold truncate">{map.syntheticValue}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Human-in-the-Loop Action Override Selection */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Action Directive {customActionOverridden && <span className="text-amber-600 font-semibold">(User Overridden)</span>}
                </span>

                <div className="grid grid-cols-2 gap-2">
                  {(['ENCRYPT_REGION', 'ENCRYPT_FULL', 'SYNTHETIC_REPLACE', 'REDACT_METADATA', 'NO_ACTION'] as AgentAction[]).map((act) => (
                    <button
                      key={act}
                      onClick={() => handleOverrideAction(act)}
                      className={`p-2.5 rounded-xl border text-xs font-bold text-left transition-all ${
                        selectedAction === act
                          ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      } ${act === 'SYNTHETIC_REPLACE' ? 'col-span-2 bg-emerald-50/50 border-emerald-300 hover:bg-emerald-50' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          {act === 'SYNTHETIC_REPLACE' ? '🎭 ' : ''}
                          {act.replace(/_/g, ' ')}
                        </span>
                        {decision.action === act && (
                          <span className="text-[9px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-bold">
                            Rec
                          </span>
                        )}
                        {act === 'SYNTHETIC_REPLACE' && (
                          <span className="text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">
                            FPE Mock Data
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Final Execution Button */}
              <button
                onClick={handleExecuteEncryption}
                disabled={isEncrypting || !selectedAction}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2"
              >
                {isEncrypting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Executing Cryptography...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Confirm & Execute ({selectedAction?.replace(/_/g, ' ')})
                  </>
                )}
              </button>

              {encryptionSuccess && lastEncryptedFile && (
                <a
                  href={lastEncryptedFile.downloadUrl}
                  download={lastEncryptedFile.fileName}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Encrypted File ({lastEncryptedFile.fileName})</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
