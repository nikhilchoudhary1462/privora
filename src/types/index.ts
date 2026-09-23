export interface BoundingBox {
  x: number;      // fraction 0..1 or pixel coordinate
  y: number;
  width: number;
  height: number;
  label?: string;
  isNormalized?: boolean;
}

export type PiiType = 
  | 'FACE'
  | 'PAN_CARD'
  | 'AADHAAR'
  | 'PASSPORT'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'EMAIL'
  | 'PHONE'
  | 'API_KEY'
  | 'BANK_ACCOUNT'
  | 'EXIF_GPS'
  | 'EXIF_DEVICE'
  | 'DOB'
  | 'MEDICAL_CONDITION'
  | 'TRADE_SECRET'
  | 'ORGANIZATION'
  | 'LEGAL_CLAUSE'
  | 'CUSTOM';

export type ComplianceStandard = 
  | 'DPDP_INDIA'   // Digital Personal Data Protection Act 2023
  | 'GDPR'         // General Data Protection Regulation
  | 'HIPAA'        // Health Insurance Portability and Accountability Act
  | 'PCI_DSS'      // Payment Card Industry Data Security Standard
  | 'IDENTITY_THEFT_PREVENTION';

export type DetectionSource = 'REGEX' | 'OCR' | 'LOCAL_AI' | 'EXIF' | 'FACE_VISION';

export interface DetectedItem {
  id: string;
  type: PiiType;
  label: string;
  value: string;
  confidence: number; // 0..1
  boundingBox?: BoundingBox;
  complianceTags: ComplianceStandard[];
  recommendation: string;
  pageNumber?: number; // 1-indexed for multi-page documents (PDFs, text pages)
  source?: DetectionSource;
}

export interface LocalAiHardwareInfo {
  hasWebGpu: boolean;
  adapterName?: string;
  backend: 'webgpu' | 'wasm' | 'cpu';
  maxComputeWorkgroupSize?: number;
}

export interface LocalAiModelStatus {
  loaded: boolean;
  loading: boolean;
  progressPercent: number;
  statusText: string;
  modelName: string;
  error?: string;
}

export interface ContextualPiiEntity {
  type: PiiType;
  label: string;
  value: string;
  confidence: number;
  explanation: string;
  complianceTags: ComplianceStandard[];
}

export interface ExifData {
  hasGps: boolean;
  isDemoSample?: boolean;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  deviceMake?: string;
  deviceModel?: string;
  software?: string;
  dateTime?: string;
  lensModel?: string;
  rawTags?: Record<string, any>;
}

export interface PdfPageResult {
  pageNumber: number;
  pageImageDataUrl: string;
  detectedItems: DetectedItem[];
  pageDimensions: { width: number; height: number };
  extractedText?: string;
}

export interface DetectionResult {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileHash: string; // SHA-256
  detectedItems: DetectedItem[];
  exif: ExifData;
  extractedText: string;
  imageDimensions?: { width: number; height: number };
  previewDataUrl?: string;
  scanDurationMs: number;
  isDemoSample?: boolean;
  isSensitive?: boolean;
  pages?: PdfPageResult[];
  totalPages?: number;
}

export type FileCategory = 
  | 'GOVERNMENT_ID'
  | 'FINANCIAL_RECORD'
  | 'MEDICAL_RECORD'
  | 'PERSONAL_PHOTO'
  | 'CONFIDENTIAL_DOCUMENT'
  | 'CODE_OR_CREDENTIALS'
  | 'GENERAL_DOCUMENT'
  | 'NON_SENSITIVE_MEDIA';

export type AgentAction = 
  | 'NO_ACTION'
  | 'WARN'
  | 'REDACT_METADATA'
  | 'ENCRYPT_REGION'
  | 'ENCRYPT_FULL'
  | 'SYNTHETIC_REPLACE';

export interface SyntheticEntityMapping {
  id: string;
  type: PiiType;
  label: string;
  originalValue: string;
  syntheticValue: string;
  checksumValidated: boolean;
  checksumAlgorithm?: 'VERHOEFF_D5' | 'LUHN_MOD10' | 'FORMAT_REGEX' | 'SYNTHETIC_PERSONA';
}

export interface AgentDecision {
  fileCategory: FileCategory;
  categoryConfidence: number;
  action: AgentAction;
  riskScore: number; // 0..100
  explanation: string;
  complianceTags: ComplianceStandard[];
  targetRegions: BoundingBox[];
  fallbackApplied: boolean;
  reasoningSteps: string[];
  appliedRuleId?: string;
  syntheticMappings?: SyntheticEntityMapping[];
}

export interface EncryptedRegionRecord {
  box: BoundingBox;
  encryptedDataB64: string;
  ivB64: string;
  tagB64?: string;
  type: PiiType;
  syntheticValue?: string;
  pageNumber?: number;
}

export interface EncryptedFileRecord {
  id: string;
  fileName: string;
  originalMimeType: string;
  originalSize: number;
  isRegionEncrypted: boolean;
  encryptedBlob: Blob | string; // Full ciphertext or base image data URL
  encryptedRegions?: EncryptedRegionRecord[];
  syntheticMappings?: SyntheticEntityMapping[];
  pdfPages?: { pageNumber: number; pageImageDataUrl: string; width: number; height: number }[];
  wrappedDek: string; // Base64 wrapped DEK
  iv: string;         // Base64 IV
  originalHash: string;  // SHA-256 before encryption
  encryptedHash: string; // SHA-256 of encrypted package
  pipelineUsed: 'AES-256-GCM-FULL' | 'AES-256-GCM-SELECTIVE-REGION' | 'REDACTED-METADATA' | 'SYNTHETIC-PSEUDONYMIZED';
  exifStripped: boolean;
  createdAt: number;
  recipientKeyFingerprint?: string;
  metadata: {
    category: FileCategory;
    riskScore: number;
    detectedPiiCount: number;
    explanation: string;
    totalPages?: number;
  };
}

export type AuditEventType = 
  | 'DETECT'
  | 'CLASSIFY'
  | 'POLICY_EVAL'
  | 'ENCRYPT'
  | 'DECRYPT'
  | 'VIEW_MEMORY'
  | 'OVERRIDE'
  | 'SHARE_P2P'
  | 'RECEIVE_P2P'
  | 'ANOMALY_DETECTED'
  | 'TAMPER_ALERT'
  | 'AUTH_UNLOCK'
  | 'POLICY_CREATED'
  | 'LIVE_INPUT_PII_WARNING'
  | 'SYNTHETIC_TRANSFORM';

export type AuditSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER' | 'ALERT';

export interface AuditLogEvent {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  severity: AuditSeverity;
  source: 'WEB_APP' | 'EXTENSION';
  fileId?: string;
  fileName?: string;
  actionTaken: string;
  details: Record<string, any>;
  riskScore?: number;
  tamperDetected?: boolean;
}

export interface PolicyRule {
  id: string;
  naturalLanguage: string;
  condition: {
    categories?: FileCategory[];
    piiTypes?: PiiType[];
    minRiskScore?: number;
    hasGps?: boolean;
  };
  action: AgentAction;
  enabled: boolean;
  createdAt: number;
}

export interface UserOverride {
  id: string;
  fileCategory: FileCategory;
  recommendedAction: AgentAction;
  chosenAction: AgentAction;
  timestamp: number;
  filePiiSummary: string[];
  justification?: string;
  riskScore?: number;
  fileName?: string;
}

export interface AnomalyReport {
  id: string;
  timestamp: number;
  type: 'RAPID_DECRYPTION_BURST' | 'INTEGRITY_TAMPER' | 'WRONG_KEY_ATTEMPT' | 'UNUSUAL_VOLUME' | 'HIGH_RISK_OVERRIDE';
  severity: 'WARNING' | 'CRITICAL';
  description: string;
  metricDetails: Record<string, any>;
  recommendedAction: string;
}
