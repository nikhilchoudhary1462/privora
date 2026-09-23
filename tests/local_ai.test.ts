import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAiEngine } from '../src/core/ai/webEngine';
import { LocalOrchestrator } from '../src/core/orchestrator';
import { DetectionResult } from '../src/types';

describe('Local In-Browser AI Engine & WebGPU Hardware Detection Suite', () => {
  beforeEach(() => {
    LocalAiEngine.reset();
  });

  it('should detect hardware execution backend with safe fallback (WASM/CPU)', async () => {
    const hwInfo = await LocalAiEngine.getHardwareInfo();
    expect(hwInfo).toBeDefined();
    expect(['webgpu', 'wasm', 'cpu']).toContain(hwInfo.backend);
    expect(typeof hwInfo.hasWebGpu).toBe('boolean');
    expect(hwInfo.adapterName).toBeDefined();
  });

  it('should report and reset model status accurately', () => {
    const initialStatus = LocalAiEngine.getStatus();
    expect(initialStatus.loaded).toBe(false);
    expect(initialStatus.loading).toBe(false);
    expect(initialStatus.progressPercent).toBe(0);

    LocalAiEngine.reset();
    const resetStatus = LocalAiEngine.getStatus();
    expect(resetStatus.loaded).toBe(false);
  });

  it('should extract Medical Conditions & PHI with HIPAA compliance tags', async () => {
    const medicalRecord = `
      Patient Name: John Doe
      Clinical Evaluation: Patient diagnosed with Type 2 Diabetes and stage 2 Hypertension.
      Treatment Plan: Rx: Metformin 500 mg oral tablet daily.
    `;

    const entities = await LocalAiEngine.extractContextualEntities(medicalRecord);
    const medicalEntities = entities.filter((e) => e.type === 'MEDICAL_CONDITION');

    expect(medicalEntities.length).toBeGreaterThanOrEqual(1);
    expect(medicalEntities[0].complianceTags).toContain('HIPAA');
    expect(medicalEntities[0].confidence).toBeGreaterThan(0.8);
    expect(medicalEntities[0].explanation).toContain('Health Information');
  });

  it('should extract Trade Secrets & Database Credentials with DPDP / PCI tags', async () => {
    const proprietaryDoc = `
      INTERNAL MEMORANDUM
      CONFIDENTIAL: Project Antigravity Quantum Weights v4
      Production Database URI: postgres://db_admin:MasterSecurePass99@db.prod.internal:5432/finance_ledger
    `;

    const entities = await LocalAiEngine.extractContextualEntities(proprietaryDoc);
    const secrets = entities.filter((e) => e.type === 'TRADE_SECRET');

    expect(secrets.length).toBeGreaterThanOrEqual(2);
    expect(secrets.some((s) => s.complianceTags.includes('IDENTITY_THEFT_PREVENTION'))).toBe(true);
    expect(secrets.some((s) => s.value.includes('postgres://'))).toBe(true);
  });

  it('should extract Non-Disclosure Clauses and Legal Covenants', async () => {
    const legalDoc = `
      MUTUAL NON-DISCLOSURE AND RESTRICTIVE COVENANTS
      Non-Disclosure Agreement: Both parties agree not to disclose proprietary trade secrets or customer lists.
      Section 5.1 Confidentiality: Recipient shall hold all proprietary information in strict confidence.
    `;

    const entities = await LocalAiEngine.extractContextualEntities(legalDoc);
    const clauses = entities.filter((e) => e.type === 'LEGAL_CLAUSE');

    expect(clauses.length).toBeGreaterThanOrEqual(1);
    expect(clauses[0].complianceTags).toContain('GDPR');
  });

  it('should extract Corporate Entities and Institutional Counterparties', async () => {
    const contractDoc = `
      Strategic Partnership:
      Client: Apex Global Capital LLC
      Counterparty: St. Jude Hospital Holdings Inc
    `;

    const entities = await LocalAiEngine.extractContextualEntities(contractDoc);
    const orgs = entities.filter((e) => e.type === 'ORGANIZATION');

    expect(orgs.length).toBeGreaterThanOrEqual(1);
    expect(orgs[0].complianceTags).toContain('GDPR');
  });

  it('should convert contextual entities to standard DetectedItems with source LOCAL_AI', () => {
    const sampleEntities = [
      {
        type: 'MEDICAL_CONDITION' as const,
        label: 'Medical Condition',
        value: 'Acute Cardiac Arrhythmia',
        confidence: 0.95,
        explanation: 'Protected health diagnosis',
        complianceTags: ['HIPAA' as const, 'GDPR' as const],
      },
    ];

    const detectedItems = LocalAiEngine.convertToDetectedItems(sampleEntities, 2);
    expect(detectedItems.length).toBe(1);
    expect(detectedItems[0].source).toBe('LOCAL_AI');
    expect(detectedItems[0].pageNumber).toBe(2);
    expect(detectedItems[0].id).toContain('local_ai_medical_condition_');
    expect(detectedItems[0].value).toBe('Acute Cardiac Arrhythmia');
  });

  it('should handle empty or whitespace text without crashing', async () => {
    const result1 = await LocalAiEngine.extractContextualEntities('');
    const result2 = await LocalAiEngine.extractContextualEntities('   \n\t  ');
    expect(result1).toEqual([]);
    expect(result2).toEqual([]);
  });

  it('should format compact privacy summary without raw text exposure in LocalOrchestrator', () => {
    const mockDetection: DetectionResult = {
      fileId: 'file_123',
      fileName: 'medical_report_confidential.pdf',
      fileType: 'application/pdf',
      fileSize: 1048576,
      fileHash: 'sha256_mock_hash_123',
      detectedItems: [
        {
          id: 'item_1',
          type: 'MEDICAL_CONDITION',
          label: 'Health Record',
          value: 'Hypertension Stage 2',
          confidence: 0.94,
          complianceTags: ['HIPAA'],
          recommendation: 'Redact health diagnosis',
          source: 'LOCAL_AI',
        },
      ],
      isSensitive: true,
      exif: { hasGps: false },
    };

    const summary = LocalOrchestrator.formatCompactSummary(mockDetection);
    expect(summary.fileName).toBe('medical_report_confidential.pdf');
    expect(summary.fileType).toBe('application/pdf');
    expect(summary.fileSizeKB).toBe(1024);
    expect(summary.piiTypes).toContain('MEDICAL_CONDITION');
    expect(summary.highestPiiConfidence).toBe(0.94);
    // Ensure raw PII value is NOT in summary
    expect(JSON.stringify(summary)).not.toContain('Hypertension Stage 2');
  });

  it('should execute end-to-end hybrid orchestration with contextual PII input', async () => {
    const mockDetection: DetectionResult = {
      fileId: 'test_doc_01',
      fileName: 'confidential_diagnosis.pdf',
      fileType: 'application/pdf',
      fileSize: 512000,
      fileHash: 'test_hash_456',
      detectedItems: [
        {
          id: 'item_med',
          type: 'MEDICAL_CONDITION',
          label: 'Medical Diagnosis',
          value: 'Cardiac Arrhythmia',
          confidence: 0.95,
          complianceTags: ['HIPAA', 'GDPR'],
          recommendation: 'PHI Redaction Required',
          source: 'LOCAL_AI',
        },
      ],
      isSensitive: true,
      exif: { hasGps: false },
    };

    const decision = await LocalOrchestrator.orchestrate(mockDetection);
    expect(decision).toBeDefined();
    expect(decision.riskScore).toBeGreaterThanOrEqual(40);
    expect(decision.complianceTags).toContain('HIPAA');
    expect(decision.action).toBeDefined();
  });
});
