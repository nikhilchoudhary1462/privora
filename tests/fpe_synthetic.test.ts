import { describe, it, expect } from 'vitest';
import { SyntheticEngine } from '../src/core/fpe';
import { DetectedItem } from '../src/types';

describe('SyntheticEngine & Format-Preserving Pseudonymization (FPE)', () => {
  describe('Mathematical Checksum Generators', () => {
    it('should generate 100% Verhoeff Dihedral-D5 valid Aadhaar numbers', () => {
      for (let i = 0; i < 25; i++) {
        const syn = SyntheticEngine.generateSyntheticAadhaar(`test_seed_${i}`);
        expect(syn.value).toHaveLength(12);
        expect(SyntheticEngine.validateAadhaarVerhoeff(syn.value)).toBe(true);
        expect(syn.formatted).toMatch(/^\d{4} \d{4} \d{4}$/);
      }
    });

    it('should reject invalid Aadhaar check digits', () => {
      const valid = SyntheticEngine.generateSyntheticAadhaar().value;
      // Corrupt last digit
      const corruptedLast = valid.slice(0, 11) + ((parseInt(valid[11], 10) + 1) % 10).toString();
      expect(SyntheticEngine.validateAadhaarVerhoeff(corruptedLast)).toBe(false);
    });

    it('should generate valid PAN cards matching Indian Income Tax format', () => {
      for (let i = 0; i < 20; i++) {
        const pan = SyntheticEngine.generateSyntheticPAN(`pan_seed_${i}`);
        expect(pan).toHaveLength(10);
        expect(pan).toMatch(/^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/);
      }
    });

    it('should generate 100% Luhn Mod-10 valid Credit Cards', () => {
      for (let i = 0; i < 25; i++) {
        const visa = SyntheticEngine.generateSyntheticCreditCard('VISA', `visa_${i}`);
        expect(visa.value).toHaveLength(16);
        expect(visa.value.startsWith('4')).toBe(true);
        expect(SyntheticEngine.validateCreditCardLuhn(visa.value)).toBe(true);

        const mc = SyntheticEngine.generateSyntheticCreditCard('MASTERCARD', `mc_${i}`);
        expect(mc.value).toHaveLength(16);
        expect(mc.value.startsWith('5')).toBe(true);
        expect(SyntheticEngine.validateCreditCardLuhn(mc.value)).toBe(true);
      }
    });

    it('should reject invalid Credit Card Luhn check digits', () => {
      const valid = SyntheticEngine.generateSyntheticCreditCard().value;
      const corrupted = valid.slice(0, 15) + ((parseInt(valid[15], 10) + 1) % 10).toString();
      expect(SyntheticEngine.validateCreditCardLuhn(corrupted)).toBe(false);
    });

    it('should generate properly formatted synthetic emails and phones', () => {
      const email = SyntheticEngine.generateSyntheticEmail('seed_email');
      expect(email).toMatch(/^[a-z]+\.\d+@[a-z0-9.-]+\.[a-z]{2,}$/);

      const phone = SyntheticEngine.generateSyntheticPhone('seed_phone');
      expect(phone).toMatch(/^\+91 9\d{4} \d{5}$/);
    });

    it('should generate realistic synthetic names', () => {
      const name = SyntheticEngine.generateSyntheticName('seed_name');
      expect(name.split(' ')).toHaveLength(2);
      expect(name.length).toBeGreaterThan(5);
    });
  });

  describe('Entity Mapping & Text Pseudonymization', () => {
    it('should generate entity mappings with mathematical validation badges', () => {
      const items: DetectedItem[] = [
        {
          id: 'item_1',
          type: 'AADHAAR',
          label: 'Aadhaar UID',
          value: '9999 8888 7777',
          confidence: 0.99,
          complianceTags: ['DPDP_INDIA'],
          recommendation: 'Mask UID'
        },
        {
          id: 'item_2',
          type: 'PAN_CARD',
          label: 'PAN Number',
          value: 'ABCDE1234F',
          confidence: 0.98,
          complianceTags: ['DPDP_INDIA'],
          recommendation: 'Mask PAN'
        },
        {
          id: 'item_3',
          type: 'EMAIL',
          label: 'Email Address',
          value: 'confidential.user@company.com',
          confidence: 0.95,
          complianceTags: ['GDPR'],
          recommendation: 'Mask Email'
        }
      ];

      const mappings = SyntheticEngine.generateAllMappings(items, 'vault_master_seed');
      expect(mappings).toHaveLength(3);

      const aadhaarMap = mappings.find(m => m.type === 'AADHAAR')!;
      expect(aadhaarMap.checksumValidated).toBe(true);
      expect(aadhaarMap.checksumAlgorithm).toBe('VERHOEFF_D5');
      expect(SyntheticEngine.validateAadhaarVerhoeff(aadhaarMap.syntheticValue)).toBe(true);

      const panMap = mappings.find(m => m.type === 'PAN_CARD')!;
      expect(panMap.syntheticValue).toMatch(/^[A-Z]{3}P[A-Z]\d{4}[A-Z]$/);

      const emailMap = mappings.find(m => m.type === 'EMAIL')!;
      expect(emailMap.syntheticValue).toContain('@');
    });

    it('should pseudonymize raw text document while preserving surrounding context', () => {
      const originalText = `Invoice for Client ABCDE1234F with Aadhaar 9999 8888 7777 and email user@example.com.`;
      const items: DetectedItem[] = [
        {
          id: '1',
          type: 'PAN_CARD',
          label: 'PAN',
          value: 'ABCDE1234F',
          confidence: 1,
          complianceTags: [],
          recommendation: ''
        },
        {
          id: '2',
          type: 'AADHAAR',
          label: 'Aadhaar',
          value: '9999 8888 7777',
          confidence: 1,
          complianceTags: [],
          recommendation: ''
        },
        {
          id: '3',
          type: 'EMAIL',
          label: 'Email',
          value: 'user@example.com',
          confidence: 1,
          complianceTags: [],
          recommendation: ''
        }
      ];

      const mappings = SyntheticEngine.generateAllMappings(items, 'test_seed');
      const pseudonymized = SyntheticEngine.pseudonymizeText(originalText, mappings);

      expect(pseudonymized).not.toContain('ABCDE1234F');
      expect(pseudonymized).not.toContain('9999 8888 7777');
      expect(pseudonymized).not.toContain('user@example.com');
      expect(pseudonymized).toContain('Invoice for Client');
      expect(pseudonymized).toContain('with Aadhaar');
    });

    it('should be deterministic when given identical seed', () => {
      const item: DetectedItem = {
        id: 'aadhaar_1',
        type: 'AADHAAR',
        label: 'Aadhaar',
        value: '1234 5678 9012',
        confidence: 1,
        complianceTags: [],
        recommendation: ''
      };

      const map1 = SyntheticEngine.generateEntityMapping(item, 'fixed_client_seed');
      const map2 = SyntheticEngine.generateEntityMapping(item, 'fixed_client_seed');

      expect(map1.syntheticValue).toBe(map2.syntheticValue);
    });

    it('should generate format-preserving synthetic DOB and blank white face mapping', () => {
      // 1. Synthetic DOB format preservation
      const dobSlash = SyntheticEngine.generateSyntheticDOB('15/08/1990', 'seed_dob_1');
      expect(dobSlash).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

      const dobDash = SyntheticEngine.generateSyntheticDOB('15-08-1990', 'seed_dob_2');
      expect(dobDash).toMatch(/^\d{2}-\d{2}-\d{4}$/);

      const dobYear = SyntheticEngine.generateSyntheticDOB('1990', 'seed_dob_3');
      expect(dobYear).toMatch(/^\d{4}$/);

      // 2. Face item mapping
      const faceItem: DetectedItem = {
        id: 'face_1',
        type: 'FACE',
        label: 'Biometric Face Photo',
        value: 'face_binary',
        confidence: 0.99,
        complianceTags: ['DPDP_INDIA'],
        recommendation: ''
      };
      const faceMap = SyntheticEngine.generateEntityMapping(faceItem, 'seed_face');
      expect(faceMap.syntheticValue).toBe('[Blank White Photo]');

      // 3. DOB item mapping
      const dobItem: DetectedItem = {
        id: 'dob_1',
        type: 'DOB',
        label: 'Date of Birth (DOB)',
        value: '12/04/1995',
        confidence: 0.98,
        complianceTags: ['DPDP_INDIA'],
        recommendation: ''
      };
      const dobMap = SyntheticEngine.generateEntityMapping(dobItem, 'seed_dob');
      expect(dobMap.type).toBe('DOB');
      expect(dobMap.syntheticValue).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(dobMap.checksumValidated).toBe(true);
    });
  });
});