import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SpoilageService } from '../../core/services/spoilage.service';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { EscPosPrinterService } from '../../core/services/esc-pos-printer.service';
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
  public printerService = inject(EscPosPrinterService);
  private router = inject(Router);

  public navigateTo(path: string): void {
    this.router.navigate([path]);
  }


  // Form Signals
  public showModal = signal<boolean>(false);
  public searchInput = signal<string>('');
  public selectedProduct = signal<Product | null>(null);
  public quantity = signal<number>(1);
  public selectedReason = signal<SpoilageReason>('EXPIRED');
  public notes = signal<string>('');
  public filterReason = signal<string>('ALL');

  // Filtered Product Search Matches for the Form
  public productMatches = computed(() => {
    const term = this.searchInput().trim().toLowerCase();
    if (term.length < 2) return [];
    return this.catalogService.products().filter(p =>
      p.name.toLowerCase().includes(term) ||
      (p.barcode && p.barcode.includes(term)) ||
      (p.sku && p.sku.toLowerCase().includes(term))
    ).slice(0, 8);
  });

  // Filtered Spoilage Logs
  public filteredLogs = computed(() => {
    const f = this.filterReason();
    const list = this.spoilageService.logs();
    if (f === 'ALL') return list;
    return list.filter(l => l.reason === f);
  });

  // Total Metrics
  public totalLossCost = computed(() => {
    return this.filteredLogs().reduce((acc, l) => acc + l.totalLossCost, 0);
  });

  public totalItemsSpoiled = computed(() => {
    return this.filteredLogs().reduce((acc, l) => acc + l.quantity, 0);
  });

  async ngOnInit(): Promise<void> {
    await this.catalogService.loadInitialCatalog();
    await this.spoilageService.loadLogs();
  }

  public openNewLogModal(product?: Product): void {
    this.selectedProduct.set(product || null);
    this.searchInput.set(product ? product.name : '');
    this.quantity.set(1);
    this.selectedReason.set('EXPIRED');
    this.notes.set('');
    this.showModal.set(true);
  }

  public selectProductForLog(prod: Product): void {
    this.selectedProduct.set(prod);
    this.searchInput.set(prod.name);
  }

  public async saveSpoilageLog(): Promise<void> {
    const prod = this.selectedProduct();
    if (!prod || this.quantity() <= 0) return;

    const cashier = this.shiftService.currentCashier()?.name || 'Υπεύθυνος Βάρδιας';

    const created = await this.spoilageService.logSpoilage({
      product: prod,
      quantity: this.quantity(),
      reason: this.selectedReason(),
      cashierName: cashier,
      notes: this.notes()
    });

    // Auto-print thermal protocol slip
    const bytes = this.printerService.buildEscPosSpoilageSlip(created);
    await this.printerService.printViaSerial(bytes);

    this.showModal.set(false);
  }

  public async reprintSlip(log: SpoilageLog): Promise<void> {
    const bytes = this.printerService.buildEscPosSpoilageSlip(log);
    await this.printerService.printViaSerial(bytes);
  }
}