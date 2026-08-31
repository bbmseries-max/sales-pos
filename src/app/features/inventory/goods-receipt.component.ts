import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { SupplierOrderService } from '../../core/services/supplier-order.service';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { PurchaseOrder, PurchaseOrderItem, Supplier } from '../../core/models/market.models';

@Component({
  selector: 'app-goods-receipt',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet],
  templateUrl: './goods-receipt.component.html'
})
export class GoodsReceiptComponent implements OnInit {
  public orderService = inject(SupplierOrderService);
  public catalogService = inject(MarketCatalogService);

  public showNewPOModal = signal<boolean>(false);
  public showReceiveModal = signal<boolean>(false);
  public activePO = signal<PurchaseOrder | null>(null);

  // New PO Form Signals
  public selectedSupplierId = signal<string>('');
  public newPoNotes = signal<string>('');
  public poDraftItems = signal<PurchaseOrderItem[]>([]);
  public productSearchTerm = signal<string>('');

  // Receiving Modal Signals
  public deliveryInvoiceNo = signal<string>('');
  public receivingItems = signal<PurchaseOrderItem[]>([]);
  public scanReceivingBarcode = signal<string>('');

  public isAddingNewSupplier = signal<boolean>(false);
  public newSupplierName = signal<string>('');
  public newSupplierAfm = signal<string>('');
  public newSupplierPhone = signal<string>('');

  public isSupplierDropdownOpen = signal<boolean>(false);

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
    if (this.poDraftItems().length === 0) return;

    const supplier = this.orderService.suppliers().find(s => s.id === this.selectedSupplierId());

    await this.orderService.createPurchaseOrder({
      supplierId: this.selectedSupplierId(),
      supplierName: supplier?.name || 'Supplier',
      supplierAfm: supplier?.afm,
      items: this.poDraftItems(),
      notes: this.newPoNotes()
    });

    this.showNewPOModal.set(false);
  }

  public openReceiveDelivery(po: PurchaseOrder): void {
    this.activePO.set(po);
    this.deliveryInvoiceNo.set(po.invoiceNumber || '');
    // Clone items with defaults
    const cloned: PurchaseOrderItem[] = po.items.map((i: PurchaseOrderItem) => ({
      ...i,
      receivedQty: i.receivedQty || i.orderedQty // default to ordered qty for fast check
    }));
    this.receivingItems.set(cloned);
    this.showReceiveModal.set(true);
  }

  public onScanDeliverItem(): void {
    const code = this.scanReceivingBarcode().trim();
    if (!code) return;

    const item = this.receivingItems().find(i => i.barcode === code);
    if (item) {
      item.receivedQty = (item.receivedQty ?? 0) + 1;
      this.receivingItems.set([...this.receivingItems()]);
    }
    this.scanReceivingBarcode.set('');
  }

  public async confirmGoodsReceipt(): Promise<void> {
    const po = this.activePO();
    if (!po) return;

    await this.orderService.receiveDelivery(
      po.id,
      this.deliveryInvoiceNo().trim() || 'ΔΑ-' + Date.now().toString().slice(-5),
      this.receivingItems()
    );

    this.showReceiveModal.set(false);
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
}