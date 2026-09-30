import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupplierOrderService } from '../../core/services/supplier-order.service';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { BridgeService } from '../../core/services/bridge.service';
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { PurchaseOrder, PurchaseOrderItem, Supplier } from '../../core/models/market.models';

@Component({
  selector: 'app-goods-receipt',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './goods-receipt.component.html'
})
export class GoodsReceiptComponent implements OnInit {
  public orderService = inject(SupplierOrderService);
  public catalogService = inject(MarketCatalogService);
  public tenantConfig = inject(TenantConfigService);
  public shiftService = inject(CashierShiftService);
  public bridge = inject(BridgeService);

  // Modal & Processing State
  public showNewPOModal = signal<boolean>(false);
  public showReceiveModal = signal<boolean>(false);
  public isProcessing = signal<boolean>(false);
  public activePO = signal<PurchaseOrder | null>(null);
  public feedbackMsg = signal<string | null>(null);

  // New PO Form Signals
  public poProductSearch = signal<string>('');
  public selectedSupplierId = signal<string>('');
  public newPoNotes = signal<string>('');
  public poDraftItems = signal<PurchaseOrderItem[]>([]);

  // Receiving Modal Signals
  public deliveryInvoiceNo = signal<string>('');
  public receivingItems = signal<PurchaseOrderItem[]>([]);
  public scanReceivingBarcode = signal<string>('');
  public scanError = signal<string | null>(null);

  // Quick Supplier Creator
  public isAddingNewSupplier = signal<boolean>(false);
  public newSupplierName = signal<string>('');
  public newSupplierAfm = signal<string>('');
  public newSupplierPhone = signal<string>('');
  public isSupplierDropdownOpen = signal<boolean>(false);

  // 1. TENANT-ISOLATED PURCHASE ORDERS STREAM
  public storePurchaseOrders = computed(() => {
    const activeCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    return (this.orderService.purchaseOrders() || []).filter(
      po => !po.storeId || po.storeId === activeCode
    );
  });

  // 2. TENANT-ISOLATED CATALOG QUICK-ADD
  public filteredCatalogProducts = computed(() => {
    const term = this.poProductSearch().trim().toLowerCase();
    const activeCode = this.tenantConfig.activeShop()?.code || 'mar-market';

    const storeProducts = this.catalogService.products().filter(p => {
      const matchStore = !p.storeId || p.storeId === activeCode;
      return matchStore && !p.deletedAt && p.isActive !== false;
    });

    if (term.length > 0) {
      return storeProducts.filter(p =>
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.barcode && String(p.barcode).toLowerCase().includes(term)) ||
        (p.brand && p.brand.toLowerCase().includes(term)) ||
        (p.id !== undefined && String(p.id).toLowerCase() === term)
      ).slice(0, 30);
    }

    return storeProducts.slice(0, 20);
  });

  async ngOnInit(): Promise<void> {
    await this.orderService.loadAll();
    await this.catalogService.loadInitialCatalog();
    if (this.orderService.suppliers().length > 0) {
      this.selectedSupplierId.set(this.orderService.suppliers()[0].id);
    }
  }

  public toggleSupplierDropdown(): void {
    this.isSupplierDropdownOpen.update(v => !v);
  }

  public selectSupplier(sup: Supplier): void {
    this.selectedSupplierId.set(sup.id);
    this.isSupplierDropdownOpen.set(false);
  }

  public getSelectedSupplierName(): string {
    const selected = this.orderService.suppliers().find(s => s.id === this.selectedSupplierId());
    if (selected) {
      return `${selected.name} (ΑΦΜ: ${selected.afm})`;
    }
    return this.orderService.suppliers().length > 0
      ? `${this.orderService.suppliers()[0].name} (ΑΦΜ: ${this.orderService.suppliers()[0].afm})`
      : '— Επιλέξτε Προμηθευτή —';
  }

  public onPoSearchChange(val: string): void {
    this.poProductSearch.set(val || '');
  }

  public addDraftItem(product: any): void {
    const existing = this.poDraftItems().find(i => i.productId === String(product.id));
    if (existing) {
      existing.orderedQty += 1;
      this.poDraftItems.set([...this.poDraftItems()]);
      return;
    }

    const newItem: PurchaseOrderItem = {
      productId: String(product.id),
      barcode: product.barcode || '',
      name: product.name,
      orderedQty: 10,
      receivedQty: 0,
      unitCost: product.costPrice || Number((product.price * 0.7).toFixed(2)),
      vatRate: product.vatRate || 13,
      isReceived: false
    };

    this.poDraftItems.update(items => [...items, newItem]);
  }

  public removeDraftItem(productId: string): void {
    this.poDraftItems.update(items => items.filter(i => i.productId !== productId));
  }

  public async savePO(): Promise<void> {
    if (this.poDraftItems().length === 0 || this.isProcessing()) return;

    this.isProcessing.set(true);
    const activeStoreCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    const supplier = this.orderService.suppliers().find(s => s.id === this.selectedSupplierId());

    try {
      await this.orderService.createPurchaseOrder({
        supplierId: this.selectedSupplierId(),
        supplierName: supplier?.name || 'Supplier',
        supplierAfm: supplier?.afm,
        storeId: activeStoreCode,
        items: this.poDraftItems(),
        notes: this.newPoNotes()
      } as any);

      this.showNewPOModal.set(false);
      this.flashNotice('✔ Η παραγγελία καταχωρήθηκε!');
    } catch (err: unknown) {
      console.error('[PO Save Error]', err);
    } finally {
      this.isProcessing.set(false);
    }
  }

  public openReceiveDelivery(po: PurchaseOrder): void {
    this.activePO.set(po);
    this.deliveryInvoiceNo.set(po.invoiceNumber || '');
    this.scanError.set(null);
    const cloned: PurchaseOrderItem[] = po.items.map((i: PurchaseOrderItem) => ({
      ...i,
      receivedQty: i.receivedQty || i.orderedQty,
      unitCost: i.unitCost || 0
    }));
    this.receivingItems.set(cloned);
    this.showReceiveModal.set(true);
  }

  public onScanDeliverItem(): void {
    const code = this.scanReceivingBarcode().trim();
    this.scanError.set(null);
    if (!code) return;

    const item = this.receivingItems().find(i => i.barcode === code);
    if (item) {
      item.receivedQty = (item.receivedQty ?? 0) + 1;
      this.receivingItems.set([...this.receivingItems()]);
      this.flashNotice(`+1 ${item.name}`);
    } else {
      this.scanError.set(`Το barcode "${code}" δεν περιλαμβάνεται στην παραγγελία!`);
    }
    this.scanReceivingBarcode.set('');
  }

  public async confirmGoodsReceipt(): Promise<void> {
    const po = this.activePO();
    if (!po || this.isProcessing()) return;

    this.isProcessing.set(true);
    const invoice = this.deliveryInvoiceNo().trim() || 'ΔΑ-' + Date.now().toString().slice(-5);
    const activeStoreCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    const cashierName = this.shiftService.currentCashier()?.name || 'Υπεύθυνος Αποθήκης';

    try {
      await this.orderService.receiveDelivery(
        po.id,
        invoice,
        this.receivingItems(),
        cashierName,
        activeStoreCode
      );

      // Print Delivery Protocol via Bridge Daemon
      await this.printDeliveryReceipt(po, invoice);

      this.showReceiveModal.set(false);
      await this.catalogService.loadInitialCatalog();
      this.flashNotice(`✔ Επιτυχής παραλαβή: ${invoice}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Receipt Error]', msg);
      alert(`Σφάλμα καταχώρησης παραλαβής: ${msg}`);
    } finally {
      this.isProcessing.set(false);
    }
  }

  private async printDeliveryReceipt(po: PurchaseOrder, invoice: string): Promise<void> {
    try {
      await this.bridge.printReceipt({
        type: 'GOODS_RECEIPT_PROTOCOL',
        supplier: po.supplierName,
        invoice,
        items: this.receivingItems(),
        store: this.tenantConfig.activeShop()
      } as any);
    } catch (e) {
      console.warn('[Bridge] Delivery receipt print bypassed:', e);
    }
  }

  public async openNewPO(): Promise<void> {
    this.poDraftItems.set([]);
    this.newPoNotes.set('');
    this.isAddingNewSupplier.set(false);

    if (this.orderService.suppliers().length === 0) {
      await this.orderService.loadAll();
    }

    if (this.orderService.suppliers().length > 0) {
      this.selectedSupplierId.set(this.orderService.suppliers()[0].id);
    }

    this.showNewPOModal.set(true);
  }

  public async saveQuickSupplier(): Promise<void> {
    const name = this.newSupplierName().trim();
    const afm = this.newSupplierAfm().trim();
    if (!name) return;

    const created = await this.orderService.addCustomSupplier({
      name,
      afm: afm || '—',
      phone: this.newSupplierPhone().trim()
    });

    this.selectedSupplierId.set(created.id);
    this.isAddingNewSupplier.set(false);
    this.newSupplierName.set('');
    this.newSupplierAfm.set('');
    this.newSupplierPhone.set('');
  }

  private flashNotice(msg: string): void {
    this.feedbackMsg.set(msg);
    setTimeout(() => this.feedbackMsg.set(null), 2500);
  }
}