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
  ChevronLeft,
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
  Activity,
  LayoutTemplate,
  Sliders,
  Layers,
  Play
} from 'lucide-react';
import { ThreeStudioModel } from './ThreeStudioModel';
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
import { TelemetryBar } from './TelemetryBar';

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
  const [sidePanelTab, setSidePanelTab] = useState<'uploads' | 'templates' | 'redaction' | 'synthetic' | 'ai' | 'export'>('uploads');
  const [isSidePanelOpen, setIsSidePanelOpen] = useState<boolean>(true);
  const [emptyStageTab, setEmptyStageTab] = useState<'video' | '3d'>('video');
  const [isVideoModalOpen, setIsVideoModalOpen] = useState<boolean>(false);

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
          const isEstimated = box.boxConfidence === 'ESTIMATED';
          if (isEstimated && !box.boxVerified) {
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = isSelected ? '#d97706' : '#f59e0b';
          } else {
            ctx.setLineDash([]);
            ctx.strokeStyle = isSelected ? '#4f46e5' : '#6366f1';
          }
          ctx.lineWidth = isSelected ? 3 : Math.max(2, Math.floor(canvas.width / 400));
          ctx.strokeRect(bx, by, bw, bh);
          ctx.setLineDash([]);

          // Region Tag
          const fontSize = Math.max(11, Math.min(14, Math.floor(canvas.width / 50)));
          ctx.font = `bold ${fontSize}px "Fira Code", monospace`;
          ctx.fillStyle = isEstimated && !box.boxVerified ? '#b45309' : isSelected ? '#3730a3' : '#4f46e5';
          const labelPrefix = isEstimated ? (box.boxVerified ? '✓ ' : '⚠️ ') : '🔒 ';
          ctx.fillText(`${labelPrefix}${item.type}${isEstimated && !box.boxVerified ? ' [VERIFY]' : ''}`, bx + 4, Math.max(by + fontSize + 2, fontSize + 4));

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

          newBox.boxVerified = true;
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
            boxConfidence: 'EXACT',
            boxVerified: true,
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
            boundingBox: { ...box, x: newX, y: newY, width: newW, height: newH, boxVerified: true }
          };
        })
      };
    });
  };

  // Verify an estimated bounding box region
  const handleVerifyEstimatedBox = (itemId: string) => {
    setDetection(prev => {
      if (!prev) return null;
      return {
        ...prev,
        detectedItems: prev.detectedItems.map(item => {
          if (item.id !== itemId || !item.boundingBox) return item;
          return {
            ...item,
            boundingBox: {
              ...item.boundingBox,
              boxVerified: true,
            },
          };
        }),
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
      setSidePanelTab('redaction');
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
          // Execution Gate Matrix: Prevent fail-open leakage of detected sensitive PII
          const unverifiedEstimated = detection.detectedItems.filter(
            i => i.boundingBox?.boxConfidence === 'ESTIMATED' && !i.boundingBox.boxVerified
          );
          const missingSpatial = detection.detectedItems.filter(
            i => !i.boundingBox || i.boundingBox.boxConfidence === 'MISSING' || (i.boundingBox.width === 0 && i.boundingBox.height === 0)
          );

          if (unverifiedEstimated.length > 0) {
            const names = unverifiedEstimated.map(i => i.label).join(', ');
            throw new Error(`Selective Encryption Blocked: Estimated bounding box for [${names}] requires user verification. Please adjust or confirm the region on the canvas before encrypting.`);
          }

          if (missingSpatial.length > 0) {
            const names = missingSpatial.map(i => i.label).join(', ');
            throw new Error(`Security Guardrail Triggered: Sensitive item [${names}] was detected in text, but could not be located on the canvas. Please draw a manual bounding box or select 'Full File Encryption' to avoid data leakage.`);
          }

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

            const isJpeg = currentFile.type === 'image/jpeg' || !!currentFile.name.match(/\.(jpe?g)$/i);
            const isWebp = currentFile.type === 'image/webp' || !!currentFile.name.match(/\.webp$/i);
            const chosenMime = isJpeg ? 'image/jpeg' : (isWebp ? 'image/webp' : 'image/png');
            const ext = isJpeg ? 'jpg' : (isWebp ? 'webp' : 'png');

            const { maskedImageDataUrl, encryptedRegionRecords } = await CryptoEngine.encryptImageRegions(
              cleanCanvas,
              regionsToEncrypt,
              dek,
              chosenMime,
              isJpeg || isWebp ? 0.90 : 1.0
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
              // Standard Image (PNG/JPG/WEBP with optional compression)
              savedEncryptedBlob = maskedImageDataUrl;
              savedEncryptedRegions = encryptedRegionRecords;
              finalDownloadUrl = maskedImageDataUrl;
              finalFileName = `encrypted_${baseName}.${ext}`;
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
    <div className="space-y-6 w-full font-sans">
      {/* 🚀 Live Hardware & Zero-Egress Telemetry Bar */}
      <TelemetryBar
        hardwareInfo={aiHardwareInfo}
        modelStatus={aiModelStatus}
        scanLatencyMs={detection?.scanDurationMs}
        detectedCount={detection?.detectedItems.length}
        isScanning={isScanning}
        fileName={currentFile?.name}
      />
      {/* Error Banner */}
      {error && (
        <div className="bg-[#E77A73]/10 border border-[#E77A73]/20 rounded-2xl p-4 flex items-center gap-3 text-[#212529] shadow-minimal">
          <AlertCircle className="w-5 h-5 text-[#E77A73] shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Success Notification */}
      {encryptionSuccess && successMessage && (
        <div className="bg-[#4ADE80]/10 border border-[#4ADE80]/20 rounded-2xl p-4 sm:p-5 space-y-3 text-[#212529] shadow-minimal animate-fadeIn">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-[#16A34A] shrink-0" />
              <div>
                <p className="text-sm font-bold text-[#212529]">{successMessage}</p>
                <p className="text-xs text-[#757575] mt-0.5">
                  File is securely locked with AES-256-GCM and saved to your local on-device vault.
                </p>
              </div>
            </div>

            {lastEncryptedFile && (
              <a
                href={lastEncryptedFile.downloadUrl}
                download={lastEncryptedFile.fileName}
                className="px-5 py-2.5 bg-[#4ADE80] hover:bg-[#3ec470] text-[#14532D] font-bold text-xs rounded-full shadow-minimal transition-all flex items-center gap-2 shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>Download Encrypted Document</span>
              </a>
            )}
          </div>

          {lastEncryptedFile?.crops && lastEncryptedFile.crops.length > 0 && (
            <div className="pt-3 border-t border-black/5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-[#212529] font-mono flex items-center gap-1">
                <Scissors className="w-3.5 h-3.5 text-[#9C8DD4]" />
                <span>Download Hidden Slices Separately:</span>
              </span>
              {lastEncryptedFile.crops.map((crop, idx) => (
                <a
                  key={idx}
                  href={crop.downloadUrl}
                  download={crop.fileName}
                  className="px-3 py-1 bg-white hover:bg-[#FAF9F6] text-[#212529] text-xs font-semibold rounded-full border border-black/10 shadow-minimal flex items-center gap-1.5 transition-all"
                  title={`Download isolated ${crop.label} slice`}
                >
                  <Download className="w-3 h-3 text-[#9C8DD4]" />
                  <span>{crop.label}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 🎨 Top Canva-Style Studio Header */}
      <div className="bg-white border border-black/5 rounded-3xl p-4 sm:p-5 shadow-minimal flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 flex items-center justify-center text-[#9C8DD4] shadow-minimal">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#212529] tracking-tight">
                Privora Studio
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#FAF9F6] border border-black/5 text-[#757575]">
                {currentFile ? currentFile.name : 'Design & Privacy Workspace'}
              </span>
            </div>
            <p className="text-xs text-[#757575] flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
              <span>100% On-Device WebAssembly Sandbox · 0.00B egress</span>
            </p>
          </div>
        </div>

        {/* Quick Action CTA */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsVideoModalOpen(true)}
            className="px-3.5 py-2 bg-[#9C8DD4]/15 hover:bg-[#9C8DD4]/25 text-[#6D5BA8] text-xs font-semibold rounded-full border border-[#9C8DD4]/30 shadow-minimal transition-all flex items-center gap-1.5 cursor-pointer"
            title="Watch live project demonstration video"
          >
            <Play className="w-3.5 h-3.5 fill-[#6D5BA8]" />
            <span>Watch Demo</span>
          </button>
          {currentFile && (
            <button
              onClick={() => {
                setSidePanelTab('export');
                setIsSidePanelOpen(true);
              }}
              className="px-4 py-2 bg-[#A99DD8] hover:bg-[#8A7BC7] text-white text-xs font-semibold rounded-full shadow-minimal hover:shadow-purple-glow transition-all flex items-center gap-2"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Export & Protect</span>
            </button>
          )}
          <button
            onClick={() => setIsSidePanelOpen(!isSidePanelOpen)}
            className="p-2 bg-[#FAF9F6] hover:bg-[#E2E1E6] text-[#212529] rounded-full border border-black/5 text-xs font-medium transition-all shadow-minimal"
            title={isSidePanelOpen ? 'Collapse Tools Panel' : 'Open Tools Panel'}
          >
            {isSidePanelOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 🖥️ Main Canva-Style Studio Shell */}
      <div className="bg-white rounded-3xl border border-black/5 shadow-minimal overflow-hidden flex flex-col md:flex-row min-h-[720px]">
        {/* 1. Left Icon Rail (Canva Style) */}
        <div className="w-full md:w-20 bg-[#FAF9F6] border-b md:border-b-0 md:border-r border-black/5 flex flex-row md:flex-col items-center justify-around md:justify-start py-3 md:py-5 gap-2 shrink-0 select-none">
          {(
            [
              { id: 'uploads' as const, label: 'Upload', icon: UploadCloud },
              { id: 'templates' as const, label: 'Templates', icon: LayoutTemplate },
              { id: 'redaction' as const, label: 'Redact', icon: EyeOff, badge: detection?.detectedItems.length },
              { id: 'synthetic' as const, label: 'Synthetic', icon: Sparkles, badge: syntheticMappings.length },
              { id: 'ai' as const, label: 'AI Agent', icon: Brain },
              { id: 'export' as const, label: 'Export', icon: Lock },
            ] as Array<{
              id: 'uploads' | 'templates' | 'redaction' | 'synthetic' | 'ai' | 'export';
              label: string;
              icon: React.ElementType;
              badge?: number;
            }>
          ).map((tab) => {
            const Icon = tab.icon;
            const isActive = sidePanelTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setSidePanelTab(tab.id);
                  setIsSidePanelOpen(true);
                }}
                className={`flex flex-col items-center justify-center w-14 h-14 rounded-2xl transition-all relative ${
                  isActive
                    ? 'bg-white text-[#9C8DD4] shadow-minimal border border-black/5 font-bold'
                    : 'text-[#757575] hover:text-[#212529] hover:bg-[#E2E1E6]/60'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-[#9C8DD4]' : 'text-[#757575]'}`} />
                <span className="text-[10px] mt-1 font-medium">{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#9C8DD4] text-white text-[9px] font-bold flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 2. Side Flyout Panel (Canva Drawer) */}
        {isSidePanelOpen && (
          <div className="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-black/5 bg-white flex flex-col shrink-0 overflow-y-auto max-h-[820px] transition-all">
            {/* Drawer Header */}
            <div className="p-4 border-b border-black/5 flex items-center justify-between">
              <span className="text-xs font-bold text-[#212529] uppercase tracking-wider">
                {sidePanelTab === 'uploads' && 'Upload Files'}
                {sidePanelTab === 'templates' && 'Document Templates'}
                {sidePanelTab === 'redaction' && 'Privacy Redaction'}
                {sidePanelTab === 'synthetic' && 'Synthetic FPE Data'}
                {sidePanelTab === 'ai' && 'WebGPU AI Reasoner'}
                {sidePanelTab === 'export' && 'Export & Crypto'}
              </span>
              <button
                onClick={() => setIsSidePanelOpen(false)}
                className="p-1 hover:bg-[#FAF9F6] text-[#757575] hover:text-[#212529] rounded-lg transition-colors"
                title="Collapse Panel"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Tab Content */}
            <div className="p-4 space-y-4">
              {/* TAB 1: UPLOADS */}
              {sidePanelTab === 'uploads' && (
                <div className="space-y-4">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                      currentFile 
                        ? 'border-[#9C8DD4] bg-[#FAF9F6]' 
                        : 'border-black/10 hover:border-[#9C8DD4] bg-white'
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
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <div className="w-12 h-12 rounded-full bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 flex items-center justify-center text-[#9C8DD4]">
                        <UploadCloud className="w-6 h-6" />
                      </div>
                      <p className="text-xs font-bold text-[#212529]">
                        Click to browse or drop file
                      </p>
                      <p className="text-[10px] text-[#757575]">
                        PDF, PNG, JPG, or TXT
                      </p>
                    </div>
                  </div>

                  {currentFile && (
                    <div className="p-3.5 bg-[#FAF9F6] border border-black/5 rounded-2xl space-y-2">
                      <div className="flex items-center gap-2.5">
                        <FileText className="w-4 h-4 text-[#9C8DD4]" />
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold text-[#212529] truncate">{currentFile.name}</p>
                          <p className="text-[10px] text-[#757575] font-mono">
                            {(currentFile.size / 1024).toFixed(1)} KB · {currentFile.type || 'Document'}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full py-1.5 bg-white hover:bg-[#E2E1E6] text-xs font-medium text-[#212529] rounded-xl border border-black/5 transition-all shadow-minimal"
                      >
                        Change File
                      </button>
                    </div>
                  )}

                  <div className="p-3 bg-white border border-black/5 rounded-2xl space-y-1 text-xs text-[#757575]">
                    <div className="font-bold text-[#212529] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#4ADE80]" />
                      <span>Zero-Cloud Privacy Invariant</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Files are read exclusively into your device's RAM. No backend servers, analytics, or model APIs receive your data.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: TEMPLATES */}
              {sidePanelTab === 'templates' && (
                <div className="space-y-3">
                  <p className="text-xs text-[#757575]">
                    Select a preloaded benchmark document with simulated PII to test perception, mathematical checksums, and cryptographic redaction.
                  </p>

                  <div className="space-y-2.5">
                    {/* Aadhaar Card Graphic Card */}
                    <div
                      onClick={() => handleLoadSample('ID')}
                      className="p-3.5 rounded-2xl border border-black/5 bg-[#FAF9F6] hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-2 group"
                    >
                      <div className="h-1.5 w-full bg-gradient-to-r from-orange-400 via-white to-green-500 rounded-full" />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <UserCheck className="w-4 h-4 text-[#9C8DD4]" />
                          <span className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4]">
                            Indian Aadhaar ID
                          </span>
                        </div>
                        <span className="text-[9px] font-mono bg-white px-2 py-0.5 rounded-full border border-black/5 text-[#757575]">
                          Verhoeff D₅
                        </span>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-black/5 font-mono text-[11px] text-[#757575] flex items-center justify-between">
                        <span>UID: 2345 •••• 0123</span>
                        <span className="text-[#16A34A] font-bold text-[9px]">Valid Checksum</span>
                      </div>
                    </div>

                    {/* PAN Card Graphic Card */}
                    <div
                      onClick={() => handleLoadSample('ID')}
                      className="p-3.5 rounded-2xl border border-black/5 bg-[#FAF9F6] hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-2 group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-[#9C8DD4]" />
                          <span className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4]">
                            Income Tax PAN Card
                          </span>
                        </div>
                        <span className="text-[9px] font-mono bg-white px-2 py-0.5 rounded-full border border-black/5 text-[#757575]">
                          Govt Tax ID
                        </span>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-black/5 font-mono text-[11px] text-[#757575] flex items-center justify-between">
                        <span>PAN: ABCDE1234F</span>
                        <span className="text-[#9C8DD4] font-bold text-[9px]">Regex Match</span>
                      </div>
                    </div>

                    {/* Financial Statement Graphic Card */}
                    <div
                      onClick={() => handleLoadSample('FINANCE')}
                      className="p-3.5 rounded-2xl border border-black/5 bg-[#FAF9F6] hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-2 group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-[#9C8DD4]" />
                          <span className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4]">
                            Financial Statement
                          </span>
                        </div>
                        <span className="text-[9px] font-mono bg-white px-2 py-0.5 rounded-full border border-black/5 text-[#757575]">
                          Luhn Mod-10
                        </span>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-black/5 font-mono text-[11px] text-[#757575] flex items-center justify-between">
                        <span>Card: 4532 •••• 1825</span>
                        <span className="text-[#16A34A] font-bold text-[9px]">PCI-DSS</span>
                      </div>
                    </div>

                    {/* API Secrets Graphic Card */}
                    <div
                      onClick={() => handleLoadSample('CODE')}
                      className="p-3.5 rounded-2xl border border-black/5 bg-[#FAF9F6] hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-2 group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <FileCode className="w-4 h-4 text-[#9C8DD4]" />
                          <span className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4]">
                            Cloud API & Secrets
                          </span>
                        </div>
                        <span className="text-[9px] font-mono bg-white px-2 py-0.5 rounded-full border border-black/5 text-[#757575]">
                          Shannon Entropy
                        </span>
                      </div>
                      <div className="p-2 bg-[#212529] text-white rounded-xl font-mono text-[10px] truncate">
                        const OPENAI_KEY = "sk-proj-..."
                      </div>
                    </div>

                    {/* Photo + Geotag Graphic Card */}
                    <div
                      onClick={() => handleLoadSample('PHOTO')}
                      className="p-3.5 rounded-2xl border border-black/5 bg-[#FAF9F6] hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-2 group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-[#9C8DD4]" />
                          <span className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4]">
                            Photo + EXIF Geotag
                          </span>
                        </div>
                        <span className="text-[9px] font-mono bg-white px-2 py-0.5 rounded-full border border-black/5 text-[#757575]">
                          GPS Stripper
                        </span>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-black/5 font-mono text-[11px] text-[#757575] flex items-center justify-between">
                        <span>📍 28.6139° N, 77.2090° E</span>
                        <span className="text-[#9C8DD4] font-bold text-[9px]">Neutralized</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: REDACTION */}
              {sidePanelTab === 'redaction' && (
                <div className="space-y-4">
                  {/* Mode Selector */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-[#757575] uppercase tracking-wider">
                      Preview Mode:
                    </span>
                    <div className="grid grid-cols-3 gap-1 bg-[#E2E1E6]/70 p-1 rounded-xl border border-black/5">
                      <button
                        onClick={() => setPreviewMode('ORIGINAL')}
                        className={`py-1 text-xs font-medium rounded-lg transition-all ${
                          previewMode === 'ORIGINAL'
                            ? 'bg-white text-[#212529] font-bold shadow-minimal'
                            : 'text-[#757575] hover:text-[#212529]'
                        }`}
                      >
                        Original
                      </button>
                      <button
                        onClick={() => setPreviewMode('BLURRED_REGIONS')}
                        className={`py-1 text-xs font-medium rounded-lg transition-all ${
                          previewMode === 'BLURRED_REGIONS'
                            ? 'bg-[#9C8DD4] text-white font-bold shadow-minimal'
                            : 'text-[#757575] hover:text-[#212529]'
                        }`}
                      >
                        Masked
                      </button>
                      <button
                        onClick={() => setPreviewMode('SYNTHETIC_DATA')}
                        className={`py-1 text-xs font-medium rounded-lg transition-all ${
                          previewMode === 'SYNTHETIC_DATA'
                            ? 'bg-[#4ADE80] text-[#14532D] font-bold shadow-minimal'
                            : 'text-[#757575] hover:text-[#212529]'
                        }`}
                      >
                        Synthetic
                      </button>
                    </div>
                  </div>

                  {/* Quick Blur Helpers */}
                  {decision?.fileCategory === 'GOVERNMENT_ID' && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold text-[#757575] uppercase tracking-wider">
                        Quick Add Masks:
                      </span>
                      <div className="flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleAddIdRegions('DEMOGRAPHIC')}
                          className="w-full py-1.5 px-3 bg-[#FAF9F6] hover:bg-[#E2E1E6] text-[#212529] text-xs font-medium rounded-xl border border-black/5 transition-all text-left shadow-minimal flex items-center justify-between"
                        >
                          <span>+ Blur Demographic (Name/DOB)</span>
                          <span className="text-[10px] text-[#9C8DD4] font-bold">Auto</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddIdRegions('QR_CODE')}
                          className="w-full py-1.5 px-3 bg-[#FAF9F6] hover:bg-[#E2E1E6] text-[#212529] text-xs font-medium rounded-xl border border-black/5 transition-all text-left shadow-minimal flex items-center justify-between"
                        >
                          <span>+ Blur QR Matrix</span>
                          <span className="text-[10px] text-[#9C8DD4] font-bold">Auto</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Discovered Entities List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-[#757575] uppercase tracking-widest">
                        Detected Entities ({detection?.detectedItems.length || 0})
                      </span>
                      {detection && detection.detectedItems.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearAllRegions}
                          className="text-[10px] text-[#757575] hover:text-[#E77A73] font-mono transition-colors"
                        >
                          Clear All
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                      {!detection || detection.detectedItems.length === 0 ? (
                        <p className="text-xs text-[#757575] italic">
                          No entities detected yet. Drag on the canvas to draw custom boxes!
                        </p>
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
                              className={`p-2 rounded-xl border text-xs font-mono flex items-center justify-between cursor-pointer transition-all ${
                                isSelected
                                  ? 'bg-[#FAF9F6] border-[#9C8DD4] text-[#212529] ring-1 ring-[#9C8DD4]/40 font-bold shadow-minimal'
                                  : 'bg-[#FAF9F6] text-[#212529] border-black/5 hover:border-[#9C8DD4]'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate max-w-[175px]">
                                {isLocalAi ? (
                                  <Bot className="w-3.5 h-3.5 text-[#9C8DD4] shrink-0" />
                                ) : (
                                  <ShieldAlert className="w-3.5 h-3.5 text-[#9C8DD4] shrink-0" />
                                )}
                                <span className="truncate">{item.label}</span>
                                {item.boundingBox?.boxConfidence === 'ESTIMATED' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleVerifyEstimatedBox(item.id);
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold shrink-0 ${
                                      item.boundingBox.boxVerified
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-800 animate-pulse hover:bg-amber-200'
                                    }`}
                                    title={item.boundingBox.boxVerified ? "Position verified" : "Click to verify estimated position"}
                                  >
                                    {item.boundingBox.boxVerified ? '✓ Verified' : '⚠️ Verify'}
                                  </button>
                                )}
                                {item.boundingBox?.boxConfidence === 'MISSING' && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-100 text-red-800 font-sans font-bold shrink-0">
                                    No Box
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleScaleRegion(item.id, 0.15);
                                  }}
                                  className="px-1 text-[#757575] hover:text-[#212529] hover:bg-[#E2E1E6] rounded font-bold text-[10px]"
                                  title="Expand +15%"
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleScaleRegion(item.id, -0.15);
                                  }}
                                  className="px-1 text-[#757575] hover:text-[#212529] hover:bg-[#E2E1E6] rounded font-bold text-[10px]"
                                  title="Shrink -15%"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteRegion(item.id);
                                  }}
                                  className="text-[#757575] hover:text-[#E77A73] p-0.5 rounded transition-colors ml-0.5"
                                  title="Remove"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Selected Region Drawer */}
                  {selectedItemId && detection?.detectedItems.some(i => i.id === selectedItemId) && (() => {
                    const selectedItem = detection.detectedItems.find(i => i.id === selectedItemId)!;
                    const mapping = syntheticMappings.find(m => m.id === selectedItemId);
                    const currentSynVal = mapping ? mapping.syntheticValue : '';

                    return (
                      <div className="p-3.5 rounded-2xl bg-[#FAF9F6] border border-black/5 space-y-2.5 animate-fadeIn shadow-minimal">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-[#9C8DD4] uppercase tracking-wider">
                            Selected Region
                          </span>
                          <span className="text-xs font-bold text-[#212529] truncate max-w-[150px]">
                            {selectedItem.label}
                          </span>
                        </div>

                        {/* Quick Type Chips */}
                        <div className="space-y-1">
                          <span className="text-[10px] text-[#757575]">Assign Field Type:</span>
                          <div className="flex flex-wrap gap-1">
                            {([
                              { type: 'AADHAAR', label: '🪪 Aadhaar' },
                              { type: 'PAN_CARD', label: '💳 PAN' },
                              { type: 'FACE', label: '👤 Face' },
                              { type: 'DOB', label: '📅 DOB' },
                              { type: 'EMAIL', label: '✉️ Email' },
                              { type: 'CREDIT_CARD', label: '💳 Card' },
                              { type: 'API_KEY', label: '🔑 Secret' },
                              { type: 'CUSTOM', label: '🏷️ Custom' },
                            ] as { type: PiiType; label: string }[]).map(t => (
                              <button
                                key={t.type}
                                type="button"
                                onClick={() => handleUpdateItemType(selectedItemId, t.type)}
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-all ${
                                  selectedItem.type === t.type
                                    ? 'bg-[#9C8DD4] text-white border-[#9C8DD4]'
                                    : 'bg-white text-[#757575] border-black/5 hover:bg-[#E2E1E6]'
                                }`}
                              >
                                {t.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Mock Value Input */}
                        {selectedItem.type !== 'FACE' && (
                          <div className="space-y-1">
                            <span className="text-[10px] text-[#757575]">Synthetic Replacement:</span>
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={currentSynVal}
                                onChange={(e) => handleUpdateSyntheticValue(selectedItemId, e.target.value)}
                                placeholder="Enter custom mock data..."
                                className="flex-1 px-3 py-1.5 bg-white border border-black/10 rounded-xl text-xs font-mono text-[#212529] focus:outline-none focus:ring-2 focus:ring-[#9C8DD4]/40 shadow-inner"
                              />
                              <button
                                type="button"
                                onClick={() => handleRegenerateSyntheticValue(selectedItemId)}
                                className="px-2.5 py-1.5 bg-white hover:bg-[#FAF9F6] text-[#212529] border border-black/10 rounded-xl text-xs font-semibold shadow-minimal shrink-0"
                                title="Generate New Mock"
                              >
                                🎲
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* TAB 4: SYNTHETIC FPE */}
              {sidePanelTab === 'synthetic' && (
                <div className="space-y-3.5">
                  <div className="p-3 bg-[#FAF9F6] border border-black/5 rounded-2xl space-y-1">
                    <span className="text-xs font-bold text-[#212529] flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#9C8DD4]" />
                      <span>Format-Preserving Encryption</span>
                    </span>
                    <p className="text-[11px] text-[#757575] leading-relaxed">
                      Replaces sensitive PII with synthetically valid mock data that preserves formatting and satisfies mathematical checksums (Verhoeff D₅, Luhn Mod-10).
                    </p>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-[#757575] uppercase tracking-widest">
                      Active Synthetic Mappings ({syntheticMappings.length})
                    </span>

                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                      {syntheticMappings.length === 0 ? (
                        <p className="text-xs text-[#757575] italic">
                          No entities detected yet. Once a document is scanned, synthetic replacements appear here.
                        </p>
                      ) : (
                        syntheticMappings.map((map, idx) => (
                          <div key={map.id || idx} className="p-2.5 bg-[#FAF9F6] rounded-xl border border-black/5 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] font-bold text-[#757575] uppercase">
                                {map.type.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#4ADE80]/20 text-[#14532D] font-mono">
                                {map.checksumAlgorithm === 'VERHOEFF_D5'
                                  ? '✓ Verhoeff D₅'
                                  : map.checksumAlgorithm === 'LUHN_MOD10'
                                  ? '✓ Luhn Mod-10'
                                  : '✓ Valid Format'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <span className="text-[#757575] line-through truncate max-w-[100px]">{map.originalValue}</span>
                              <span className="text-[#757575]">➔</span>
                              <span className="text-[#14532D] font-bold truncate">{map.syntheticValue}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: AI AGENT */}
              {sidePanelTab === 'ai' && (
                <div className="space-y-4">
                  {/* WebGPU Status Card */}
                  <div className="p-3.5 bg-[#FAF9F6] border border-black/5 rounded-2xl space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-[#9C8DD4]" />
                        <span className="text-xs font-bold text-[#212529]">Local WebGPU AI</span>
                      </div>
                      {aiHardwareInfo?.hasWebGpu ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#4ADE80]/15 text-[#14532D] font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-pulse" />
                          WebGPU Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#E2E1E6] text-[#212529] font-mono">
                          <Cpu className="w-2.5 h-2.5 text-[#9C8DD4]" />
                          WASM Engine
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleRunDeepAiScan}
                      disabled={isAiScanning || isScanning}
                      className={`w-full py-2.5 px-3 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-1.5 shadow-minimal ${
                        deepAiRan
                          ? 'bg-white hover:bg-[#E2E1E6] text-[#212529] border border-black/5'
                          : 'bg-[#A99DD8] hover:bg-[#8A7BC7] text-white hover:shadow-purple-glow'
                      } disabled:opacity-50`}
                    >
                      {isAiScanning ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Analyzing Context...</span>
                        </>
                      ) : deepAiRan ? (
                        <>
                          <CheckCircle className="w-3.5 h-3.5 text-[#16A34A]" />
                          <span>Deep Scan Complete (Re-run)</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-white" />
                          <span>Run Deep Context Scan</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Risk Score */}
                  {decision && (
                    <div className="p-3.5 bg-[#FAF9F6] border border-black/5 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[#757575] uppercase tracking-widest">
                          Risk Score:
                        </span>
                        <span className={`text-sm font-bold font-mono ${
                          decision.riskScore >= 70 ? 'text-[#E77A73]' : decision.riskScore >= 40 ? 'text-amber-600' : 'text-[#16A34A]'
                        }`}>
                          {decision.riskScore}/100 {decision.riskScore >= 70 ? 'HIGH' : decision.riskScore >= 40 ? 'MED' : 'LOW'}
                        </span>
                      </div>
                      <div className="w-full bg-[#E2E1E6] h-1.5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${
                            decision.riskScore >= 70 ? 'bg-[#E77A73]' : decision.riskScore >= 40 ? 'bg-amber-400' : 'bg-[#4ADE80]'
                          }`}
                          style={{ width: `${Math.max(5, Math.min(100, decision.riskScore))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Agent Rationale */}
                  {decision && (
                    <div className="p-3.5 bg-[#FAF9F6] border border-black/5 rounded-2xl space-y-2">
                      <span className="text-[10px] font-bold text-[#757575] uppercase tracking-widest">
                        Legal Rationale:
                      </span>
                      <p className="text-xs text-[#757575] leading-relaxed">
                        {decision.explanation}
                      </p>
                      {decision.complianceTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {decision.complianceTags.map((tag, i) => (
                            <span key={i} className="px-2 py-0.5 bg-white text-[#212529] text-[9px] font-semibold rounded-full border border-black/5 font-mono">
                              {tag.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 6: EXPORT */}
              {sidePanelTab === 'export' && (
                <div className="space-y-4">
                  {/* Action Directives */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-[#757575] uppercase tracking-widest">
                      Action Directive:
                    </span>
                    <div className="grid grid-cols-1 gap-1.5">
                      {(['ENCRYPT_REGION', 'ENCRYPT_FULL', 'SYNTHETIC_REPLACE', 'REDACT_METADATA', 'NO_ACTION'] as AgentAction[]).map((act) => (
                        <button
                          key={act}
                          onClick={() => handleOverrideAction(act)}
                          className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                            selectedAction === act
                              ? 'bg-white border-2 border-[#9C8DD4] text-[#212529] font-bold shadow-minimal ring-1 ring-[#9C8DD4]/30'
                              : 'bg-[#FAF9F6] border-black/5 text-[#757575] hover:text-[#212529]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>{act === 'SYNTHETIC_REPLACE' ? '🎭 ' : ''}{act.replace(/_/g, ' ')}</span>
                            {decision?.action === act && (
                              <span className="text-[9px] bg-[#9C8DD4]/20 text-[#9C8DD4] px-2 py-0.5 rounded-full font-bold">
                                Recommended
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Execute Button */}
                  <button
                    onClick={handleExecuteEncryption}
                    disabled={isEncrypting || !selectedAction}
                    className="w-full py-3 bg-[#A99DD8] hover:bg-[#8A7BC7] disabled:opacity-50 text-white font-bold rounded-full text-xs shadow-minimal hover:shadow-purple-glow transition-all flex items-center justify-center gap-2"
                  >
                    {isEncrypting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Locking in Vault...</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        <span>Confirm & Lock Document</span>
                      </>
                    )}
                  </button>

                  {/* Download links */}
                  {encryptionSuccess && lastEncryptedFile && (
                    <a
                      href={lastEncryptedFile.downloadUrl}
                      download={lastEncryptedFile.fileName}
                      className="w-full py-2.5 bg-[#4ADE80] hover:bg-[#3ec470] text-[#14532D] font-bold rounded-full text-xs shadow-minimal transition-all flex items-center justify-center gap-2 text-center"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Encrypted File</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. Center Document Stage (Canva Workspace Canvas) */}
        <div className="flex-1 flex flex-col bg-[#FAF9F6] p-4 sm:p-6 overflow-hidden min-w-0 relative">
          {/* Top Stage Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-black/5">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-bold text-[#212529]">
                {currentFile ? currentFile.name : 'Interactive Privacy Stage'}
              </span>
              {currentFile && (
                <span className="px-2 py-0.5 bg-white border border-black/5 rounded-full text-[10px] font-mono text-[#757575]">
                  {(currentFile.size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>

            {/* Multi-Page Navigation for PDFs */}
            {detection?.pages && detection.pages.length > 1 && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-white border border-black/5 rounded-full shadow-minimal">
                <button
                  type="button"
                  disabled={currentPageIndex === 0}
                  onClick={() => handlePageChange(currentPageIndex - 1)}
                  className="px-2 py-0.5 text-xs font-bold rounded-full text-[#757575] hover:text-[#212529] disabled:opacity-30"
                >
                  ◀
                </button>
                <span className="text-xs font-bold text-[#212529] font-mono px-1 flex items-center gap-1.5">
                  <span>Page {currentPageIndex + 1} / {detection.pages.length}</span>
                  {detection.detectedItems.some(i => (i.pageNumber === currentPageIndex + 1 || (!i.pageNumber && currentPageIndex === 0)) && !!i.boundingBox) ? (
                    <span className="text-[10px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] px-1.5 py-0.5 rounded-full font-bold">
                      🔒 Masked
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#9ca3af]">✓ Clean</span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={currentPageIndex === detection.pages.length - 1}
                  onClick={() => handlePageChange(currentPageIndex + 1)}
                  className="px-2 py-0.5 text-xs font-bold rounded-full text-[#757575] hover:text-[#212529] disabled:opacity-30"
                >
                  ▶
                </button>
              </div>
            )}

            {/* Stage Mode Switcher (if preview available) */}
            {previewImageUrl && (
              <div className="flex items-center gap-1 bg-white p-1 rounded-full border border-black/5 shadow-minimal">
                <button
                  onClick={() => setPreviewMode('ORIGINAL')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                    previewMode === 'ORIGINAL'
                      ? 'bg-[#9C8DD4] text-white font-bold'
                      : 'text-[#757575] hover:text-[#212529]'
                  }`}
                >
                  Original
                </button>
                <button
                  onClick={() => setPreviewMode('BLURRED_REGIONS')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                    previewMode === 'BLURRED_REGIONS'
                      ? 'bg-[#9C8DD4] text-white font-bold'
                      : 'text-[#757575] hover:text-[#212529]'
                  }`}
                >
                  Masked
                </button>
                <button
                  onClick={() => setPreviewMode('SYNTHETIC_DATA')}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                    previewMode === 'SYNTHETIC_DATA'
                      ? 'bg-[#4ADE80] text-[#14532D] font-bold'
                      : 'text-[#757575] hover:text-[#212529]'
                  }`}
                >
                  🎭 Synthetic
                </button>
              </div>
            )}
          </div>

          {/* Stage Viewport */}
          <div className="flex-1 flex flex-col items-center justify-center overflow-auto min-h-[460px]">
            {isScanning ? (
              <div className="p-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-[#9C8DD4] animate-spin mx-auto" />
                <p className="text-sm font-bold text-[#212529]">
                  {aiModelProgress || 'Analyzing Document Locally...'}
                </p>
                <p className="text-xs text-[#757575]">
                  Executing Tesseract WASM OCR, Face Detector, and Verhoeff/Luhn Checksums
                </p>
              </div>
            ) : previewImageUrl ? (
              <div className="space-y-3 w-full flex flex-col items-center">
                {/* PDF Page Strip with Highlighted Encryption Status */}
                {detection?.pages && detection.pages.length > 1 && (
                  <div className="w-full max-w-2xl px-3 py-2 bg-white/95 backdrop-blur border border-black/8 rounded-2xl flex flex-wrap items-center justify-between gap-2 shadow-minimal">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-bold text-[#757575] font-mono uppercase tracking-wider mr-1">
                        PDF Pages:
                      </span>
                      {detection.pages.map((p, pIdx) => {
                        const count = detection.detectedItems.filter(
                          i => (i.pageNumber === p.pageNumber || (!i.pageNumber && p.pageNumber === 1)) && !!i.boundingBox
                        ).length;
                        const isEncrypted = count > 0;
                        const isCurrent = currentPageIndex === pIdx;
                        return (
                          <button
                            key={p.pageNumber}
                            type="button"
                            onClick={() => handlePageChange(pIdx)}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-mono font-bold transition-all ${
                              isCurrent
                                ? 'bg-[#212529] text-white shadow-minimal ring-2 ring-[#9C8DD4]'
                                : isEncrypted
                                ? 'bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0] hover:bg-[#D1FAE5]'
                                : 'bg-[#FAF9F6] text-[#757575] border border-black/5 hover:border-black/20'
                            }`}
                            title={`Switch to Page ${p.pageNumber} (${isEncrypted ? `${count} items encrypted` : 'Clean page'})`}
                          >
                            <span>Page {p.pageNumber}</span>
                            {isEncrypted ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#047857] text-white font-extrabold flex items-center gap-0.5">
                                🔒 {count}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9ca3af]">✓ Clean</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="text-[11px] font-mono text-[#757575] flex items-center gap-1">
                      <span>Encrypted:</span>
                      <span className="font-bold text-[#047857]">
                        {detection.pages.filter(p => detection.detectedItems.some(i => (i.pageNumber === p.pageNumber || (!i.pageNumber && p.pageNumber === 1)) && !!i.boundingBox)).length} / {detection.pages.length} Pages
                      </span>
                    </div>
                  </div>
                )}

                <div 
                  className="relative rounded-2xl overflow-hidden bg-[#212529] border border-black/5 flex items-center justify-center max-w-full select-none shadow-minimal"
                  style={{ cursor: canvasCursor }}
                >
                  <canvas 
                    ref={canvasRef} 
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    className="max-w-full max-h-[520px] object-contain rounded-xl"
                  />
                </div>
                <p className="text-[11px] text-[#757575] font-mono text-center">
                  💡 Drag on canvas to draw new redaction masks. Click any box to inspect & resize.
                </p>
              </div>
            ) : (
              /* When NO file is loaded: Working Video Demo & 3D Sandbox */
              <div className="w-full max-w-3xl text-center space-y-5 py-4">
                
                {/* Switcher Pill: Video Demo vs 3D Model */}
                <div className="inline-flex items-center p-1 bg-[#FAF9F6] border border-black/5 rounded-full shadow-inner">
                  <button
                    onClick={() => setEmptyStageTab('video')}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      emptyStageTab === 'video'
                        ? 'bg-white text-[#212529] shadow-minimal border border-black/5'
                        : 'text-[#757575] hover:text-[#212529]'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-[#9C8DD4] text-[#9C8DD4]" />
                    <span>Watch Working Demo</span>
                  </button>
                  <button
                    onClick={() => setEmptyStageTab('3d')}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                      emptyStageTab === '3d'
                        ? 'bg-white text-[#212529] shadow-minimal border border-black/5'
                        : 'text-[#757575] hover:text-[#212529]'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#9C8DD4]" />
                    <span>3D Cryptographic Core</span>
                  </button>
                </div>

                {/* Display either the video player or 3D sandbox */}
                {emptyStageTab === 'video' ? (
                  <div className="relative w-full rounded-3xl overflow-hidden shadow-minimal border border-black/5 bg-black/95 aspect-video max-h-[380px] flex items-center justify-center group mx-auto">
                    <video
                      src="/working.mp4"
                      controls
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full object-contain rounded-3xl"
                    />
                    <div className="absolute top-3 left-3 pointer-events-none">
                      <span className="px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-black/60 backdrop-blur-md text-white border border-white/20 flex items-center gap-1.5 shadow-minimal">
                        <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
                        Privora In Action · On-Device Zero Egress
                      </span>
                    </div>
                  </div>
                ) : (
                  <ThreeStudioModel className="w-full h-56 sm:h-64" badgeText="Interactive 3D Cryptographic Sandbox" />
                )}

                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold text-[#212529] tracking-tight">
                    On-Device Neural Redaction & Envelope Cryptography
                  </h3>
                  <p className="text-xs text-[#757575] max-w-md mx-auto">
                    Upload your own photo or document below, or select a pre-loaded benchmark scenario from the left tool panel to visually redact and cryptographically protect.
                  </p>
                </div>

                {/* Primary Upload CTA Button */}
                <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#A99DD8] hover:bg-[#8A7BC7] text-white font-bold text-xs shadow-minimal hover:shadow-purple-glow transition-all cursor-pointer"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>Upload Photo or Document</span>
                  </button>
                  <button
                    onClick={() => {
                      setSidePanelTab('templates');
                      setIsSidePanelOpen(true);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white hover:bg-[#FAF9F6] text-[#212529] font-semibold text-xs border border-black/5 shadow-minimal transition-all cursor-pointer"
                  >
                    <LayoutTemplate className="w-4 h-4 text-[#9C8DD4]" />
                    <span>Browse Templates</span>
                  </button>
                </div>

                {/* Visual Quick-Start Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2">
                  <div
                    onClick={() => handleLoadSample('ID')}
                    className="p-3 bg-white rounded-2xl border border-black/5 hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-1 text-left group"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#9C8DD4]/15 flex items-center justify-center text-[#9C8DD4]">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4] mt-1">Aadhaar & PAN</p>
                    <p className="text-[10px] text-[#757575]">Verhoeff D₅ Check</p>
                  </div>

                  <div
                    onClick={() => handleLoadSample('FINANCE')}
                    className="p-3 bg-white rounded-2xl border border-black/5 hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-1 text-left group"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#9C8DD4]/15 flex items-center justify-center text-[#9C8DD4]">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4] mt-1">Invoice</p>
                    <p className="text-[10px] text-[#757575]">Luhn Mod-10 Check</p>
                  </div>

                  <div
                    onClick={() => handleLoadSample('CODE')}
                    className="p-3 bg-white rounded-2xl border border-black/5 hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-1 text-left group"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#9C8DD4]/15 flex items-center justify-center text-[#9C8DD4]">
                      <FileCode className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4] mt-1">API Secrets</p>
                    <p className="text-[10px] text-[#757575]">Shannon Entropy</p>
                  </div>

                  <div
                    onClick={() => handleLoadSample('PHOTO')}
                    className="p-3 bg-white rounded-2xl border border-black/5 hover:border-[#9C8DD4] hover:shadow-minimal cursor-pointer transition-all space-y-1 text-left group"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#9C8DD4]/15 flex items-center justify-center text-[#9C8DD4]">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-bold text-[#212529] group-hover:text-[#9C8DD4] mt-1">Photo Geotag</p>
                    <p className="text-[10px] text-[#757575]">EXIF Neutralizer</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 🌟 Safety & Hardware Telemetry Bento Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-minimal">
          <div className="flex items-center gap-2 text-[#9C8DD4]">
            <Brain className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">On-Device SLM</span>
          </div>
          <p className="text-xs font-bold text-[#212529] mt-1">DistilBERT ONNX</p>
          <p className="text-[11px] text-[#757575]">66M Params · WebAssembly SIMD</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-minimal">
          <div className="flex items-center gap-2 text-[#9C8DD4]">
            <Scan className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Perception AI</span>
          </div>
          <p className="text-xs font-bold text-[#212529] mt-1">LSTM OCR & Biometrics</p>
          <p className="text-[11px] text-[#757575]">Tesseract WASM + Face Worker</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-minimal">
          <div className="flex items-center gap-2 text-[#4ADE80]">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Zero-Cloud Vault</span>
          </div>
          <p className="text-xs font-bold text-[#212529] mt-1">AES-256-GCM Envelope</p>
          <p className="text-[11px] text-[#757575]">WebAuthn PRF Hardware Key</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-minimal">
          <div className="flex items-center gap-2 text-[#9C8DD4]">
            <Sparkles className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Math Guarantees</span>
          </div>
          <p className="text-xs font-bold text-[#212529] mt-1">Dihedral D₅ & Luhn</p>
          <p className="text-[11px] text-[#757575]">Zero False Positive Checksums</p>
        </div>
      </div>

      {/* 🎬 Working Demo Video Modal */}
      {isVideoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white border border-black/10 rounded-3xl max-w-4xl w-full p-5 sm:p-6 text-[#212529] shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-black/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 flex items-center justify-center text-[#7C6CB0]">
                  <Play className="w-4 h-4 fill-[#7C6CB0]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#212529]">Privora Live Working Demonstration</h3>
                  <p className="text-xs text-[#757575]">Watch 100% on-device neural redaction, checksum verification, and AES-256 encryption</p>
                </div>
              </div>
              <button
                onClick={() => setIsVideoModalOpen(false)}
                className="text-[#757575] hover:text-[#212529] p-2 rounded-xl hover:bg-black/5 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-black/10 shadow-inner">
              <video
                src="/working.mp4"
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[#757575]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
                <span className="font-medium text-[#212529]">Local Self-Contained Video</span>
                <span>· No streaming server or third-party telemetry</span>
              </div>
              <button
                onClick={() => setIsVideoModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-[#E2E1E6] hover:bg-black/10 text-[#212529] font-semibold transition-colors cursor-pointer"
              >
                Close Video
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
