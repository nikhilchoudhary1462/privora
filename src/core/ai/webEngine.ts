import {
  DetectionResult,
  AgentAction,
  ContextualPiiEntity,
  LocalAiHardwareInfo,
  LocalAiModelStatus,
  PiiType,
  ComplianceStandard,
  DetectedItem,
} from '../../types';

export interface ModelRoutingSuggestion {
  action: AgentAction;
  confidence: number;
  modelName: string;
  rawScores: Record<string, number>;
  compactSummary: Record<string, any>;
}

// Contextual candidate patterns for Deep In-Browser AI Extraction
interface SemanticPattern {
  type: PiiType;
  label: string;
  regex: RegExp;
  confidence: number;
  complianceTags: ComplianceStandard[];
  explanation: string;
}

const CONTEXTUAL_PATTERNS: SemanticPattern[] = [
  // Medical Conditions & Health Data (HIPAA / GDPR Special Category)
  {
    type: 'MEDICAL_CONDITION',
    label: 'Medical Condition / Health Record',
    regex: /(?:diagnosed with|diagnosis|condition|suffering from|patient history of|tested positive for|prescribed|clinical case of|undergoing treatment for|icd-(?:9|10|11):?)\s+([A-Za-z0-9\s-]{3,40}?)(?=[,.;\n]|$)/gi,
    confidence: 0.92,
    complianceTags: ['HIPAA', 'GDPR', 'DPDP_INDIA'],
    explanation: 'Protected Health Information (PHI) identifying medical diagnosis or treatment.',
  },
  {
    type: 'MEDICAL_CONDITION',
    label: 'Prescription & Pharmaceutical Treatment',
    regex: /(?:Rx|Prescription|Dosage|Medication|Injected|Infusion):\s*([A-Za-z0-9\s-]{3,35}\s+\d+\s*(?:mg|mcg|ml|units?))/gi,
    confidence: 0.94,
    complianceTags: ['HIPAA', 'GDPR'],
    explanation: 'Prescription pharmaceutical record subject to strict HIPAA & DPDP safeguards.',
  },

  // Trade Secrets & Proprietary Assets
  {
    type: 'TRADE_SECRET',
    label: 'Proprietary Trade Secret / Internal Asset',
    regex: /(?:CONFIDENTIAL|PROPRIETARY|TRADE SECRET|INTERNAL ONLY|RESTRICTED IP):\s*([^\n\r,;]{4,60})/gi,
    confidence: 0.95,
    complianceTags: ['IDENTITY_THEFT_PREVENTION', 'DPDP_INDIA'],
    explanation: 'Proprietary intellectual property or commercial trade secret requiring strict access restriction.',
  },
  {
    type: 'TRADE_SECRET',
    label: 'Internal Infrastructure / Credentials',
    regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[a-zA-Z0-9_\-\.]+:[a-zA-Z0-9_\-\.@#$%^&*!]+@[a-zA-Z0-9_\-\.]+/gi,
    confidence: 0.98,
    complianceTags: ['IDENTITY_THEFT_PREVENTION', 'PCI_DSS'],
    explanation: 'Direct database connection string exposing administrative database credentials.',
  },

  // High-Risk Legal Clauses & NDAs
  {
    type: 'LEGAL_CLAUSE',
    label: 'Non-Disclosure / Confidentiality Clause',
    regex: /(?:Non-Disclosure Agreement|Confidentiality Agreement|NDA|Non-Compete Clause|Section\s+\d+\.\d+\s+(?:Confidentiality|Indemnification|Liability))\s*[:-]?\s*([^\n\r]{10,80})/gi,
    confidence: 0.89,
    complianceTags: ['GDPR', 'DPDP_INDIA'],
    explanation: 'Binding legal covenant containing restrictive confidentiality obligations.',
  },

  // Organizations & Financial Intermediaries
  {
    type: 'ORGANIZATION',
    label: 'Confidential Corporate Entity / Institution',
    regex: /(?:Client|Partner|Vendor|Acquisition Target|Entity|Counterparty):\s*([A-Z][A-Za-z0-9\s&.,-]{2,40}\s+(?:Inc|LLC|Ltd|Corp|GmbH|Pvt\s+Ltd|Bank|Hospital|Holdings|Capital))/g,
    confidence: 0.88,
    complianceTags: ['GDPR', 'DPDP_INDIA'],
    explanation: 'Named corporate institution or institutional counterparty in sensitive business context.',
  },
];

export class LocalAiEngine {
  private static readonly MODEL_NAME = 'Xenova/distilbert-base-uncased-mnli';
  private static pipelineInstance: any = null;
  private static isModelLoading = false;
  private static cachedHardwareInfo: LocalAiHardwareInfo | null = null;
  private static modelStatus: LocalAiModelStatus = {
    loaded: false,
    loading: false,
    progressPercent: 0,
    statusText: 'Idle',
    modelName: LocalAiEngine.MODEL_NAME,
  };

  /**
   * Detect WebGPU hardware acceleration capabilities with fallback to WASM / CPU.
   */
  static async getHardwareInfo(): Promise<LocalAiHardwareInfo> {
    if (this.cachedHardwareInfo) {
      return this.cachedHardwareInfo;
    }

    let hasWebGpu = false;
    let adapterName: string | undefined = undefined;
    let backend: 'webgpu' | 'wasm' | 'cpu' = 'cpu';
    let maxComputeWorkgroupSize: number | undefined = undefined;

    try {
      if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
        const gpu = (navigator as any).gpu;
        if (typeof gpu.requestAdapter === 'function') {
          const adapter = await gpu.requestAdapter();
          if (adapter) {
            hasWebGpu = true;
            backend = 'webgpu';
            if (adapter.info) {
              adapterName = `${adapter.info.vendor || ''} ${adapter.info.architecture || adapter.info.device || ''}`.trim() || 'WebGPU Device';
            } else if (typeof adapter.requestAdapterInfo === 'function') {
              const info = await adapter.requestAdapterInfo();
              adapterName = `${info.vendor || ''} ${info.architecture || info.device || ''}`.trim() || 'WebGPU Device';
            }
            if (adapter.limits) {
              maxComputeWorkgroupSize = adapter.limits.maxComputeWorkgroupSizeX;
            }
          }
        }
      }
    } catch (err) {
      console.warn('WebGPU query note:', err);
    }

    if (!hasWebGpu) {
      if (typeof WebAssembly !== 'undefined') {
        backend = 'wasm';
        adapterName = 'WASM CPU Engine (SIMD Threads)';
      } else {
        backend = 'cpu';
        adapterName = 'Standard CPU JS Engine';
      }
    }

    this.cachedHardwareInfo = {
      hasWebGpu,
      adapterName,
      backend,
      maxComputeWorkgroupSize,
    };

    return this.cachedHardwareInfo;
  }

  /**
   * Get current on-device model status
   */
  static getStatus(): LocalAiModelStatus {
    return { ...this.modelStatus };
  }

  /**
   * Reset engine state
   */
  static reset(): void {
    this.pipelineInstance = null;
    this.isModelLoading = false;
    this.modelStatus = {
      loaded: false,
      loading: false,
      progressPercent: 0,
      statusText: 'Idle',
      modelName: this.MODEL_NAME,
    };
  }

  /**
   * Initialize or retrieve local ONNX/Transformers pipeline with WebGPU / WASM execution provider
   */
  static async getPipeline(
    onProgress?: (status: LocalAiModelStatus) => void
  ): Promise<any> {
    if (this.pipelineInstance) {
      return this.pipelineInstance;
    }

    if (this.isModelLoading) {
      let attempts = 0;
      while (this.isModelLoading && attempts < 40) {
        await new Promise((r) => setTimeout(r, 250));
        attempts++;
      }
      return this.pipelineInstance;
    }

    this.isModelLoading = true;
    this.modelStatus.loading = true;
    this.modelStatus.statusText = 'Initializing in-browser AI engine...';
    onProgress?.({ ...this.modelStatus });

    try {
      // In non-browser / unit test environments without DOM or WebWorker, skip heavy network download
      if (typeof window === 'undefined' && typeof process !== 'undefined' && process.env.NODE_ENV === 'test') {
        this.modelStatus.loaded = false;
        this.modelStatus.loading = false;
        this.modelStatus.statusText = 'Heuristic Local AI Engine Active';
        onProgress?.({ ...this.modelStatus });
        return null;
      }

      const hw = await this.getHardwareInfo();
      const { pipeline, env } = await import('@huggingface/transformers');

      if (env) {
        env.allowLocalModels = false;
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = hw.hasWebGpu ? 1 : 2;
        }
      }

      const pipelinePromise = pipeline('zero-shot-classification', this.MODEL_NAME, {
        device: hw.hasWebGpu ? 'webgpu' : 'cpu',
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && p?.progress !== undefined) {
            const pct = Math.round(p.progress);
            this.modelStatus.progressPercent = pct;
            this.modelStatus.statusText = `Downloading weights: ${pct}%`;
            onProgress?.({ ...this.modelStatus });
          } else if (p?.status === 'ready' || p?.status === 'done') {
            this.modelStatus.progressPercent = 100;
            this.modelStatus.statusText = 'Model loaded in memory';
            onProgress?.({ ...this.modelStatus });
          }
        },
      });

      // 10-second timeout guarantee to ensure zero UI freezes
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI Model load timed out')), 10000)
      );

      this.pipelineInstance = await Promise.race([pipelinePromise, timeoutPromise]);
      this.modelStatus.loaded = true;
      this.modelStatus.loading = false;
      this.modelStatus.progressPercent = 100;
      this.modelStatus.statusText = `Ready (${hw.backend.toUpperCase()})`;
      onProgress?.({ ...this.modelStatus });

      return this.pipelineInstance;
    } catch (err: any) {
      console.warn('Transformers.js model initialization note:', err?.message || err);
      this.modelStatus.loaded = false;
      this.modelStatus.loading = false;
      this.modelStatus.error = err?.message || 'Model load bypassed';
      this.modelStatus.statusText = 'Heuristic Local AI Engine Ready';
      onProgress?.({ ...this.modelStatus });
      return null;
    } finally {
      this.isModelLoading = false;
    }
  }

  /**
   * Extract contextual PII entities (medical conditions, trade secrets, high-risk orgs, legal clauses)
   * Runs local zero-shot / semantic NER inference on-device without data leaving the browser.
   */
  static async extractContextualEntities(
    text: string,
    onProgress?: (status: LocalAiModelStatus) => void
  ): Promise<ContextualPiiEntity[]> {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const results: ContextualPiiEntity[] = [];
    const seenValues = new Set<string>();

    // 1. Fast Semantic Context Matcher
    for (const pattern of CONTEXTUAL_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const fullMatch = match[0].trim();
        const extractedValue = (match[1] || match[0]).trim();

        if (extractedValue.length < 3 || seenValues.has(extractedValue.toLowerCase())) {
          continue;
        }
        seenValues.add(extractedValue.toLowerCase());

        results.push({
          type: pattern.type,
          label: pattern.label,
          value: extractedValue,
          confidence: pattern.confidence,
          explanation: pattern.explanation,
          complianceTags: pattern.complianceTags,
        });
      }
    }

    // 2. Deep Zero-Shot Sentence Analysis (if model is initialized / available)
    try {
      const classifier = await this.getPipeline(onProgress);
      if (classifier) {
        // Segment text into representative sentences/paragraphs (limit to first 10 to keep < 300ms)
        const sentences = text
          .split(/(?<=[.?!;\n])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 20 && s.length < 250)
          .slice(0, 8);

        const candidateLabels = [
          'medical health diagnosis or prescription',
          'confidential business trade secret',
          'binding legal non-disclosure clause',
          'public non-confidential text',
        ];

        for (const sentence of sentences) {
          // Check if already captured by regex to avoid duplicate inference
          const alreadyCaptured = results.some((r) => sentence.toLowerCase().includes(r.value.toLowerCase()));
          if (alreadyCaptured) continue;

          try {
            const out = await classifier(sentence, candidateLabels, { multi_label: false });
            if (out && out.labels && out.scores && out.scores[0] > 0.82) {
              const topLabel = out.labels[0];
              const score = out.scores[0];

              if (topLabel === 'medical health diagnosis or prescription') {
                const val = sentence.length > 60 ? `${sentence.substring(0, 57)}...` : sentence;
                if (!seenValues.has(val.toLowerCase())) {
                  seenValues.add(val.toLowerCase());
                  results.push({
                    type: 'MEDICAL_CONDITION',
                    label: 'Neural Context: Health Record',
                    value: val,
                    confidence: Number(score.toFixed(2)),
                    explanation: 'Classified by Local Neural SLM as sensitive Protected Health Information (PHI).',
                    complianceTags: ['HIPAA', 'GDPR'],
                  });
                }
              } else if (topLabel === 'confidential business trade secret') {
                const val = sentence.length > 60 ? `${sentence.substring(0, 57)}...` : sentence;
                if (!seenValues.has(val.toLowerCase())) {
                  seenValues.add(val.toLowerCase());
                  results.push({
                    type: 'TRADE_SECRET',
                    label: 'Neural Context: Trade Secret',
                    value: val,
                    confidence: Number(score.toFixed(2)),
                    explanation: 'Classified by Local Neural SLM as high-sensitivity commercial trade secret.',
                    complianceTags: ['IDENTITY_THEFT_PREVENTION', 'DPDP_INDIA'],
                  });
                }
              } else if (topLabel === 'binding legal non-disclosure clause') {
                const val = sentence.length > 60 ? `${sentence.substring(0, 57)}...` : sentence;
                if (!seenValues.has(val.toLowerCase())) {
                  seenValues.add(val.toLowerCase());
                  results.push({
                    type: 'LEGAL_CLAUSE',
                    label: 'Neural Context: Legal Clause',
                    value: val,
                    confidence: Number(score.toFixed(2)),
                    explanation: 'Classified by Local Neural SLM as restrictive legal covenant or non-disclosure obligation.',
                    complianceTags: ['GDPR', 'DPDP_INDIA'],
                  });
                }
              }
            }
          } catch (infErr) {
            // Single sentence error ignored to preserve throughput
          }
        }
      }
    } catch (err) {
      console.warn('Neural context inference error, falling back to heuristic results:', err);
    }

    return results;
  }

  /**
   * Convert ContextualPiiEntity to standard DetectedItem with bounding boxes or page numbers
   */
  static convertToDetectedItems(
    entities: ContextualPiiEntity[],
    pageNumber: number = 1
  ): DetectedItem[] {
    return entities.map((e, idx) => ({
      id: `local_ai_${e.type.toLowerCase()}_${Date.now()}_${idx}`,
      type: e.type,
      label: e.label,
      value: e.value,
      confidence: e.confidence,
      complianceTags: e.complianceTags,
      recommendation: e.explanation,
      pageNumber,
      source: 'LOCAL_AI',
    }));
  }

  /**
   * Generate zero-shot action recommendation based on document metadata summary
   */
  static async suggestAction(
    detection: DetectionResult,
    onProgress?: (msg: string) => void
  ): Promise<ModelRoutingSuggestion | null> {
    const validActions: AgentAction[] = [
      'ENCRYPT_FULL',
      'ENCRYPT_REGION',
      'SYNTHETIC_REPLACE',
      'REDACT_METADATA',
      'WARN',
      'NO_ACTION',
    ];

    try {
      const piiTypes = Array.from(new Set(detection.detectedItems.map((i) => i.type)));
      const highestConfidence = detection.detectedItems.reduce((max, i) => Math.max(max, i.confidence), 0);

      const compactSummary = {
        fileName: detection.fileName,
        fileType: detection.fileType,
        fileSizeKB: Math.round(detection.fileSize / 1024),
        piiTypeCount: piiTypes.length,
        piiTypes,
        hasFaces: detection.detectedItems.some((i) => i.type === 'FACE'),
        hasGps: detection.exif.hasGps,
        hasDeviceMetadata: !!(detection.exif.deviceMake || detection.exif.deviceModel),
        highestPiiConfidence: Number(highestConfidence.toFixed(2)),
        isDemoSample: !!detection.isDemoSample,
      };

      const classifier = await this.getPipeline((st) => onProgress?.(st.statusText));
      if (!classifier) {
        return null;
      }

      const textToClassify = `Document privacy scan request for ${compactSummary.fileName} (${compactSummary.fileType}, ${compactSummary.fileSizeKB}KB). Detected sensitive PII entities: [${compactSummary.piiTypes.join(', ')}]. Face biometric present: ${compactSummary.hasFaces}. Geotag metadata present: ${compactSummary.hasGps}. Max entity confidence: ${compactSummary.highestPiiConfidence}.`;

      const candidateLabels = [
        'ENCRYPT_FULL',
        'ENCRYPT_REGION',
        'SYNTHETIC_REPLACE',
        'REDACT_METADATA',
        'WARN',
        'NO_ACTION',
      ];

      const result = await classifier(textToClassify, candidateLabels, {
        multi_label: false,
      });

      if (!result || !result.labels || result.labels.length === 0) {
        return null;
      }

      const topLabel = result.labels[0] as AgentAction;
      const topScore = result.scores[0] || 0.5;

      if (!validActions.includes(topLabel)) {
        return null;
      }

      const rawScores: Record<string, number> = {};
      result.labels.forEach((lbl: string, idx: number) => {
        rawScores[lbl] = result.scores[idx];
      });

      return {
        action: topLabel,
        confidence: topScore,
        modelName: this.MODEL_NAME,
        rawScores,
        compactSummary,
      };
    } catch (err) {
      console.warn('Local AI action suggestion fallback:', err);
      return null;
    }
  }
}
