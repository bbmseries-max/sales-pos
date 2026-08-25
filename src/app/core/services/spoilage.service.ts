import { Injectable, signal, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { SpoilageLog, SpoilageReason, Product } from '../models';
import { MarketCatalogService } from './market-catalog.service';

@Injectable({ providedIn: 'root' })
export class SpoilageService {
  private catalogService = inject(MarketCatalogService);

  public logs = signal<SpoilageLog[]>([]);
  public isLoading = signal<boolean>(false);

  public reasonLabels: Record<SpoilageReason, { label: string; icon: string; color: string }> = {
    EXPIRED: { label: 'Ληγμένο Προϊόν', icon: '⏳', color: 'text-amber-400 bg-amber-950 border-amber-800' },
    DAMAGED: { label: 'Φθαρμένο / Σπασμένο', icon: '💥', color: 'text-rose-400 bg-rose-950 border-rose-800' },
    THEFT: { label: 'Κλοπή / Έλλειμμα', icon: '🥷', color: 'text-purple-400 bg-purple-950 border-purple-800' },
    SAMPLE: { label: 'Δειγματισμός / Γευσιγνωσία', icon: '🍷', color: 'text-sky-400 bg-sky-950 border-sky-800' },
    INTERNAL_USE: { label: 'Εσωτερική Κατανάλωση', icon: '☕', color: 'text-emerald-400 bg-emerald-950 border-emerald-800' }
  };

  public async loadLogs(): Promise<void> {
    this.isLoading.set(true);
    try {
      const records = await marketDb.spoilageLogs.reverse().toArray();
      this.logs.set(records);
    } catch (err) {
      console.error('Failed to load spoilage logs:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Records a spoilage protocol, writes to Dexie DB, and automatically decrements product stock
   */
  public async logSpoilage(params: {
    product: Product;
    quantity: number;
    reason: SpoilageReason;
    cashierName: string;
    notes?: string;
  }): Promise<SpoilageLog> {
    const { product, quantity, reason, cashierName, notes } = params;

    const unitCost = Number(product.costPrice ?? (product.price * 0.7).toFixed(2));
    const retailPrice = Number(product.price || 0);
    const totalLossCost = Number((unitCost * quantity).toFixed(2));

    const log: SpoilageLog = {
      id: `LOSS-${Date.now().toString().slice(-6)}`,
      productId: String(product.id),
      barcode: product.barcode || '',
      name: product.name,
      categoryName: product.categoryName || 'General',
      quantity,
      unitCost,
      retailPrice,
      totalLossCost,
      reason,
      timestamp: new Date().toISOString(),
      cashierName,
      notes: notes?.trim() || ''
    };

    // 1. Add log entry in Dexie DB
    if (!product.id) return null as any;
    await marketDb.spoilageLogs.add(log);

    // 2. Decrement physical stock in database
    const dbProduct: any = await marketDb.products.get(product.id);
    if (dbProduct) {
      const currentStock = Number(dbProduct.stockQuantity ?? dbProduct.stock ?? 0);
      const newStock = Math.max(0, currentStock - quantity);

      const updateObj: Record<string, any> = { stockQuantity: newStock };
      if ('stock' in dbProduct) updateObj['stock'] = newStock;

      await marketDb.products.update(dbProduct.id, updateObj);
      await this.catalogService.loadInitialCatalog(); // refresh catalog signal
    }

    await this.loadLogs();
    return log;
  }
}