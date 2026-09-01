import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { 
  Product, 
  SUPERMARKET_DEPARTMENTS, 
  MasterCategory 
} from '../../core/models';
import { generateBarcodeSvg } from '../../core/utils/barcode-svg.util';

export interface LabelItem {
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
  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);

  public queue = signal<LabelItem[]>([]);
  public searchQuery = signal<string>('');
  public selectedCategory = signal<string>('all');
  public labelSize = signal<'A4_SHEET' | 'THERMAL_ROLL'>('A4_SHEET');
  public departments: MasterCategory[] = SUPERMARKET_DEPARTMENTS;

  public filteredCatalog = computed(() => {
    const term = this.searchQuery().toLowerCase().trim();
    const cat = this.selectedCategory().toLowerCase();
    let prods = this.catalogService.products().filter(p => !p.deletedAt);

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

  public flattenedLabels = computed(() => {
    const list: Product[] = [];
    for (const item of this.queue()) {
      for (let i = 0; i < item.quantity; i++) {
        list.push(item.product);
      }
    }
    return list;
  });

  async ngOnInit(): Promise<void> {
    await this.catalogService.loadInitialCatalog();
    
    // Default queue with first 6 products for instant preview
    const initial = this.catalogService.products().filter(p => !p.deletedAt).slice(0, 6);
    this.queue.set(initial.map(p => ({
      product: p,
      quantity: 1,
      unitMeasurement: this.computeUnitDisplay(p),
      pricePerUnit: this.computeUnitPriceValue(p)
    })));
  }

  public selectCategory(catId: string): void {
    this.selectedCategory.set(catId);
  }

  public addToQueue(product: Product): void {
    const prodId = product.id || product.barcode;
    const existing = this.queue().find(item => (item.product.id || item.product.barcode) === prodId);
    
    if (existing) {
      this.queue.update(items =>
        items.map(i =>
          (i.product.id || i.product.barcode) === prodId
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
          unitMeasurement: this.computeUnitDisplay(product),
          pricePerUnit: this.computeUnitPriceValue(product)
        }
      ]);
    }
  }

  public addEntireCategoryToQueue(catId: string): void {
    const target = catId.toLowerCase();
    const prods = this.catalogService.products().filter(p => {
      if (p.deletedAt) return false;
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
    // Dynamic height based on media size
    const height = this.labelSize() === 'THERMAL_ROLL' ? 24 : 32;
    const svg = generateBarcodeSvg(code, height);
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  public getNetPrice(price: number, vatRate: number): string {
    const vat = vatRate !== undefined ? vatRate : 24;
    const net = (price || 0) / (1 + vat / 100);
    return net.toFixed(2);
  }

  public getPriceWhole(price: number): string {
    return Math.floor(price || 0).toString();
  }

  public getPriceCents(price: number): string {
    const decimals = Math.round(((price || 0) % 1) * 100);
    return decimals.toString().padStart(2, '0');
  }

  // Mandatory Greek Reference Unit Calculation (Τιμή ανά Κιλό / Λίτρο)
  public computeUnitDisplay(p: Product): string {
    if (p.isWeighted) return 'kg';
    const nameLower = (p.name || '').toLowerCase();
    if (nameLower.includes('ml') || nameLower.includes('lt') || nameLower.includes('λίτρο')) return 'lt';
    if (nameLower.includes('gr') || nameLower.includes('kg') || nameLower.includes('κιλό')) return 'kg';
    return 'τεμ';
  }

  public computeUnitPriceValue(p: Product): number {
    const price = p.price || 0;
    if (p.isWeighted) return price;
    
    // Auto-parse package quantity (e.g., "ΓΑΛΑ 500ml" or "ΖΥΜΑΡΙΚΑ 500gr")
    const match = (p.name || '').match(/(\d+[\.,]?\d*)\s*(gr|g|ml|lt|l|kg)/i);
    if (match) {
      const num = parseFloat(match[1].replace(',', '.'));
      const unit = match[2].toLowerCase();
      if ((unit === 'gr' || unit === 'g' || unit === 'ml') && num > 0) {
        return Number(((price / num) * 1000).toFixed(2));
      }
    }
    return price;
  }

  public printLabels(): void {
    window.print();
  }

  public backToPos(): void {
    this.router.navigate(['/pos']);
  }
}