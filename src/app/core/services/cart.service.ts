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
  public cartDiscountPercent = signal<number>(0);

  // Cart State Signals
  public heldTickets = signal<{ id: string; timestamp: string; items: CartItem[]; note?: string }[]>([]);
  public items = signal<CartItem[]>([]);
  public isRefundMode = signal<boolean>(false);
  public lastProcessedReceipt = signal<TransactionRecord | null>(null);

  // Computed Totals & Greek VAT Breakdown
  public grandTotal = computed(() => {
    const lineTotal = this.items().reduce((sum, item) => {
    const originalLine = (item.product.price || 0) * item.quantity;
    const itemDiscPct = item.discountPercent || 0;
    const itemDiscVal = item.discountAmount || (originalLine * (itemDiscPct / 100));
    const effectiveLine = Math.max(0, originalLine - itemDiscVal);
    
    return sum + (item.isRefund ? -effectiveLine : effectiveLine);
  }, 0);

  const cartDisc = lineTotal * (this.cartDiscountPercent() / 100);
  return Math.max(0, Number((lineTotal - cartDisc).toFixed(2)));
});

  public netSubtotal = computed(() => {
   const basketRatio = 1 - (this.cartDiscountPercent() / 100);

  return this.items().reduce((sum, item) => {
    const rate = item.product.vatRate || 24;
    const divisor = 1 + rate / 100;
    
    const originalLine = (item.product.price || 0) * item.quantity;
    const itemDiscPct = item.discountPercent || 0;
    const itemDiscVal = item.discountAmount || (originalLine * (itemDiscPct / 100));
    const effectiveLine = Math.max(0, originalLine - itemDiscVal) * basketRatio;
    
    const lineNet = effectiveLine / divisor;
    return sum + (item.isRefund ? -lineNet : lineNet);
  }, 0);
  });

  // Set discount on a specific item in the cart
public setItemDiscount(productId: string | number, discountPercent: number): void {
  this.items.update(curr =>
    curr.map(item =>
      String(item.product.id || item.product.barcode) === String(productId)
        ? { ...item, discountPercent: Math.min(100, Math.max(0, discountPercent)) }
        : item
    )
  );
}

// Set discount on the entire basket
public setCartDiscount(percent: number): void {
  this.cartDiscountPercent.set(Math.min(100, Math.max(0, percent)));
}

  public totalTaxAmount = computed(() => this.grandTotal() - this.netSubtotal());
  public totalItemCount = computed(() => this.items().reduce((sum, i) => sum + (i.product.isWeighted ? 1 : i.quantity), 0));

  // --- CART MUTATIONS ---

// In src/app/core/services/cart.service.ts:

  public addItem(product: Product, quantity?: number, forceRefund?: boolean): boolean {
    const isRef = forceRefund !== undefined ? forceRefund : this.isRefundMode();
    const qty = quantity !== undefined ? quantity : (product.isWeighted ? 0.500 : 1);
    const prodId = product.id || product.barcode;
    const availableStock = product.stockQuantity ?? 0;

    // Reject non-refund sales if stock is 0 or less
    if (!isRef && availableStock <= 0) {
      return false;
    }

    let success = true;

    this.items.update(curr => {
      const idx = curr.findIndex(i => (i.product.id || i.product.barcode) === prodId && !!i.isRefund === !!isRef);
      if (idx > -1) {
        const copy = [...curr];
        const step = quantity !== undefined ? quantity : (product.isWeighted ? 0.100 : 1);
        const proposedQty = parseFloat((copy[idx].quantity + step).toFixed(3));

        // Block increment if proposed quantity exceeds stock
        if (!isRef && proposedQty > availableStock) {
          success = false;
          return curr;
        }

        copy[idx] = { ...copy[idx], quantity: proposedQty };
        return copy;
      }

      // Block initial add if requested quantity exceeds stock
      if (!isRef && qty > availableStock) {
        success = false;
        return curr;
      }

      return [...curr, { product, quantity: qty, isRefund: isRef }];
    });

    return success;
  }

  public increaseQuantity(productId: string | number, delta = 1): boolean {
    let success = true;

    this.items.update(current =>
      current.map(item => {
        if (String(item.product.id || item.product.barcode) === String(productId)) {
          const availableStock = item.product.stockQuantity ?? 0;
          const proposedQty = Number((item.quantity + delta).toFixed(3));

          if (!item.isRefund && proposedQty > availableStock) {
            success = false;
            return item;
          }

          return { ...item, quantity: proposedQty };
        }
        return item;
      })
    );

    return success;
  }

  public removeItem(productId: string, isRefund = false): void {
    this.items.update(curr => {
      const idx = curr.findIndex(i => (i.product.id || i.product.barcode) === productId && !!i.isRefund === !!isRefund);
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

  public clear(): void {
    this.clearCart();
    this.cartDiscountPercent.set(0);
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
      this.addItem(product, 1);
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
    const taxAmount = this.totalTaxAmount();
    const subtotal = this.netSubtotal();

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

  // 1. Atomic Transaction: Save TX & Deduct Product Stock from Dexie
    await marketDb.transaction('rw', [marketDb.transactions, marketDb.products], async () => {
      console.log('[CHECKOUT] 🚀 Starting checkout transaction for items:', currentItems);
      await marketDb.transactions.add(record);

      for (const item of currentItems) {
        const prod = item.product;
        const targetBarcode = String(prod.barcode || '').trim();
        const qtySold = Number(item.quantity) || 0;

        console.log(`[CHECKOUT] Processing item: ${prod.name}, Barcode: ${targetBarcode}, Qty: ${qtySold}`);

        // Direct lookup by barcode (guaranteed to match)
        const dbProd = await marketDb.products.where('barcode').equals(targetBarcode).first();

        if (dbProd) {
          const currentQty = Number(dbProd.stockQuantity ?? dbProd.stock ?? 0);
          const delta = item.isRefund ? qtySold : -qtySold;
          const newQty = Number(Math.max(0, currentQty + delta).toFixed(3));

          console.log(`[CHECKOUT] Found in DB! Current: ${currentQty} -> New: ${newQty}`);

          // Update using the record's primary key
          const keyToUpdate = dbProd.id !== undefined ? dbProd.id : dbProd.barcode;
          await marketDb.products.update(keyToUpdate, {
            stockQuantity: newQty,
            stock: newQty,
            updatedAt: new Date().toISOString(),
            _syncStatus: 'dirty'
          });

          console.log(`[CHECKOUT] ✅ Updated stock in Dexie for key ${keyToUpdate}`);
        } else {
          console.error(`[CHECKOUT] ❌ Product with barcode ${targetBarcode} NOT found in Dexie!`);
        }
      }
    });

    console.log('[CHECKOUT] Refreshing UI catalog...');
    await this.catalogService.loadInitialCatalog();

    // 3. Store last receipt & reset cart
    this.lastProcessedReceipt.set(record);
    this.clear();

    return record;
  }

  public addProduct(product: Product, quantity?: number, forceRefund?: boolean): void {
    this.addItem(product, quantity, forceRefund);
  }

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

  public recallTicket(ticketId: string): void {
    const ticket = this.heldTickets().find(t => t.id === ticketId);
    if (!ticket) return;

    this.items.set([...ticket.items]);
    this.heldTickets.update(list => list.filter(t => t.id !== ticketId));
  }

  public removeHeldTicket(ticketId: string): void {
    this.heldTickets.update(list => list.filter(t => t.id !== ticketId));
  }

  public recallLastTicket(): boolean {
    const tickets = this.heldTickets();
    if (tickets.length === 0) return false;

    const lastTicket = tickets[tickets.length - 1];
    this.items.set([...lastTicket.items]);
    this.heldTickets.set(tickets.slice(0, -1));
    return true;
  }

  public isExpired(product?: Product | null): boolean {
    if (!product?.expire) return false;
    const d = new Date(product.expire);
    return !isNaN(d.getTime()) && d < new Date();
  }

  public taxBreakdown = computed(() => {
    const breakdown: Record<number, { net: number; vat: number; gross: number }> = {
      24: { net: 0, vat: 0, gross: 0 },
      13: { net: 0, vat: 0, gross: 0 },
      6: { net: 0, vat: 0, gross: 0 },
      0: { net: 0, vat: 0, gross: 0 }
    };

    for (const item of this.items()) {
     const rate = (item.product.vatRate !== undefined && item.product.vatRate !== null) 
  ? Number(item.product.vatRate) 
  : 24;
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

  public updateQuantity(productId: string, newQuantity: number, isRefund = false): void {
    if (newQuantity <= 0) {
      this.removeItem(productId, isRefund);
      return;
    }

    this.items.update(curr => {
      return curr.map(item => {
        if ((item.product.id || item.product.barcode) === productId && !!item.isRefund === !!isRefund) {
          return { ...item, quantity: parseFloat(newQuantity.toFixed(3)) };
        }
        return item;
      });
    });
  }

  public decreaseQuantity(productId: string | number, delta = 1): void {
    this.items.update(current => {
      const target = current.find(item => String(item.product.id || item.product.barcode) === String(productId));
      if (!target) return current;

      const newQty = Number((target.quantity - delta).toFixed(3));
      if (newQty <= 0) {
        return current.filter(item => String(item.product.id || item.product.barcode) !== String(productId));
      }

      return current.map(item =>
        String(item.product.id || item.product.barcode) === String(productId)
          ? { ...item, quantity: newQty }
          : item
      );
    });
  }
}