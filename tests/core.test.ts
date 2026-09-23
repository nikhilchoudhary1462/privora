import { describe, it, expect } from 'vitest';
import { RegexDetector } from '../src/core/detection/regex';
import { CryptoEngine } from '../src/core/crypto';
import { AgentLayer } from '../src/core/agents';
import { LocalIntelligenceEngine } from '../src/core/intelligence';
import { vaultDB } from '../src/core/storage/db';
import { DetectionResult, PolicyRule, UserOverride } from '../src/types';

describe('Regex PII Detection Suite', () => {
  it('should detect valid Indian PAN card numbers', () => {
    const text = 'User Tax ID: ABCDE1234F and another PAN: XYZPQ9876A';
    const items = RegexDetector.scanText(text);
    const pans = items.filter(i => i.type === 'PAN_CARD');
    expect(pans.length).toBe(2);
    expect(pans[0].value).toBe('ABCDE1234F');
    expect(pans[1].value).toBe('XYZPQ9876A');
  });

  it('should detect Indian Aadhaar numbers and validate Verhoeff checksum', () => {
    const validAadhaar = RegexDetector.generateVerhoeffChecksum('23456789012');
    const text = `Aadhaar UID: ${validAadhaar.substring(0, 4)} ${validAadhaar.substring(4, 8)} ${validAadhaar.substring(8, 12)} for citizen verification`;
    const items = RegexDetector.scanText(text);
    const aadhaar = items.filter(i => i.type === 'AADHAAR');
    expect(aadhaar.length).toBe(1);
    expect(aadhaar[0].confidence).toBeGreaterThan(0.8);
  });

  it('should detect credit card numbers with Luhn check', () => {
    const text = 'Payment method: 4532 0150 9942 1825 expiring 08/29';
    const items = RegexDetector.scanText(text);
    const cards = items.filter(i => i.type === 'CREDIT_CARD');
    expect(cards.length).toBe(1);
  });

  it('should detect API keys and secrets', () => {
    const text = 'export OPENAI_API_KEY="sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789"\nexport AWS_KEY="AKIAIOSFODNN7EXAMPLE"';
    const items = RegexDetector.scanText(text);
    const keys = items.filter(i => i.type === 'API_KEY');
    expect(keys.length).toBe(2);
  });
});

describe('Web Crypto Subsystem (AES-256-GCM, RSA-OAEP & SHA-256)', () => {
  it('should encrypt and decrypt ArrayBuffer with byte-for-byte fidelity', async () => {
    const plaintext = 'Super confidential identity payload: PAN=ABCDE1234F';
    const rawBuffer = new TextEncoder().encode(plaintext).buffer as ArrayBuffer;

    const dek = await CryptoEngine.generateDEK();
    const { ciphertext, iv } = await CryptoEngine.encryptBuffer(rawBuffer, dek);

    const decryptedBuffer = await CryptoEngine.decryptBuffer(ciphertext, iv, dek);
    const restoredText = new TextDecoder().decode(decryptedBuffer);
    expect(restoredText).toBe(plaintext);
  });

  it('should wrap and unwrap DEK using Master KEK (Envelope Encryption)', async () => {
    const dek = await CryptoEngine.generateDEK();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await CryptoEngine.deriveMasterKEK('MasterPassphrase123!', salt);

    const { wrappedKeyB64, ivB64 } = await CryptoEngine.wrapDEK(dek, kek);
    expect(wrappedKeyB64).toBeDefined();

    const unwrappedDek = await CryptoEngine.unwrapDEK(wrappedKeyB64, ivB64, kek);
    expect(unwrappedDek).toBeDefined();

    const msg = new TextEncoder().encode('Hello Aegis').buffer as ArrayBuffer;
    const { ciphertext, iv } = await CryptoEngine.encryptBuffer(msg, unwrappedDek);
    const decrypted = await CryptoEngine.decryptBuffer(ciphertext, iv, dek);
    expect(new TextDecoder().decode(decrypted)).toBe('Hello Aegis');
  });

  it('should wrap DEK for recipient using RSA-OAEP 2048-bit public key and unwrap with recipient private key', async () => {
    // Generate simulated recipient keypair
    const recipientKeyPair = await CryptoEngine.generateP2PKeyPair();
    const dek = await CryptoEngine.generateDEK();

    // Sender wraps DEK using recipient public key
    const wrappedDekForRecipient = await CryptoEngine.wrapDEKForRecipient(dek, recipientKeyPair.publicKey);
    expect(wrappedDekForRecipient).toBeDefined();

    // Recipient unwraps DEK using their private key
    const unwrappedOnRecipientSide = await CryptoEngine.unwrapDEKWithPrivateKey(
      wrappedDekForRecipient,
      recipientKeyPair.privateKey
    );
    expect(unwrappedOnRecipientSide).toBeDefined();

    // Verify key works for encryption/decryption
    const sampleMsg = new TextEncoder().encode('P2P Confidential Transfer Direct').buffer as ArrayBuffer;
    const { ciphertext, iv } = await CryptoEngine.encryptBuffer(sampleMsg, dek);
    const decryptedByRecipient = await CryptoEngine.decryptBuffer(ciphertext, iv, unwrappedOnRecipientSide);
    expect(new TextDecoder().decode(decryptedByRecipient)).toBe('P2P Confidential Transfer Direct');
  });

  it('should detect file tampering via SHA-256 mismatch', async () => {
    const originalText = 'Untampered original data';
    const originalHash = await CryptoEngine.computeSHA256(originalText);

    const tamperedText = 'Untampered original datX';
    const tamperedHash = await CryptoEngine.computeSHA256(tamperedText);

    expect(originalHash).not.toBe(tamperedHash);
  });
});

describe('Agentic Decision Layer & Policy Rules', () => {
  it('should classify Government ID and recommend appropriate encryption', async () => {
    const dummyDetection: DetectionResult = {
      fileId: 'test_gov_1',
      fileName: 'aadhaar_card.png',
      fileType: 'image/png',
      fileSize: 102400,
      fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      detectedItems: [
        {
          id: '1',
          type: 'AADHAAR',
          label: 'Aadhaar UID',
          value: '2345 6789 0123',
          confidence: 0.99,
          complianceTags: ['DPDP_INDIA'],
          recommendation: 'Mask or encrypt',
        },
      ],
      exif: { hasGps: false },
      extractedText: 'GOVERNMENT OF INDIA UNIQUE IDENTIFICATION AUTHORITY',
      imageDimensions: { width: 600, height: 400 },
      scanDurationMs: 12,
    };

    const classification = AgentLayer.classifyFile(dummyDetection);
    expect(classification.category).toBe('GOVERNMENT_ID');

    const defaultPolicies: PolicyRule[] = [
      {
        id: 'rule_1',
        naturalLanguage: 'Encrypt gov id',
        condition: { categories: ['GOVERNMENT_ID'] },
        action: 'ENCRYPT_REGION',
        enabled: true,
        createdAt: Date.now(),
      },
    ];

    const policyResult = await AgentLayer.evaluatePolicy(
      classification.category,
      dummyDetection,
      defaultPolicies,
      []
    );

    expect(policyResult.action).toBe('ENCRYPT_REGION');
    expect(policyResult.riskScore).toBeGreaterThanOrEqual(75);
  });

  it('should parse natural-language rules into executable policy objects', () => {
    const rule = AgentLayer.parseNaturalLanguagePolicy('Always encrypt anything with a face or photo');
    expect(rule.action).toBe('ENCRYPT_REGION');
    expect(rule.condition.piiTypes).toContain('FACE');
  });

  it('should answer natural-language questions in Local Audit Assistant', async () => {
    const response = await LocalIntelligenceEngine.queryAssistant('What did you protect today?');
    expect(response).toContain('Protection Summary');
  });

  it('should record override justifications and surface them in assistant queries', async () => {
    await vaultDB.recordOverride({
      fileCategory: 'GOVERNMENT_ID',
      recommendedAction: 'ENCRYPT_REGION',
      chosenAction: 'NO_ACTION',
      filePiiSummary: ['AADHAAR'],
      justification: 'Approved demo test file for judge review',
      riskScore: 75,
      fileName: 'sample_id.jpg',
    });

    const response = await LocalIntelligenceEngine.queryAssistant('Why did you allow this?');
    expect(response).toContain('User Policy Overrides & Justifications');
    expect(response).toContain('Approved demo test file for judge review');
  });

  it('should integrate hybrid model suggestion with deterministic rules precedence', async () => {
    const dummyDetection: DetectionResult = {
      fileId: 'test_123',
      fileName: 'aadhaar_scan.png',
      fileType: 'image/png',
      fileSize: 1024,
      fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      detectedItems: [
        {
          id: 'item_1',
          type: 'AADHAAR',
          label: 'Aadhaar UID',
          value: '2345 6789 0123',
          confidence: 0.99,
          complianceTags: ['DPDP_INDIA'],
          recommendation: 'Mask or encrypt',
        },
      ],
      exif: { hasGps: false },
      extractedText: 'GOVERNMENT OF INDIA UNIQUE IDENTIFICATION AUTHORITY',
      imageDimensions: { width: 600, height: 400 },
      scanDurationMs: 12,
    };

    // RULES_WIN mode: deterministic rule engine prevails
    const decisionRulesWin = await AgentLayer.decide(dummyDetection, {
      modelSuggestion: {
        action: 'NO_ACTION',
        confidence: 0.85,
        modelName: 'Xenova/distilbert-base-uncased-mnli',
        precedence: 'RULES_WIN',
      },
    });
    expect(decisionRulesWin.action).toBe('ENCRYPT_REGION');
    expect(decisionRulesWin.reasoningSteps.some((s) => s.includes('Hybrid AI Divergence'))).toBe(true);

    // MODEL_WINS mode: model suggestion prevails
    const decisionModelWins = await AgentLayer.decide(dummyDetection, {
      modelSuggestion: {
        action: 'NO_ACTION',
        confidence: 0.85,
        modelName: 'Xenova/distilbert-base-uncased-mnli',
        precedence: 'MODEL_WINS',
      },
    });
    expect(decisionModelWins.action).toBe('NO_ACTION');
  });
});
