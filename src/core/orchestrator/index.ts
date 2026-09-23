import { DetectionResult, AgentDecision, AgentAction } from '../../types';
import { AgentLayer } from '../agents';
import { LocalAiEngine, ModelRoutingSuggestion } from '../ai/webEngine';

export type ModelPrecedence = 'RULES_WIN' | 'MODEL_WINS';

export type { ModelRoutingSuggestion };

export class LocalOrchestrator {
  private static precedence: ModelPrecedence = 'RULES_WIN';

  // Set whether rule engine or local model wins on disagreement (defaults to RULES_WIN)
  static setPrecedence(precedence: ModelPrecedence): void {
    this.precedence = precedence;
  }

  static getPrecedence(): ModelPrecedence {
    return this.precedence;
  }

  static isLoaded(): boolean {
    return LocalAiEngine.getStatus().loaded;
  }

  // 1. Format DetectionResult as compact JSON summary (NO raw text or unredacted PII)
  static formatCompactSummary(detection: DetectionResult): Record<string, any> {
    const piiTypes = Array.from(new Set(detection.detectedItems.map((i) => i.type)));
    const highestConfidence = detection.detectedItems.reduce((max, i) => Math.max(max, i.confidence), 0);

    return {
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
  }

  // 2. Run classification through LocalAiEngine with fallback
  static async suggestAction(
    detection: DetectionResult,
    onProgress?: (msg: string) => void
  ): Promise<ModelRoutingSuggestion | null> {
    return LocalAiEngine.suggestAction(detection, onProgress);
  }

  // 3. Master Hybrid Orchestrator
  static async orchestrate(
    detection: DetectionResult,
    options?: { onProgress?: (msg: string) => void }
  ): Promise<AgentDecision> {
    // Run local model routing suggestion concurrently with safe fallback
    const modelSuggestion = await this.suggestAction(detection, options?.onProgress);

    // Pass model signal into the authoritative AgentLayer
    return await AgentLayer.decide(detection, {
      modelSuggestion: modelSuggestion
        ? {
            action: modelSuggestion.action,
            confidence: modelSuggestion.confidence,
            modelName: modelSuggestion.modelName,
            precedence: this.precedence,
          }
        : undefined,
    });
  }
}
