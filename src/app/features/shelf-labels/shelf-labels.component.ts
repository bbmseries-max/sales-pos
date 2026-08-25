import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { Product, Category } from '../../core/models/market.models';
import { marketDb } from '../../core/db/market-db';
import { generateBarcodeSvg } from '../../core/utils/barcode-svg.util';

export interface LabelItem {
  product: Product;
  quantity: number; // Number of duplicate labels to print
  unitMeasurement: string; // e.g., '1kg', '1L', '1τεμ'
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

  // Selection & Queue
  public queue = signal<LabelItem[]>([]);
  public searchQuery = signal<string>('');
  public selectedCategory = signal<string>('ALL');
  public labelSize = signal<'A4_SHEET' | 'THERMAL_ROLL'>('A4_SHEET');

  public filteredCatalog = computed(() => {
    const term = this.searchQuery().toLowerCase().trim();
    const cat = this.selectedCategory();
    let prods = this.catalogService.products();

    if (cat !== 'ALL') {
      prods = prods.filter(p => p.categoryId === cat);
    }
    if (term) {
      prods = prods.filter(p => 
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.sku && p.sku.toLowerCase().includes(term))
      );
    }
    return prods.slice(0, 40);
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
    // Default queue with top 8 products to immediately show preview
    const initial = this.catalogService.products().slice(0, 8);
    this.queue.set(initial.map(p => ({
      product: p,
      quantity: 1,
      unitMeasurement: p.isWeighted ? '1 kg' : '1 τεμ',
      pricePerUnit: p.price || 0
    })));
  }

  public addToQueue(product: Product): void {
    const existing = this.queue().find(item => item.product.id === product.id);
    if (existing) {
      this.queue.update(items => items.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      this.queue.update(items => [...items, {
        product,
        quantity: 1,
        unitMeasurement: product.isWeighted ? '1 kg' : '1 τεμ',
        pricePerUnit: product.price || 0
      }]);
    }
  }

  public addEntireCategoryToQueue(catId: string): void {
    const prods = this.catalogService.products().filter(p => catId === 'ALL' || p.categoryId === catId);
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
    const svg = generateBarcodeSvg(barcode || '5201004000000', 36);
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  public getNetPrice(price: number, vatRate: number): string {
    const net = price / (1 + vatRate / 100);
    return net.toFixed(2);
  }

  public getPriceWhole(price: number): string {
    return Math.floor(price || 0).toString();
  }

  public getPriceCents(price: number): string {
    const decimals = Math.round(((price || 0) % 1) * 100);
    return decimals.toString().padStart(2, '0');
  }

  public printLabels(): void {
    window.print();
  }

  public backToPos(): void {
    this.router.navigate(['/pos']);
  }
}