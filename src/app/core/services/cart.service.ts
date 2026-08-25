import { Injectable, computed, inject, signal } from '@angular/core';
import { marketDb } from '../db/market-db';
import { CartItem, Product, TransactionRecord } from '../models/market.models';
import { EftTerminalService } from './eft-terminal.service';
import { EscPosPrinterService } from './esc-pos-printer.service';
import { MarketCatalogService } from './market-catalog.service';
import { ScaleBarcodeService } from './scale-barcode.service';

@Injectable({ providedIn: 'root' })
export class CartService {
  private catalogService = inject(MarketCatalogService);
  private scaleService = inject(ScaleBarcodeService);
  private printerService = inject(EscPosPrinterService);
  private eftService = inject(EftTerminalService);

  // Cart State Signals
  // Held / Parked carts signal
public heldTickets = signal<{ id: string; timestamp: string; items: CartItem[]; note?: string }[]>([]);
  public items = signal<CartItem[]>([]);
  public isRefundMode = signal<boolean>(false);
  public lastProcessedReceipt = signal<TransactionRecord | null>(null);

  // Computed Totals & Greek VAT Breakdown
  public grandTotal = computed(() => {
    return this.items().reduce((sum, item) => {
      const lineGross = item.product.price * item.quantity;
      return sum + (item.isRefund ? -lineGross : lineGross);
    }, 0);
  });

  public netSubtotal = computed(() => {
    return this.items().reduce((sum, item) => {
      const rate = item.product.vatRate || 24;
      const divisor = 1 + rate / 100;
      const lineGross = item.product.price * item.quantity;
      const lineNet = lineGross / divisor;
      return sum + (item.isRefund ? -lineNet : lineNet);
    }, 0);
  });

  public totalTaxAmount = computed(() => this.grandTotal() - this.netSubtotal());
  public totalItemCount = computed(() => this.items().reduce((sum, i) => sum + (i.product.isWeighted ? 1 : i.quantity), 0));

  // --- CART MUTATIONS ---

  public addItem(product: Product, quantity?: number, forceRefund?: boolean): void {
    const isRef = forceRefund !== undefined ? forceRefund : this.isRefundMode();
    const qty = quantity !== undefined ? quantity : (product.isWeighted ? 0.500 : 1);

    this.items.update(curr => {
      const idx = curr.findIndex(i => i.product.id === product.id && !!i.isRefund === !!isRef);
      if (idx > -1) {
        const copy = [...curr];
        const step = quantity !== undefined ? quantity : (product.isWeighted ? 0.100 : 1);
        copy[idx] = { ...copy[idx], quantity: parseFloat((copy[idx].quantity + step).toFixed(3)) };
        return copy;
      }
      return [...curr, { product, quantity: qty, isRefund: isRef }];
    });
  }

  public removeItem(productId: string, isRefund = false): void {
    this.items.update(curr => {
      const idx = curr.findIndex(i => i.product.id === productId && !!i.isRefund === !!isRefund);
      if (idx === -1) return curr;
      const copy = [...curr];
      const step = copy[idx].product.isWeighted ? 0.100 : 1;
      const newQty = parseFloat((copy[idx].quantity - step).toFixed(3));

      if (newQty <= 0 || (copy[idx].product.isWeighted && newQty < 0.05)) {
        return copy.filter((_, i) => i !== idx);
      }
      copy[idx] = { ...copy[idx], quantity: newQty };
      return copy;
    });
  }

  public clearCart(): void {
    this.items.set([]);
    this.isRefundMode.set(false);
  }

  // --- BARCODE SCANNING & SCALE PARSING ---

  public handleBarcodeScan(barcode: string): boolean {
    const clean = barcode.trim();
    if (!clean) return false;

    // 1. Scale Barcode (Prefixes 20-29)
    const scaleParsed = this.scaleService.parse(clean);
    if (scaleParsed.isScaleBarcode) {
      const product = this.catalogService.products().find(p =>
        scaleParsed.lookupBarcodes.some(code => p.barcode === code || p.id === code || p.sku === code)
      );

      if (product) {
        if (scaleParsed.mode === 'weight' && scaleParsed.weightKg) {
          this.addItem(product, scaleParsed.weightKg);
        } else if (scaleParsed.mode === 'price' && scaleParsed.embeddedPrice) {
          const unitPrice = product.price || 1;
          const weight = parseFloat((scaleParsed.embeddedPrice / unitPrice).toFixed(3));
          this.addItem(product, weight);
        }
        return true;
      }
    }

    // 2. Standard EAN / SKU Barcode
    const product = this.catalogService.products().find(p => p.barcode === clean || p.id === clean || p.sku === clean);
    if (product) {
      this.addItem(product);
      return true;
    }

    return false;
  }

  // --- CHECKOUT & TRANSACTION FINALIZATION ---

public async checkout(
  paymentMethod: 'Cash' | 'Card' | 'Debit' | 'Split' = 'Cash',
  cashierName = 'Cashier 01',
  cashTendered?: number,
  changeDue?: number
): Promise<TransactionRecord> {
  const currentItems = this.items();
  if (currentItems.length === 0) {
    throw new Error('Cart is empty');
  }

  const grandTotal = this.grandTotal();
  const taxAmount = this.totalTaxAmount ? this.totalTaxAmount() : 0;
  const subtotal = this.netSubtotal ? this.netSubtotal() : grandTotal - taxAmount;

  const record: TransactionRecord = {
    id: 'TX-' + Date.now().toString(36).toUpperCase(),
    timestamp: new Date().toISOString(),
    items: [...currentItems],
    subtotal: Number(subtotal.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    grandTotal: Number(grandTotal.toFixed(2)),
    paymentMethod,
    cashier: cashierName,
    cashierName,
    cashTendered: cashTendered ?? grandTotal,
    changeDue: changeDue ?? 0,
    vatBreakdown: this.taxBreakdown()
  };

  await marketDb.transactions.add(record);
  this.clearCart();

  return record;
}

  // Alias to support addProduct calls across components
public addProduct(product: Product, quantity?: number, forceRefund?: boolean): void {
  this.addItem(product, quantity, forceRefund);
}

/** Parks the current cart and clears the register for the next customer */
public holdCurrentTicket(note?: string): void {
  const current = this.items();
  if (current.length === 0) return;

  const ticket = {
    id: 'HOLD-' + Date.now().toString(36).toUpperCase(),
    timestamp: new Date().toISOString(),
    items: [...current],
    note: note || `Ticket #${this.heldTickets().length + 1}`
  };

  this.heldTickets.update(list => [...list, ticket]);
  this.clearCart();
}

/** Recalls a parked ticket back into the active cart */
public recallTicket(ticketId: string): void {
  const ticket = this.heldTickets().find(t => t.id === ticketId);
  if (!ticket) return;

  this.items.set([...ticket.items]);
  this.heldTickets.update(list => list.filter(t => t.id !== ticketId));
}

/** Discards a held ticket */
public removeHeldTicket(ticketId: string): void {
  this.heldTickets.update(list => list.filter(t => t.id !== ticketId));
}

/** Recalls the most recently held ticket */
public recallLastTicket(): boolean {
  const tickets = this.heldTickets();
  if (tickets.length === 0) return false;

  const lastTicket = tickets[tickets.length - 1];
  this.items.set([...lastTicket.items]);
  this.heldTickets.set(tickets.slice(0, -1));
  return true;
}

/** Expiry check helper for products */
public isExpired(product?: Product | null): boolean {
  if (!product?.expire) return false;
  const d = new Date(product.expire);
  return !isNaN(d.getTime()) && d < new Date();
}

// Computed VAT categories breakdown for Greek fiscal receipts (6%, 13%, 24%)
public taxBreakdown = computed(() => {
  const breakdown: Record<number, { net: number; vat: number; gross: number }> = {
    24: { net: 0, vat: 0, gross: 0 },
    13: { net: 0, vat: 0, gross: 0 },
    6: { net: 0, vat: 0, gross: 0 },
    0: { net: 0, vat: 0, gross: 0 }
  };

  for (const item of this.items()) {
    const rate = Number(item.product.vatRate) || 24;
    const gross = (item.product.price || 0) * item.quantity;
    const multiplier = item.isRefund ? -1 : 1;
    const signedGross = gross * multiplier;
    const net = signedGross / (1 + rate / 100);
    const vat = signedGross - net;

    if (!breakdown[rate]) {
      breakdown[rate] = { net: 0, vat: 0, gross: 0 };
    }

    breakdown[rate].net += net;
    breakdown[rate].vat += vat;
    breakdown[rate].gross += signedGross;
  }

  return breakdown;
});

/** Direct quantity setter for numeric keypad or modal inputs */
public updateQuantity(productId: string, newQuantity: number, isRefund = false): void {
  if (newQuantity <= 0) {
    this.removeItem(productId, isRefund);
    return;
  }

  this.items.update(curr => {
    return curr.map(item => {
      if (item.product.id === productId && !!item.isRefund === !!isRefund) {
        return { ...item, quantity: parseFloat(newQuantity.toFixed(3)) };
      }
      return item;
    });
  });
}

// Inside CartService:

public increaseQuantity(productId: string | number, delta = 1): void {
  this.items.update(current =>
    current.map(item =>
      String(item.product.id) === String(productId)
        ? { ...item, quantity: Number((item.quantity + delta).toFixed(3)) }
        : item
    )
  );
}

public decreaseQuantity(productId: string | number, delta = 1): void {
  this.items.update(current => {
    const target = current.find(item => String(item.product.id) === String(productId));
    if (!target) return current;

    const newQty = Number((target.quantity - delta).toFixed(3));
    if (newQty <= 0) {
      return current.filter(item => String(item.product.id) !== String(productId));
    }

    return current.map(item =>
      String(item.product.id) === String(productId)
        ? { ...item, quantity: newQty }
        : item
    );
  });
}

public clear(): void {
    this.clear();
  }
}