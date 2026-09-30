import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SpoilageService } from '../../core/services/spoilage.service';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { BridgeService } from '../../core/services/bridge.service';
import { Product, SpoilageLog, SpoilageReason } from '../../core/models';

@Component({
  selector: 'app-spoilage-logger',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './spoilage-logger.component.html'
})
export class SpoilageLoggerComponent implements OnInit {
  public spoilageService = inject(SpoilageService);
  public catalogService = inject(MarketCatalogService);
  public shiftService = inject(CashierShiftService);
  public tenantConfig = inject(TenantConfigService);
  public bridge = inject(BridgeService);
  private router = inject(Router);
  public formError = signal<string>('');

  public isSaving = signal<boolean>(false);

  // Form Signals
  public showModal = signal<boolean>(false);
  public searchInput = signal<string>('');
  public selectedProduct = signal<Product | null>(null);
  public quantity = signal<number>(1);
  public selectedReason = signal<SpoilageReason>('EXPIRED');
  public notes = signal<string>('');
  public filterReason = signal<string>('ALL');

  public navigateTo(path: string): void {
    this.router.navigate([path]);
  }

  // Filtered Product Search Matches for the Form
  public productMatches = computed(() => {
    const term = this.searchInput().trim().toLowerCase();
    const activeStore = this.tenantConfig.activeShop()?.code || 'mar-market';

    if (term.length < 2) return [];

    return this.catalogService.products()
      .filter(p => {
        const matchesStore = !p.storeId || p.storeId === activeStore;
        const matchesTerm = p.name.toLowerCase().includes(term) ||
          (p.barcode && p.barcode.includes(term)) ||
          (p.sku && p.sku.toLowerCase().includes(term));
        return matchesStore && matchesTerm && p.isActive !== false;
      })
      .slice(0, 8);
  });

  // Filtered Spoilage Logs (Strictly Tenant-Scoped)
  public filteredLogs = computed(() => {
    const f = this.filterReason();
    const activeStore = this.tenantConfig.activeShop()?.code || 'mar-market';
    const list = this.spoilageService.logs().filter(l => !l.storeId || l.storeId === activeStore);

    if (f === 'ALL') return list;
    return list.filter(l => l.reason === f);
  });

  // Total Metrics
  public totalLossCost = computed(() => {
    return Number(this.filteredLogs().reduce((acc, l) => acc + (l.totalLossCost || 0), 0).toFixed(2));
  });

  public totalItemsSpoiled = computed(() => {
    return Number(this.filteredLogs().reduce((acc, l) => acc + (l.quantity || 0), 0).toFixed(3));
  });

  async ngOnInit(): Promise<void> {
    await this.catalogService.loadInitialCatalog();
    await this.spoilageService.loadLogs();
  }

  public openNewLogModal(product?: Product): void {
    this.selectedProduct.set(product || null);
    this.searchInput.set(product ? product.name : '');
    this.quantity.set(product?.isWeighted ? 0.5 : 1);
    this.selectedReason.set('EXPIRED');
    this.notes.set('');
    this.formError.set('');
    this.isSaving.set(false);
    this.showModal.set(true);
  }

  public selectProductForLog(prod: Product): void {
    this.selectedProduct.set(prod);
    this.searchInput.set(prod.name);
    this.quantity.set(prod.isWeighted ? 0.5 : 1);
  }

  public async saveSpoilageLog(): Promise<void> {
    if (this.isSaving()) return;

    const prod = this.selectedProduct();
    const qty = this.quantity();
    this.formError.set('');

    if (!prod) {
      this.formError.set('Επιλέξτε ένα προϊόν.');
      return;
    }

    if (qty <= 0) {
      this.formError.set('Η ποσότητα πρέπει να είναι μεγαλύτερη από 0.');
      return;
    }

    // --- GUARD: Cannot spoil more than available stock ---
    const availableStock = prod.stockQuantity ?? 0;
    if (qty > availableStock) {
      this.formError.set(
        `Αδύνατη καταχώρηση: Δηλώσατε ${qty}, αλλά το τρέχον απόθεμα είναι μόνο ${availableStock}!`
      );
      return;
    }

    this.isSaving.set(true);
    const cashier = this.shiftService.currentCashier()?.name || 'Υπεύθυνος Βάρδιας';
    const activeStore = this.tenantConfig.activeShop()?.code || 'mar-market';

    try {
      const created = await this.spoilageService.logSpoilage({
        product: prod,
        quantity: qty,
        reason: this.selectedReason(),
        cashierName: cashier,
        notes: this.notes()
      });

      await this.printSpoilageSlip(created);
      this.showModal.set(false);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.formError.set(`Σφάλμα: ${errorMsg}`);
    } finally {
      this.isSaving.set(false);
    }
  }

  public async reprintSlip(log: SpoilageLog): Promise<void> {
    await this.printSpoilageSlip(log);
  }

  private async printSpoilageSlip(log: SpoilageLog): Promise<void> {
    try {
      await this.bridge.printReceipt({
        type: 'SPOILAGE_PROTOCOL',
        log,
        store: this.tenantConfig.activeShop()
      } as any);
    } catch (printErr) {
      console.warn('[Bridge] Spoilage slip printing bypassed:', printErr);
    }
  }
}