/**
 * Mathematical Checksum Utilities for PII Detection & FPE Synthetic Data
 * 1. Verhoeff Dihedral Group D5 (Indian Aadhaar UID)
 * 2. Luhn Mod-10 Algorithm (Credit / Debit Cards)
 */

// ============================================================================
// VERHOEFF DIHEDRAL GROUP D5 LOOKUP TABLES
// ============================================================================

// Verhoeff Dihedral Multiplication Table (d)
export const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Verhoeff Permutation Table (p)
export const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

// Verhoeff Inverse Table (inv)
export const VERHOEFF_INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

// ============================================================================
// VERHOEFF FUNCTIONS
// ============================================================================

/**
 * Generates a 12-digit Aadhaar UID string with the 12th Verhoeff check digit appended.
 * @param num11 11-digit base number string
 */
export function generateVerhoeffChecksum(num11: string): string {
  const clean = num11.replace(/\D/g, '');
  let c = 0;
  const invertedArray = clean.split('').map(Number).reverse();
  for (let i = 0; i < invertedArray.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][invertedArray[i]]];
  }
  return clean + VERHOEFF_INV[c];
}

/**
 * Validates a 12-digit Aadhaar UID string against the Verhoeff Dihedral-D5 checksum algorithm.
 * Rejects numbers not matching 12 digits, containing non-digits, or starting with 0/1.
 * @param numStr 12-digit candidate string (formatting spaces/hyphens are stripped)
 */
export function validateVerhoeff(numStr: string): boolean {
  const clean = numStr.replace(/\D/g, '');
  if (clean.length !== 12 || !/^[2-9]\d{11}$/.test(clean)) return false;
  let c = 0;
  const invertedArray = clean.split('').map(Number).reverse();
  for (let i = 0; i < invertedArray.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][invertedArray[i]]];
  }
  return c === 0;
}

// ============================================================================
// LUHN MOD-10 FUNCTIONS
// ============================================================================

/**
 * Validates a payment card number against the Luhn Mod-10 checksum algorithm.
 * Strips non-digit characters and supports 13-19 digit card numbers.
 * @param numStr Card number candidate string
 */
export function validateLuhn(numStr: string): boolean {
  const clean = numStr.replace(/\D/g, '');
  if (clean.length < 13 || clean.length > 19) return false;
  if (/^0+$/.test(clean)) return false; // Reject all zeros
  let sum = 0;
  let shouldDouble = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Calculates the single Luhn check digit for a given prefix of card digits.
 * @param digits Base digit string (e.g. 15 digits for a 16-digit card)
 */
export function calculateLuhnCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let val = parseInt(digits[digits.length - 1 - i], 10);
    if (i % 2 === 0) { // Will be in an odd position from the right once check digit is appended
      val *= 2;
      if (val > 9) val -= 9;
    }
    sum += val;
  }
  return (10 - (sum % 10)) % 10;
}
