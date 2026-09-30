import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { BridgeService } from '../../core/services/bridge.service';
import { 
  Product, 
  SUPERMARKET_DEPARTMENTS, 
  MasterCategory 
} from '../../core/models';
import { generateBarcodeSvg } from '../../core/utils/barcode-svg.util';

export interface EnrichedLabel {
  product: Product;
  unitMeasurement: string;
  pricePerUnit: number;
}

export interface LabelQueueItem {
  product: Product;
  quantity: number;
  unitMeasurement: string;
  pricePerUnit: number;
}

@Component({
  selector: 'app-shelf-labels',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './shelf-labels.component.html',
  styleUrls: ['./shelf-labels.component.css']
})
export class ShelfLabelsComponent implements OnInit {
  public catalogService = inject(MarketCatalogService);
  public tenantConfig = inject(TenantConfigService);
  public bridge = inject(BridgeService);
  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);

  public queue = signal<LabelQueueItem[]>([]);
  public searchQuery = signal<string>('');
  public selectedCategory = signal<string>('all');
  public labelSize = signal<'A4_SHEET' | 'THERMAL_ROLL'>('A4_SHEET');
  public isPrintingBridge = signal<boolean>(false);
  public departments: MasterCategory[] = SUPERMARKET_DEPARTMENTS;

  // 1. TENANT-SCOPED PRODUCTS
  private storeProducts = computed(() => {
    const activeCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    return this.catalogService.products().filter(p => {
      const matchesStore = !p.storeId || p.storeId === activeCode;
      return matchesStore && !p.deletedAt && p.isActive !== false;
    });
  });

  // 2. FILTERED CATALOG FOR LEFT SELECTOR
  public filteredCatalog = computed(() => {
    const term = this.searchQuery().toLowerCase().trim();
    const cat = this.selectedCategory().toLowerCase();
    let prods = this.storeProducts();

    if (cat !== 'all') {
      prods = prods.filter(p => {
        const prodCatId = (p.categoryId || '').toLowerCase();
        const prodCatName = (p.categoryName || '').toLowerCase();
        return (
          prodCatId === cat ||
          prodCatName === cat ||
          `cat-${prodCatName}` === cat ||
          (cat === 'cat-pets' && (prodCatId.includes('zoo') || prodCatName.includes('ζωο')))
        );
      });
    }

    if (term) {
      prods = prods.filter(p => 
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.sku && p.sku.toLowerCase().includes(term)) ||
        (p.brand && p.brand.toLowerCase().includes(term))
      );
    }

    return prods.slice(0, 60);
  });

  // 3. FLATTENED LABELS WITH PRE-COMPUTED METRICS (Zero Regex in Template)
  public flattenedLabels = computed<EnrichedLabel[]>(() => {
    const list: EnrichedLabel[] = [];
    for (const item of this.queue()) {
      for (let i = 0; i < item.quantity; i++) {
        list.push({
          product: item.product,
          unitMeasurement: item.unitMeasurement,
          pricePerUnit: item.pricePerUnit
        });
      }
    }
    return list;
  });

  async ngOnInit(): Promise<void> {
    await this.catalogService.loadInitialCatalog();
    
    // Seed initial preview with tenant's first 6 products
    const initial = this.storeProducts().slice(0, 6);
    this.queue.set(initial.map(p => ({
      product: p,
      quantity: 1,
      unitMeasurement: this.calculateUnitDisplay(p),
      pricePerUnit: this.calculateUnitPriceValue(p)
    })));
  }

  private getProductKey(p: Product): string {
    return String(p.id ?? p.barcode ?? '');
  }

  public selectCategory(catId: string): void {
    this.selectedCategory.set(catId);
  }

  public addToQueue(product: Product): void {
    const prodKey = this.getProductKey(product);
    const existing = this.queue().find(item => this.getProductKey(item.product) === prodKey);
    
    if (existing) {
      this.queue.update(items =>
        items.map(i =>
          this.getProductKey(i.product) === prodKey
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      );
    } else {
      this.queue.update(items => [
        ...items,
        {
          product,
          quantity: 1,
          unitMeasurement: this.calculateUnitDisplay(product),
          pricePerUnit: this.calculateUnitPriceValue(product)
        }
      ]);
    }
  }

  public addEntireCategoryToQueue(catId: string): void {
    const target = catId.toLowerCase();
    const prods = this.storeProducts().filter(p => {
      if (target === 'all') return true;
      const prodCatId = (p.categoryId || '').toLowerCase();
      const prodCatName = (p.categoryName || '').toLowerCase();
      return prodCatId === target || prodCatName === target || `cat-${prodCatName}` === target;
    });

    for (const p of prods) {
      this.addToQueue(p);
    }
  }

  public removeQueueItem(index: number): void {
    this.queue.update(items => items.filter((_, i) => i !== index));
  }

  public clearQueue(): void {
    this.queue.set([]);
  }

  public getBarcodeSvg(barcode?: string): SafeHtml {
    const code = barcode || '5201004000000';
    const height = this.labelSize() === 'THERMAL_ROLL' ? 24 : 32;
    const svg = generateBarcodeSvg(code, height);
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  public getPriceWhole(price: number): string {
    return Math.floor(price || 0).toString();
  }

  public getPriceCents(price: number): string {
    const decimals = Math.round(((price || 0) % 1) * 100);
    return decimals.toString().padStart(2, '0');
  }

  // Statutory Greek Retail Unit Calculation (ΔΙ.Ε.Π.Π.Υ. - Τιμή ανά Kg/Lt)
  public calculateUnitDisplay(p: Product): string {
    if (p.isWeighted) return 'kg';
    const nameLower = (p.name || '').toLowerCase();
    if (nameLower.includes('ml') || nameLower.includes('lt') || nameLower.includes('λίτρο')) return 'lt';
    if (nameLower.includes('gr') || nameLower.includes('kg') || nameLower.includes('κιλό')) return 'kg';
    return 'τεμ';
  }

  public calculateUnitPriceValue(p: Product): number {
    const price = p.price || 0;
    if (p.isWeighted) return price;
    
    const match = (p.name || '').match(/(\d+[.,]?\d*)\s*(gr|g|ml|lt|l|kg)/i);
    if (match) {
      const num = parseFloat(match[1].replace(',', '.'));
      const unit = match[2].toLowerCase();
      if ((unit === 'gr' || unit === 'g' || unit === 'ml') && num > 0) {
        return Number(((price / num) * 1000).toFixed(2));
      }
    }
    return price;
  }

 public async printLabels(): Promise<void> {
    const items = this.flattenedLabels();
    if (items.length === 0) return;

    if (this.labelSize() === 'THERMAL_ROLL' && this.bridge.isBridgeAvailable()) {
      try {
        this.isPrintingBridge.set(true);
        const printed = await this.bridge.printShelfLabels(
          items.map(l => ({
            name: l.product.name,
            barcode: l.product.barcode || '',
            price: l.product.price,
            unitPrice: l.pricePerUnit,
            unitMeasure: l.unitMeasurement,
            vatRate: l.product.vatRate || 24,
            brand: l.product.brand || l.product.categoryName || ''
          }))
        );

        if (printed) {
          return;
        }
      } catch (err) {
        console.warn('[Bridge] Label TSPL streaming failed, falling back to browser print:', err);
      } finally {
        this.isPrintingBridge.set(false);
      }
    }

    // Default Browser Print (A4 Sheet or fallback)
    window.print();
  }

  public backToPos(): void {
    this.router.navigate(['/pos']);
  }
}