import { DetectedItem, SyntheticEntityMapping } from '../../types';
import {
  generateVerhoeffChecksum,
  validateVerhoeff,
  validateLuhn,
  calculateLuhnCheckDigit,
  VERHOEFF_D,
  VERHOEFF_P,
  VERHOEFF_INV,
} from './checksum';

export * from './checksum';

// ============================================================================
// CURATED REALISTIC PERSONAS & SYNTHETIC DICTIONARIES
// ============================================================================
const SYNTHETIC_FIRST_NAMES = [
  'Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Neha', 'Aditya', 'Sneha',
  'Arjun', 'Pooja', 'Karan', 'Isha', 'Rahul', 'Divya', 'Siddharth', 'Meera',
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam', 'Chris', 'Jamie', 'Robin'
];

const SYNTHETIC_LAST_NAMES = [
  'Sharma', 'Patel', 'Verma', 'Gupta', 'Malhotra', 'Iyer', 'Mehta', 'Reddy',
  'Nair', 'Chopra', 'Kapoor', 'Singh', 'Deshmukh', 'Bose', 'Rao', 'Kulkarni',
  'Smith', 'Johnson', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore'
];

const SYNTHETIC_DOMAINS = [
  'sandbox.test', 'synthetic.org', 'demo-vault.internal', 'secure-proxy.mock', 'privacy-sandbox.net'
];

// ============================================================================
// SYNTHETIC ENGINE IMPLEMENTATION
// ============================================================================
export class SyntheticEngine {
  /**
   * Deterministic Linear Congruential PRNG from a seed string.
   */
  private static seededRandom(seed: string, index: number): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h = (h + index * 0x9e3779b9) >>> 0;
    return (h % 1000000) / 1000000;
  }

  /**
   * Generates a 100% mathematically valid 12-digit Aadhaar UID matching Verhoeff Dihedral-D5.
   */
  public static generateSyntheticAadhaar(seed?: string): { value: string; formatted: string } {
    let digits = '';
    // Aadhaar does not start with 0 or 1
    const firstDigit = seed 
      ? Math.floor(this.seededRandom(seed, 0) * 8) + 2
      : Math.floor(Math.random() * 8) + 2;
    digits += firstDigit.toString();

    for (let i = 1; i < 11; i++) {
      const d = seed 
        ? Math.floor(this.seededRandom(seed, i) * 10)
        : Math.floor(Math.random() * 10);
      digits += d.toString();
    }

    // Compute Verhoeff Check Digit for the 11 digits
    const full12 = generateVerhoeffChecksum(digits);
    const formatted = `${full12.slice(0, 4)} ${full12.slice(4, 8)} ${full12.slice(8, 12)}`;

    return { value: full12, formatted };
  }

  /**
   * Verifies if a 12-digit Aadhaar passes the Verhoeff checksum.
   */
  public static validateAadhaarVerhoeff(aadhaar: string): boolean {
    return validateVerhoeff(aadhaar);
  }

  /**
   * Generates a synthetic Indian PAN Card: [A-Z]{3}[P][A-Z][0-9]{4}[A-Z]
   */
  public static generateSyntheticPAN(seed?: string): string {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const randChar = (idx: number) => {
      const r = seed ? this.seededRandom(seed, idx) : Math.random();
      return letters[Math.floor(r * letters.length)];
    };
    const randDigit = (idx: number) => {
      const r = seed ? this.seededRandom(seed, idx) : Math.random();
      return Math.floor(r * 10).toString();
    };

    // 4th char 'P' represents Individual
    return `${randChar(1)}${randChar(2)}${randChar(3)}P${randChar(4)}${randDigit(5)}${randDigit(6)}${randDigit(7)}${randDigit(8)}${randChar(9)}`;
  }

  /**
   * Generates a synthetic 16-digit Credit Card matching Luhn Mod-10 algorithm.
   */
  public static generateSyntheticCreditCard(brand: 'VISA' | 'MASTERCARD' = 'VISA', seed?: string): { value: string; formatted: string } {
    let digits = brand === 'VISA' ? '4' : '5';
    for (let i = 1; i < 15; i++) {
      const d = seed ? Math.floor(this.seededRandom(seed, i) * 10) : Math.floor(Math.random() * 10);
      digits += d.toString();
    }

    // Calculate Luhn check digit
    const checkDigit = calculateLuhnCheckDigit(digits);
    const full16 = digits + checkDigit.toString();
    const formatted = `${full16.slice(0, 4)} ${full16.slice(4, 8)} ${full16.slice(8, 12)} ${full16.slice(12, 16)}`;

    return { value: full16, formatted };
  }

  /**
   * Verifies if a card passes the Luhn Mod-10 checksum.
   */
  public static validateCreditCardLuhn(cardNumber: string): boolean {
    return validateLuhn(cardNumber);
  }

  /**
   * Generates a realistic synthetic persona name.
   */
  public static generateSyntheticName(seed?: string): string {
    const r1 = seed ? this.seededRandom(seed, 101) : Math.random();
    const r2 = seed ? this.seededRandom(seed, 102) : Math.random();
    const first = SYNTHETIC_FIRST_NAMES[Math.floor(r1 * SYNTHETIC_FIRST_NAMES.length)];
    const last = SYNTHETIC_LAST_NAMES[Math.floor(r2 * SYNTHETIC_LAST_NAMES.length)];
    return `${first} ${last}`;
  }

  /**
   * Generates a synthetic email address.
   */
  public static generateSyntheticEmail(seed?: string): string {
    const r1 = seed ? this.seededRandom(seed, 201) : Math.random();
    const r2 = seed ? this.seededRandom(seed, 202) : Math.random();
    const r3 = seed ? this.seededRandom(seed, 203) : Math.random();
    const first = SYNTHETIC_FIRST_NAMES[Math.floor(r1 * SYNTHETIC_FIRST_NAMES.length)].toLowerCase();
    const num = Math.floor(r2 * 900) + 100;
    const domain = SYNTHETIC_DOMAINS[Math.floor(r3 * SYNTHETIC_DOMAINS.length)];
    return `${first}.${num}@${domain}`;
  }

  /**
   * Generates a synthetic mobile number (+91 9XXXX XXXXX).
   */
  public static generateSyntheticPhone(seed?: string): string {
    let num = '9';
    for (let i = 0; i < 9; i++) {
      const d = seed ? Math.floor(this.seededRandom(seed, 300 + i) * 10) : Math.floor(Math.random() * 10);
      num += d.toString();
    }
    return `+91 ${num.slice(0, 5)} ${num.slice(5)}`;
  }

  /**
   * Generates a synthetic API key / Bearer token matching typical length and prefix.
   */
  public static generateSyntheticApiKey(original?: string): string {
    const prefix = original?.startsWith('sk_live_') ? 'sk_live_syn_' : original?.startsWith('ghp_') ? 'ghp_syn_' : 'ak_syn_';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = prefix;
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  /**
   * Generates a realistic synthetic Date of Birth (DOB) preserving the input format.
   */
  public static generateSyntheticDOB(originalDOB?: string, seed?: string): string {
    const r1 = seed ? this.seededRandom(seed, 401) : Math.random();
    const r2 = seed ? this.seededRandom(seed, 402) : Math.random();
    const r3 = seed ? this.seededRandom(seed, 403) : Math.random();

    const day = Math.floor(r1 * 28) + 1; // 1..28 (safe for all months)
    const month = Math.floor(r2 * 12) + 1; // 1..12
    const year = Math.floor(r3 * 30) + 1975; // 1975..2004

    const pad = (n: number) => n.toString().padStart(2, '0');

    if (!originalDOB) return `${pad(day)}/${pad(month)}/${year}`;

    const clean = originalDOB.trim();

    // Check separator
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
      return `${pad(day)}/${pad(month)}/${year}`;
    }
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(clean)) {
      return `${pad(day)}-${pad(month)}-${year}`;
    }
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(clean)) {
      return `${pad(day)}.${pad(month)}.${year}`;
    }
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(clean)) {
      return `${year}-${pad(month)}-${pad(day)}`;
    }
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(clean)) {
      return `${year}/${pad(month)}/${pad(day)}`;
    }
    if (/^\d{4}$/.test(clean)) {
      return `${year}`;
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (/[a-zA-Z]/.test(clean)) {
      return `${pad(day)} ${months[month - 1]} ${year}`;
    }

    return `${pad(day)}/${pad(month)}/${year}`;
  }

  /**
   * Maps any single DetectedItem into its Format-Preserving Synthetic counterpart.
   */
  public static generateEntityMapping(item: DetectedItem, seed?: string): SyntheticEntityMapping {
    const itemSeed = seed ? `${seed}_${item.id}_${item.type}` : undefined;

    switch (item.type) {
      case 'AADHAAR': {
        const syn = this.generateSyntheticAadhaar(itemSeed);
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: item.value || 'UID Number',
          syntheticValue: syn.formatted,
          checksumValidated: true,
          checksumAlgorithm: 'VERHOEFF_D5',
        };
      }
      case 'PAN_CARD': {
        const syn = this.generateSyntheticPAN(itemSeed);
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: item.value || 'PAN Number',
          syntheticValue: syn,
          checksumValidated: true,
          checksumAlgorithm: 'FORMAT_REGEX',
        };
      }
      case 'CREDIT_CARD': {
        const syn = this.generateSyntheticCreditCard('VISA', itemSeed);
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: item.value || 'Credit Card Number',
          syntheticValue: syn.formatted,
          checksumValidated: true,
          checksumAlgorithm: 'LUHN_MOD10',
        };
      }
      case 'EMAIL': {
        const syn = this.generateSyntheticEmail(itemSeed);
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: item.value || 'Email Address',
          syntheticValue: syn,
          checksumValidated: true,
          checksumAlgorithm: 'FORMAT_REGEX',
        };
      }
      case 'PHONE': {
        const syn = this.generateSyntheticPhone(itemSeed);
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: item.value || 'Phone Number',
          syntheticValue: syn,
          checksumValidated: true,
          checksumAlgorithm: 'FORMAT_REGEX',
        };
      }
      case 'DOB': {
        const syn = this.generateSyntheticDOB(item.value, itemSeed);
        return {
          id: item.id,
          type: item.type,
          label: item.label || 'Date of Birth (DOB)',
          originalValue: item.value || 'DOB',
          syntheticValue: syn,
          checksumValidated: true,
          checksumAlgorithm: 'FORMAT_REGEX',
        };
      }
      case 'API_KEY': {
        const syn = this.generateSyntheticApiKey(item.value);
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: item.value || 'Secret Key',
          syntheticValue: syn,
          checksumValidated: true,
          checksumAlgorithm: 'FORMAT_REGEX',
        };
      }
      case 'FACE': {
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: 'Facial Biometric Photo',
          syntheticValue: '[Blank White Photo]',
          checksumValidated: true,
          checksumAlgorithm: 'SYNTHETIC_PERSONA',
        };
      }
      default: {
        const synName = this.generateSyntheticName(itemSeed);
        return {
          id: item.id,
          type: item.type,
          label: item.label,
          originalValue: item.value || 'PII Identifier',
          syntheticValue: synName,
          checksumValidated: true,
          checksumAlgorithm: 'SYNTHETIC_PERSONA',
        };
      }
    }
  }

  /**
   * Generates a complete mapping list for all detected items.
   */
  public static generateAllMappings(items: DetectedItem[], seed?: string): SyntheticEntityMapping[] {
    return items.map((item) => this.generateEntityMapping(item, seed));
  }

  /**
   * Replaces sensitive substrings in text with format-preserving synthetic values.
   */
  public static pseudonymizeText(rawText: string, mappings: SyntheticEntityMapping[]): string {
    let result = rawText;
    for (const map of mappings) {
      if (map.originalValue && map.originalValue.length > 2) {
        // Escape regex special chars
        const escaped = map.originalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const reg = new RegExp(escaped, 'g');
        result = result.replace(reg, map.syntheticValue);
      }
    }
    return result;
  }

  /**
   * Samples the native background color surrounding a bounding box for seamless inpainting.
   */
  private static sampleBackgroundColor(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    canvasW: number,
    canvasH: number
  ): string {
    try {
      const points = [
        { x: Math.max(0, x - 2), y: Math.max(0, y - 2) },
        { x: Math.min(canvasW - 1, x + w + 2), y: Math.max(0, y - 2) },
        { x: Math.max(0, x - 2), y: Math.min(canvasH - 1, y + h + 2) },
        { x: Math.min(canvasW - 1, x + w + 2), y: Math.min(canvasH - 1, y + h + 2) },
        { x: Math.min(canvasW - 1, Math.max(0, x + Math.floor(w / 2))), y: Math.max(0, y - 3) },
        { x: Math.min(canvasW - 1, Math.max(0, x + Math.floor(w / 2))), y: Math.min(canvasH - 1, y + h + 3) },
      ];

      let r = 0, g = 0, b = 0, count = 0;
      for (const pt of points) {
        const pixel = ctx.getImageData(pt.x, pt.y, 1, 1).data;
        // Ignore fully transparent pixels
        if (pixel[3] > 64) {
          r += pixel[0];
          g += pixel[1];
          b += pixel[2];
          count++;
        }
      }

      if (count > 0) {
        const avgR = Math.round(r / count);
        const avgG = Math.round(g / count);
        const avgB = Math.round(b / count);
        return `rgb(${avgR}, ${avgG}, ${avgB})`;
      }
    } catch {
      // Canvas read security fallback
    }
    return '#f8fafc';
  }

  /**
   * Renders high-legibility, document-preserving synthetic replacement over detected bounding boxes on an HTML5 canvas.
   */
  public static renderSyntheticCanvasOverlay(
    canvas: HTMLCanvasElement,
    items: DetectedItem[],
    mappings: SyntheticEntityMapping[],
    selectedItemId?: string | null
  ): void {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    items.forEach((item) => {
      if (!item.boundingBox) return;
      const mapping = mappings.find(m => m.id === item.id);
      const synText = mapping ? mapping.syntheticValue : `[SYNTHETIC ${item.type}]`;

      const box = item.boundingBox;
      const isNorm = box.isNormalized !== false && box.x <= 1 && box.y <= 1 && box.width <= 1 && box.height <= 1;
      const bx = isNorm ? Math.floor(box.x * canvas.width) : Math.floor(box.x);
      const by = isNorm ? Math.floor(box.y * canvas.height) : Math.floor(box.y);
      const bw = Math.max(15, isNorm ? Math.ceil(box.width * canvas.width) : Math.ceil(box.width));
      const bh = Math.max(12, isNorm ? Math.ceil(box.height * canvas.height) : Math.ceil(box.height));

      const isSelected = item.id === selectedItemId;

      // Sample local background color for seamless inpainting
      const bgColor = this.sampleBackgroundColor(ctx, bx, by, bw, bh, canvas.width, canvas.height);

      if (item.type === 'FACE') {
        // --- 1. RENDER CLEAN BLANK WHITE PHOTO CARD ---
        ctx.save();
        
        // Inpaint background around photo
        ctx.fillStyle = bgColor;
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);

        // Photo card container with subtle rounded corners
        const radius = Math.min(4, Math.floor(Math.min(bw, bh) * 0.04));
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, radius);
        ctx.clip();

        // 1. Pure Blank White Photo Fill
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx, by, bw, bh);

        // 2. Subtle minimalist outline / passport photo frame
        const centerX = bx + bw / 2;
        const centerY = by + bh / 2;
        const iconScale = Math.min(bw, bh);

        if (iconScale >= 28) {
          // Soft placeholder silhouette (subtle light gray)
          ctx.fillStyle = '#f1f5f9';
          const headR = iconScale * 0.18;
          ctx.beginPath();
          ctx.arc(centerX, centerY - headR * 0.4, headR, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.ellipse(centerX, centerY + headR * 1.5, headR * 1.6, headR * 0.95, 0, Math.PI, 0);
          ctx.fill();
        }

        // 3. Small Clean Blank Photo Tag
        if (bh >= 36 && bw >= 44) {
          const tagH = Math.min(18, Math.max(12, Math.floor(bh * 0.16)));
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(bx, by + bh - tagH, bw, tagH);
          ctx.fillStyle = '#94a3b8';
          ctx.font = `600 ${Math.max(8, Math.floor(tagH * 0.6))}px Inter, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('BLANK PHOTO', centerX, by + bh - tagH / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
        }

        ctx.restore(); // end clip

        // Subtle Card Border
        ctx.strokeStyle = isSelected ? '#4f46e5' : '#cbd5e1';
        ctx.lineWidth = isSelected ? 2.5 : 1;
        ctx.strokeRect(bx, by, bw, bh);

        // Interactive Selected Handles
        if (isSelected) {
          const handleSize = 8;
          const halfH = handleSize / 2;
          const corners = [
            [bx, by],
            [bx + bw, by],
            [bx, by + bh],
            [bx + bw, by + bh],
          ];
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#4f46e5';
          ctx.lineWidth = 1.5;
          corners.forEach(([hx, hy]) => {
            ctx.fillRect(hx - halfH, hy - halfH, handleSize, handleSize);
            ctx.strokeRect(hx - halfH, hy - halfH, handleSize, handleSize);
          });
        }

        ctx.restore();
      } else {
        // --- 2. RENDER SEAMLESS DOCUMENT TYPOGRAPHY IN-PLACE ---
        ctx.save();

        // A. Inpaint native background over original text
        ctx.fillStyle = bgColor;
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);

        // B. Determine font properties
        const isMono = ['AADHAAR', 'PAN_CARD', 'CREDIT_CARD', 'SSN', 'PASSPORT', 'API_KEY'].includes(item.type);
        const fontFamily = isMono 
          ? '"Roboto Mono", "Fira Code", "SF Mono", monospace' 
          : '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const fontWeight = isMono ? '700' : '600';

        // Calculate maximum font size that fits height
        let fontSize = Math.min(28, Math.max(10, Math.floor(bh * 0.72)));
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

        // Shrink font size if text width exceeds bounding box
        let textWidth = ctx.measureText(synText).width;
        while (textWidth > bw - 4 && fontSize > 8) {
          fontSize -= 1;
          ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
          textWidth = ctx.measureText(synText).width;
        }

        // Truncate if still overflowing at minimum font size
        let displayVal = synText;
        if (textWidth > bw - 4) {
          while (displayVal.length > 4 && ctx.measureText(displayVal + '...').width > bw - 4) {
            displayVal = displayVal.slice(0, -1);
          }
          displayVal += '...';
        }

        // C. Render crisp text directly on document baseline (single or multi-line)
        ctx.fillStyle = '#0f172a'; // Deep slate ink color
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Check if multi-line or tall box
        const lines: string[] = [];
        if (bh > fontSize * 2.2 && (item.type === 'CUSTOM' || synText.includes('\n') || displayVal.length > 20)) {
          const words = displayVal.split(' ');
          let curLine = '';
          for (const word of words) {
            const testLine = curLine ? `${curLine} ${word}` : word;
            if (ctx.measureText(testLine).width < bw - 4) {
              curLine = testLine;
            } else {
              if (curLine) lines.push(curLine);
              curLine = word;
            }
          }
          if (curLine) lines.push(curLine);
        }

        if (lines.length > 1) {
          const lineH = fontSize * 1.25;
          const startY = by + (bh - lines.length * lineH) / 2 + lineH / 2;
          lines.forEach((line, idx) => {
            ctx.fillText(line, bx + 2, startY + idx * lineH);
          });
        } else {
          ctx.fillText(displayVal, bx + 2, by + bh / 2);
        }

        // D. Interactive Highlight if Selected
        if (isSelected) {
          ctx.strokeStyle = '#4f46e5';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx - 1, by - 1, bw + 2, bh + 2);

          // Subtle floating badge above box
          const badgeText = `🎭 ${item.type} · ✓ VALID`;
          ctx.font = 'bold 9px "Fira Code", monospace';
          const badgeW = ctx.measureText(badgeText).width + 8;
          const badgeH = 14;
          const badgeY = Math.max(0, by - badgeH - 2);

          ctx.fillStyle = '#4f46e5';
          ctx.beginPath();
          ctx.roundRect(bx, badgeY, badgeW, badgeH, 3);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, bx + 4, badgeY + badgeH / 2);

          // Corner resize handles
          const handleSize = 8;
          const halfH = handleSize / 2;
          const corners = [
            [bx, by],
            [bx + bw, by],
            [bx, by + bh],
            [bx + bw, by + bh],
          ];
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#4f46e5';
          ctx.lineWidth = 1.5;
          corners.forEach(([hx, hy]) => {
            ctx.fillRect(hx - halfH, hy - halfH, handleSize, handleSize);
            ctx.strokeRect(hx - halfH, hy - halfH, handleSize, handleSize);
          });
        }

        ctx.restore();
      }
    });
  }
}