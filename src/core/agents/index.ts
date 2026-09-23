import {
  DetectionResult,
  AgentDecision,
  AgentAction,
  FileCategory,
  ComplianceStandard,
  PolicyRule,
  UserOverride,
  BoundingBox,
} from '../../types';
import { vaultDB } from '../storage/db';

export class AgentLayer {
  private static readonly VALID_ACTIONS: AgentAction[] = [
    'NO_ACTION',
    'WARN',
    'REDACT_METADATA',
    'ENCRYPT_REGION',
    'ENCRYPT_FULL',
  ];

  // -------------------------------------------------------------
  // 1. Classifier Agent (B1)
  // -------------------------------------------------------------
  static classifyFile(detection: DetectionResult): {
    category: FileCategory;
    confidence: number;
    reasons: string[];
  } {
    const piiTypes = new Set(detection.detectedItems.map((i) => i.type));
    const textLower = (detection.extractedText || '').toLowerCase();
    const nameLower = (detection.fileName || '').toLowerCase();

    // Check Government ID (High Precedence)
    if (
      piiTypes.has('AADHAAR') ||
      piiTypes.has('PAN_CARD') ||
      piiTypes.has('PASSPORT') ||
      textLower.includes('income tax department') ||
      textLower.includes('unique identification authority') ||
      textLower.includes('government of india') ||
      textLower.includes('republic of india') ||
      nameLower.includes('aadhaar') ||
      nameLower.includes('pancard') ||
      nameLower.includes('passport')
    ) {
      return {
        category: 'GOVERNMENT_ID',
        confidence: 0.98,
        reasons: ['Detected official government identification numbers (Aadhaar, PAN, Passport) or emblem headers.'],
      };
    }

    // Check Code / API Credentials / Trade Secrets
    if (
      piiTypes.has('API_KEY') ||
      piiTypes.has('TRADE_SECRET') ||
      textLower.includes('-----begin private key-----') ||
      textLower.includes('bearer ey') ||
      textLower.includes('aws_secret_access_key') ||
      nameLower.endsWith('.env') ||
      nameLower.endsWith('.pem') ||
      nameLower.endsWith('.key')
    ) {
      return {
        category: 'CODE_OR_CREDENTIALS',
        confidence: 0.99,
        reasons: ['Discovered private cryptographic keys, API access tokens, proprietary trade secrets, or environment configuration secrets.'],
      };
    }

    // Check Financial Records
    if (
      piiTypes.has('CREDIT_CARD') ||
      piiTypes.has('BANK_ACCOUNT') ||
      textLower.includes('credit card') ||
      textLower.includes('tax invoice') ||
      textLower.includes('salary slip') ||
      textLower.includes('bank statement') ||
      textLower.includes('account statement') ||
      textLower.includes('balance sheet') ||
      nameLower.includes('invoice') ||
      nameLower.includes('salary') ||
      nameLower.includes('bank_statement')
    ) {
      return {
        category: 'FINANCIAL_RECORD',
        confidence: 0.94,
        reasons: ['Identified financial transaction terms or payment card numbers.'],
      };
    }

    // Check Medical Record (Precise keyword matching or MEDICAL_CONDITION entity)
    if (
      piiTypes.has('MEDICAL_CONDITION') ||
      textLower.includes('patient') ||
      textLower.includes('diagnosis') ||
      textLower.includes('prescription') ||
      textLower.includes('hospital') ||
      textLower.includes('lab results') ||
      textLower.includes('medical history') ||
      nameLower.includes('prescription') ||
      nameLower.includes('medical_report') ||
      nameLower.includes('medical-report') ||
      nameLower.includes('health_record')
    ) {
      return {
        category: 'MEDICAL_RECORD',
        confidence: 0.92,
        reasons: ['Medical diagnosis, prescription, or clinical health record formatting detected.'],
      };
    }

    // Check Personal Photo (Faces present or EXIF metadata / device footprint)
    if (piiTypes.has('FACE') || detection.exif.hasGps || piiTypes.has('EXIF_GPS') || piiTypes.has('EXIF_DEVICE')) {
      const faceCount = detection.detectedItems.filter((i) => i.type === 'FACE').length;
      return {
        category: 'PERSONAL_PHOTO',
        confidence: 0.88,
        reasons: [`Contains ${faceCount > 0 ? `${faceCount} human face biometric(s) and ` : ''}camera device footprint / EXIF metadata.`],
      };
    }

    // Check Confidential Document (SSN or dense personal contact details)
    if (piiTypes.has('SSN') || (piiTypes.has('EMAIL') && piiTypes.has('PHONE'))) {
      return {
        category: 'CONFIDENTIAL_DOCUMENT',
        confidence: 0.85,
        reasons: ['Multiple direct personal contact vectors (SSN, Email, Phone) located in text.'],
      };
    }

    // Check general document with some text
    if (detection.extractedText && detection.extractedText.length > 50) {
      return {
        category: 'GENERAL_DOCUMENT',
        confidence: 0.75,
        reasons: ['Standard text document with no direct sensitive identifiers caught.'],
      };
    }

    // Default: Non-sensitive media
    return {
      category: 'NON_SENSITIVE_MEDIA',
      confidence: 0.8,
      reasons: ['No biometric faces, structured PII numbers, or sensitive metadata detected.'],
    };
  }

  // -------------------------------------------------------------
  // 2. Policy Agent (B2) with Self-Correction (B5) & Rule Engine (B4)
  // -------------------------------------------------------------
  static async evaluatePolicy(
    category: FileCategory,
    detection: DetectionResult,
    activePolicies: PolicyRule[],
    overrides: UserOverride[],
    modelSuggestion?: {
      action: AgentAction;
      confidence: number;
      modelName: string;
      precedence?: 'RULES_WIN' | 'MODEL_WINS';
    }
  ): Promise<{ action: AgentAction; riskScore: number; appliedRuleId?: string; steps: string[] }> {
    const steps: string[] = [];
    const piiTypes = detection.detectedItems.map((i) => i.type);
    const hasFaces = piiTypes.includes('FACE');
    const hasGovPii =
      piiTypes.includes('AADHAAR') ||
      piiTypes.includes('PAN_CARD') ||
      piiTypes.includes('PASSPORT') ||
      piiTypes.includes('SSN');
    const hasCredentials = piiTypes.includes('API_KEY');
    const hasCards = piiTypes.includes('CREDIT_CARD');

    // Base Risk Score Calculation (0..100)
    let riskScore = 0;
    if (hasCredentials || piiTypes.includes('TRADE_SECRET')) riskScore += 90;
    if (hasGovPii) riskScore += 75;
    if (hasCards) riskScore += 70;
    if (piiTypes.includes('MEDICAL_CONDITION')) riskScore += 80;
    if (piiTypes.includes('LEGAL_CLAUSE')) riskScore += 60;
    if (piiTypes.includes('ORGANIZATION')) riskScore += 40;
    if (hasFaces) riskScore += 45;
    if (detection.exif.hasGps || piiTypes.includes('EXIF_GPS')) riskScore += 35;
    if (piiTypes.includes('EXIF_DEVICE')) riskScore += 25;
    if (piiTypes.includes('EMAIL') || piiTypes.includes('PHONE')) riskScore += 25;
    riskScore = Math.min(100, Math.max(0, riskScore));

    steps.push(`Calculated baseline risk index of ${riskScore}/100 based on ${detection.detectedItems.length} detected sensitive entities.`);

    let action: AgentAction | null = null;
    let appliedRuleId: string | undefined = undefined;

    // Evaluate Natural Language & Structured User Policies with AND Semantics (B4)
    for (const rule of activePolicies) {
      if (!rule.enabled) continue;
      const cond = rule.condition;

      const conditionChecks: boolean[] = [];

      if (cond.categories && cond.categories.length > 0) {
        conditionChecks.push(cond.categories.includes(category));
      }
      if (cond.piiTypes && cond.piiTypes.length > 0) {
        conditionChecks.push(cond.piiTypes.some((pt) => piiTypes.includes(pt)));
      }
      if (cond.hasGps !== undefined) {
        conditionChecks.push(detection.exif.hasGps === cond.hasGps);
      }
      if (cond.minRiskScore !== undefined) {
        conditionChecks.push(riskScore >= cond.minRiskScore);
      }

      // Conjunctive match: all specified conditions must evaluate to true
      const matched = conditionChecks.length > 0 && conditionChecks.every(Boolean);

      if (matched) {
        steps.push(`Triggered active user policy: "${rule.naturalLanguage}" -> Assigned Action: ${rule.action}`);
        action = rule.action;
        appliedRuleId = rule.id;
        break;
      }
    }

    // Default Policy Hierarchy
    if (!action) {
      if (category === 'CODE_OR_CREDENTIALS' || hasCredentials) {
        action = 'ENCRYPT_FULL';
        steps.push('Default Security Directive: High-risk credentials require mandatory Full Envelope Encryption.');
      } else if (category === 'GOVERNMENT_ID') {
        action = detection.imageDimensions ? 'ENCRYPT_REGION' : 'ENCRYPT_FULL';
        steps.push(`Default Security Directive: Government ID detected. Applying ${action} to preserve document usability.`);
      } else if (category === 'FINANCIAL_RECORD' || hasCards) {
        action = 'ENCRYPT_FULL';
        steps.push('Default Security Directive: Financial records and payment data must be fully encrypted.');
      } else if (category === 'PERSONAL_PHOTO') {
        if (hasFaces) {
          action = 'ENCRYPT_REGION';
          steps.push('Default Security Directive: Visual biometric faces isolated for selective region encryption.');
        } else if (detection.exif.hasGps || piiTypes.includes('EXIF_GPS') || piiTypes.includes('EXIF_DEVICE')) {
          action = 'REDACT_METADATA';
          steps.push('Default Security Directive: Strip EXIF metadata & device footprints to prevent hardware/location tracking.');
        } else {
          action = 'NO_ACTION';
        }
      } else if (category === 'MEDICAL_RECORD') {
        action = 'ENCRYPT_FULL';
        steps.push('Default Security Directive: Health & medical information requires full confidential vaulting.');
      } else if (riskScore > 30) {
        action = 'WARN';
        steps.push('Default Security Directive: Moderate sensitivity detected. Warning user prior to dispatch.');
      } else {
        action = 'NO_ACTION';
      }
    }

    // Check Learned Self-Correction Adaptive Policy (B5)
    const categoryOverrides = overrides.filter((o) => o.fileCategory === category);
    if (categoryOverrides.length >= 2) {
      const lastOverride = categoryOverrides[categoryOverrides.length - 1];
      action = lastOverride.chosenAction;
      steps.push(`Self-Correction Adaptive Policy (B5): Applied learned user override preference for '${category}' -> '${action}' (${categoryOverrides.length} past overrides recorded).`);
    }

    // Validate against fixed action set with safe-default fallback (B6)
    if (!this.VALID_ACTIONS.includes(action)) {
      steps.push('WARNING: Invalid action output. Triggered safe-default fallback: ENCRYPT_FULL.');
      action = 'ENCRYPT_FULL';
    }

    // Hybrid Orchestrator Signal Integration (Task 3)
    if (modelSuggestion && modelSuggestion.action) {
      const ruleAction = action;
      const modelAction = modelSuggestion.action;
      const precedence = modelSuggestion.precedence || 'RULES_WIN';

      if (ruleAction === modelAction) {
        steps.push(
          `Hybrid AI Consensus: Local model (${modelSuggestion.modelName}) and rule engine agreed on action [${action}] (Model Confidence: ${(modelSuggestion.confidence * 100).toFixed(1)}%).`
        );
      } else {
        if (precedence === 'MODEL_WINS') {
          steps.push(
            `Hybrid AI Divergence (MODEL_WINS mode): Local model suggested [${modelAction}] (confidence ${(modelSuggestion.confidence * 100).toFixed(1)}%), overriding rule-based [${ruleAction}].`
          );
          action = modelAction;
        } else {
          steps.push(
            `Hybrid AI Divergence (RULES_WIN mode): Local model suggested [${modelAction}] (confidence ${(modelSuggestion.confidence * 100).toFixed(1)}%), but authoritative rule engine maintained [${ruleAction}].`
          );
        }
      }
    }

    return { action, riskScore, steps };
  }

  // -------------------------------------------------------------
  // 3. Explainer Agent (B3) with Full Compliance Tagging (G4)
  // -------------------------------------------------------------
  static generateExplanation(
    category: FileCategory,
    action: AgentAction,
    detection: DetectionResult,
    riskScore: number
  ): { explanation: string; complianceTags: ComplianceStandard[] } {
    const tags = new Set<ComplianceStandard>();

    // Collect tags from detected PII items
    detection.detectedItems.forEach((i) => {
      (i.complianceTags || []).forEach((t) => tags.add(t));
    });

    // Medical records strictly attach HIPAA standard
    if (category === 'MEDICAL_RECORD') {
      tags.add('HIPAA');
    }

    let explanation = '';
    const itemCount = detection.detectedItems.length;

    switch (action) {
      case 'ENCRYPT_REGION':
        explanation = `Recommending selective cryptographic encryption for ${itemCount} sensitive region(s) (including ${detection.detectedItems.map((i) => i.label).join(', ')}). The surrounding context remains viewable while biometric and personal identifiers are cryptographically locked.`;
        break;

      case 'ENCRYPT_FULL':
        explanation = `Recommending full-file envelope encryption (AES-256-GCM) because this file was classified as a high-risk ${category.replace(/_/g, ' ')} with an overall risk index of ${riskScore}/100.`;
        break;

      case 'REDACT_METADATA':
        explanation = `Recommending EXIF metadata stripping. The file contains embedded GPS coordinates (${detection.exif.latitude?.toFixed(3)}°, ${detection.exif.longitude?.toFixed(3)}°) and device fingerprints without sensitive visual pixels.`;
        break;

      case 'WARN':
        explanation = `Found ${itemCount} potentially identifying element(s) (such as email or phone numbers). Please review before sending or storing.`;
        break;

      case 'NO_ACTION':
      default:
        explanation = 'No sensitive biometrics, government identifiers, or confidential tokens were detected. Safe to share or store in plaintext.';
        break;
    }

    return {
      explanation,
      complianceTags: Array.from(tags),
    };
  }

  // -------------------------------------------------------------
  // 4. Natural Language Policy Parser (B4)
  // -------------------------------------------------------------
  static parseNaturalLanguagePolicy(phrase: string): PolicyRule {
    const lower = phrase.toLowerCase().trim();
    const id = 'rule_user_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 9));
    const cond: PolicyRule['condition'] = {};
    let action: AgentAction = 'ENCRYPT_FULL';

    // Parse Action
    if (lower.includes('region') || lower.includes('blur') || lower.includes('selectively') || lower.includes('mask') || (lower.includes('face') && !lower.includes('full'))) {
      action = 'ENCRYPT_REGION';
    } else if (lower.includes('strip') || lower.includes('redact metadata') || lower.includes('remove gps')) {
      action = 'REDACT_METADATA';
    } else if (lower.includes('warn') || lower.includes('alert') || lower.includes('notify')) {
      action = 'WARN';
    } else if (lower.includes('ignore') || lower.includes('no action') || lower.includes("don't touch") || lower.includes('skip')) {
      action = 'NO_ACTION';
    } else if (lower.includes('encrypt') || lower.includes('lock') || lower.includes('protect') || lower.includes('secure')) {
      action = 'ENCRYPT_FULL';
    }

    // Parse Conditions
    if (lower.includes('face') || lower.includes('photo') || lower.includes('selfie')) {
      cond.piiTypes = cond.piiTypes || [];
      cond.piiTypes.push('FACE');
      cond.categories = ['PERSONAL_PHOTO'];
    }
    if (lower.includes('aadhaar') || lower.includes('pan') || lower.includes('id card') || lower.includes('passport')) {
      cond.piiTypes = cond.piiTypes || [];
      cond.piiTypes.push('AADHAAR', 'PAN_CARD', 'PASSPORT');
      cond.categories = ['GOVERNMENT_ID'];
    }
    if (lower.includes('gps') || lower.includes('location') || lower.includes('exif')) {
      cond.hasGps = true;
    }
    if (lower.includes('card') || lower.includes('bank') || lower.includes('financial') || lower.includes('statement')) {
      cond.categories = ['FINANCIAL_RECORD'];
      cond.piiTypes = cond.piiTypes || [];
      cond.piiTypes.push('CREDIT_CARD', 'BANK_ACCOUNT');
    }
    if (lower.includes('code') || lower.includes('api key') || lower.includes('secret') || lower.includes('token')) {
      cond.categories = ['CODE_OR_CREDENTIALS'];
      cond.piiTypes = cond.piiTypes || [];
      cond.piiTypes.push('API_KEY');
    }

    return {
      id,
      naturalLanguage: phrase,
      condition: cond,
      action,
      enabled: true,
      createdAt: Date.now(),
    };
  }

  // -------------------------------------------------------------
  // Master Orchestrator (B1 + B2 + B3 + B5 + B6)
  // -------------------------------------------------------------
  static async decide(
    detection: DetectionResult,
    options?: {
      modelSuggestion?: {
        action: AgentAction;
        confidence: number;
        modelName: string;
        precedence?: 'RULES_WIN' | 'MODEL_WINS';
      };
    }
  ): Promise<AgentDecision> {
    const policies = await vaultDB.getPolicies();
    const overrides = await vaultDB.getOverrides();

    // 1. Classifier Agent
    const { category, confidence: categoryConfidence, reasons: classReasons } = this.classifyFile(detection);

    // 2. Policy Agent
    const { action, riskScore, appliedRuleId, steps: policySteps } = await this.evaluatePolicy(
      category,
      detection,
      policies,
      overrides,
      options?.modelSuggestion
    );

    // 3. Explainer Agent
    const { explanation, complianceTags } = this.generateExplanation(category, action, detection, riskScore);

    // Extract target bounding boxes for region encryption if selected
    const targetRegions: BoundingBox[] = [];
    if (action === 'ENCRYPT_REGION') {
      for (const item of detection.detectedItems) {
        if (item.boundingBox) {
          targetRegions.push(item.boundingBox);
        }
      }
    }

    const reasoningSteps = [
      ...classReasons,
      ...policySteps,
      `Final Action Confirmed: [${action}] with compliance standard(s): ${complianceTags.join(', ') || 'General'}.`,
    ];

    const decision: AgentDecision = {
      fileCategory: category,
      categoryConfidence,
      action,
      riskScore,
      explanation,
      complianceTags,
      targetRegions,
      fallbackApplied: false,
      reasoningSteps,
      appliedRuleId,
    };

    // Log decision event to unified audit log (F1)
    await vaultDB.logEvent({
      eventType: 'CLASSIFY',
      severity: riskScore > 60 ? 'WARNING' : 'INFO',
      source: 'WEB_APP',
      fileId: detection.fileId,
      fileName: detection.fileName,
      actionTaken: `Agent Decision: ${action} for ${category}`,
      details: {
        category,
        action,
        riskScore,
        explanation,
        complianceTags,
      },
      riskScore,
    });

    return decision;
  }
}
