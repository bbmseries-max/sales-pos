import { Injectable, inject, signal } from '@angular/core';
import { MarketCatalogService, ExternalProductMatch } from './market-catalog.service';
import { ScaleBarcodeService } from './scale-barcode.service';
import { CartService } from './cart.service';
import { Product } from '../models';

export interface ScanResolution {
  type: 'added' | 'discovered' | 'unknown' | 'blocked' | 'weighted_prompt';
  product?: Product;
  externalMatch?: ExternalProductMatch;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class BarcodeScannerService {
  private catalogService = inject(MarketCatalogService);
  private scaleService = inject(ScaleBarcodeService);
  private cartService = inject(CartService);

  public isProcessing = signal<boolean>(false);
  private scanBuffer: string = '';
  private lastKeyTime: number = 0;

  /**
   * Hardware Scanner rapid keystroke interceptor
   */
  public handleGlobalKey(event: KeyboardEvent, isModalOpen: boolean, onScan: (code: string) => void): void {
    if (isModalOpen) return;

    const currentTime = Date.now();
    const timeDiff = currentTime - this.lastKeyTime;
    this.lastKeyTime = currentTime;

    if (event.key === 'Enter') {
      if (this.scanBuffer.length >= 3) {
        event.preventDefault();
        const code = this.scanBuffer;
        this.scanBuffer = '';
        onScan(code);
        return;
      }
      this.scanBuffer = '';
      return;
    }

    if (timeDiff > 120 && this.scanBuffer.length > 0) {
      this.scanBuffer = '';
    }

    if (event.key.length === 1) {
      this.scanBuffer += event.key;
    }
  }

 public async resolveBarcode(rawCode: string): Promise<ScanResolution> {
    const clean = (rawCode || '').trim();
    if (!clean || clean.length < 3) return { type: 'unknown', message: 'Άκυρος κωδικός' };

    this.isProcessing.set(true);

    try {
      // 1. Check Scale Barcodes (e.g. 28xxxxx...)
      const scaleParsed = this.scaleService.parse(clean);
      if (scaleParsed?.isScaleBarcode) {
        let scaleProd: Product | undefined;
        for (const code of scaleParsed.lookupBarcodes) {
          scaleProd = this.catalogService.getProductByAnyIdentifier(code);
          if (scaleProd) break;
        }

        if (scaleProd) {
          if (this.cartService.isExpired(scaleProd)) {
            return { type: 'blocked', product: scaleProd, message: `⛔ ΛΗΞΗ: ${scaleProd.expire}!` };
          }

          if (scaleParsed.weightKg) {
            this.cartService.addProduct(scaleProd, scaleParsed.weightKg);
            return { type: 'added', product: scaleProd, message: `✔ ${scaleProd.name} (${scaleParsed.weightKg.toFixed(3)} kg)` };
          } else if ((scaleParsed as any).priceTotal) {
            const price = (scaleParsed as any).priceTotal;
            const weight = Number((price / (scaleProd.price || 1)).toFixed(3));
            this.cartService.addProduct(scaleProd, weight);
            return { type: 'added', product: scaleProd, message: `✔ ${scaleProd.name} (€${price.toFixed(2)})` };
          }
        }
      }

      // 2. Local Database Match (Instant < 2ms)
      const local = this.catalogService.getByBarcode(clean) || this.catalogService.getProductByAnyIdentifier(clean);
      if (local) {
        if (local.isWeighted) {
          if (this.cartService.isExpired(local)) {
            return { type: 'blocked', product: local, message: `⛔ ΛΗΞΗ: ${local.expire}!` };
          }
          return { type: 'weighted_prompt', product: local, message: 'Ζυγιζόμενο Είδος' };
        }
        this.cartService.addProduct(local);
        return { type: 'added', product: local, message: `✔ ${local.name}` };
      }

      // 3. Online Open Food Facts Resolver
      const externalMatch = await this.catalogService.fetchFromOpenFoodFacts(clean);
      if (externalMatch) {
        return {
          type: 'discovered',
          externalMatch,
          message: `🌐 Βρέθηκε: ${externalMatch.name}`
        };
      }

      // 4. Default Instant Fallback (Guaranteed to open modal)
      return {
        type: 'discovered',
        externalMatch: {
          barcode: clean,
          name: `Νέο Προϊόν (${clean})`,
          categoryName: 'General',
          suggestedVatRate: 13,
          suggestedPrice: 1.50
        },
        message: `Νέο είδος: ${clean}`
      };
    } finally {
      this.isProcessing.set(false);
    }
  }
}