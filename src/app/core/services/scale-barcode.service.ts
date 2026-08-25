import { Injectable } from '@angular/core';

export interface ParsedScaleBarcode {
  isScaleBarcode: boolean;
  rawBarcode: string;
  prefix?: string;
  plu?: string;             // Item Code/PLU (e.g. "00123" or "123")
  lookupBarcodes: string[]; // Variations to match against product database
  weightKg?: number;        // Extracted weight in kg (e.g. 1.450)
  embeddedPrice?: number;   // Extracted price in € if scale is price-embedded
  mode: 'weight' | 'price' | 'standard';
}

@Injectable({
  providedIn: 'root'
})
export class ScaleBarcodeService {
  // Greek In-Store Scale Barcode Prefixes (20 to 29)
  private readonly scalePrefixes = new Set(['20', '21', '22', '23', '24', '25', '26', '27', '28', '29']);

  parse(barcode: string): ParsedScaleBarcode {
    const clean = barcode.trim();

    // Must be exactly 13 digits and start with 20-29
    if (clean.length !== 13 || !/^\d{13}$/.test(clean)) {
      return { isScaleBarcode: false, rawBarcode: clean, lookupBarcodes: [clean], mode: 'standard' };
    }

    const prefix = clean.substring(0, 2);
    if (!this.scalePrefixes.has(prefix)) {
      return { isScaleBarcode: false, rawBarcode: clean, lookupBarcodes: [clean], mode: 'standard' };
    }

    // Extraction: PP + XXXXX + YYYYY + C
    const rawPlu = clean.substring(2, 7); // 5 digits PLU
    const valueSection = parseInt(clean.substring(7, 12), 10); // 5 digits Weight/Price

    // Lookup permutations so we match whatever is stored in IndexedDB:
    // 1. Full 5-digit PLU ("00123")
    // 2. Trimmed numeric PLU ("123")
    // 3. Short 4-digit PLU ("0123")
    // 4. Prefix + PLU ("2000123")
    const trimmedPlu = String(parseInt(rawPlu, 10));
    const lookupBarcodes = [
      rawPlu,
      trimmedPlu,
      rawPlu.padStart(4, '0'),
      `${prefix}${rawPlu}`
    ];

    // Standard Greek Deli Convention:
    // Prefixes 20, 21, 22, 23, 24 = Weight (Grams / 1000)
    // Prefixes 28, 29 = Total Price (Cents / 100)
    if (prefix === '28' || prefix === '29') {
      const embeddedPrice = Number((valueSection / 100).toFixed(2));
      return {
        isScaleBarcode: true,
        rawBarcode: clean,
        prefix,
        plu: rawPlu,
        lookupBarcodes,
        embeddedPrice,
        mode: 'price'
      };
    }

    // Default: Weight Embedded (e.g. 01450 = 1.450 kg)
    const weightKg = Number((valueSection / 1000).toFixed(3));

    return {
      isScaleBarcode: true,
      rawBarcode: clean,
      prefix,
      plu: rawPlu,
      lookupBarcodes,
      weightKg,
      mode: 'weight'
    };
  }
}