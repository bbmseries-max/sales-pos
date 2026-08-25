import { Injectable, signal } from '@angular/core';
import { marketDb } from '../db/market-db';

export interface LocalProductItem {
  id: string;
  barcode?: string;
  categoryId?: string;
  name: string;
  price: number;
  stockQuantity?: number;
  stock?: number;
  purchasePrice?: number;
  taxRate?: number; // e.g. 1.24, 1.13, 1.06
  vatRate?: number; // e.g. 24, 13, 6
  isActive?: boolean;
  notes?: string;
  isWeighted?: boolean;
  expire?: string;
  updatedAt?: string;
}

export interface HubNormalizedProduct {
  sku: string;
  barcode: string;
  title: string;
  retailPriceGross: number;
  retailPriceNet: number;
  costPrice: number;
  vatRatePercent: number;
  stock: number;
  isWeighted: boolean;
  unit: 'kg' | 'pcs';
  status: 'ACTIVE' | 'ARCHIVED';
  marginPercent: number;
  lastSyncedAt: string;
}

@Injectable({ providedIn: 'root' })
export class HubCatalogSyncService {
  public isSyncing = signal<boolean>(false);

  /**
   * Transforms local Dexie products into clean normalized Hub items
   */
  public transformForHub(item: LocalProductItem): HubNormalizedProduct {
    // Determine tax rate multiplier (supports both taxRate: 1.24 and vatRate: 24)
    let taxMultiplier = 1.24;
    let vatPercent = 24;

    if (item.taxRate && item.taxRate > 1) {
      taxMultiplier = item.taxRate;
      vatPercent = Math.round((taxMultiplier - 1) * 100);
    } else if (item.vatRate) {
      vatPercent = item.vatRate;
      taxMultiplier = 1 + (item.vatRate / 100);
    }

    const priceGross = Number(item.price || 0);
    const netPrice = Number((priceGross / taxMultiplier).toFixed(2));
    const cost = Number((item.purchasePrice || 0).toFixed(2));
    const margin = cost > 0 && priceGross > 0
      ? Number((((priceGross - (cost * taxMultiplier)) / priceGross) * 100).toFixed(1))
      : 0;

    const availableStock = item.stockQuantity ?? item.stock ?? 0;

    return {
      sku: item.barcode || item.id,
      barcode: item.barcode || item.id,
      title: (item.name || '').trim(),
      retailPriceGross: Number(priceGross.toFixed(2)),
      retailPriceNet: netPrice,
      costPrice: cost,
      vatRatePercent: vatPercent,
      stock: Number(availableStock),
      isWeighted: Boolean(item.isWeighted),
      unit: item.isWeighted ? 'kg' : 'pcs',
      status: item.isActive !== false ? 'ACTIVE' : 'ARCHIVED',
      marginPercent: margin,
      lastSyncedAt: new Date().toISOString()
    };
  }

  /**
   * Generates a downloadable JSON file ready for direct bulk import into the Hub
   */
  public async exportHubJsonFile(): Promise<void> {
    const all = await marketDb.products.toArray();
    const normalized = all.map(p => this.transformForHub(p as unknown as LocalProductItem));

    const blob = new Blob([JSON.stringify(normalized, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hub_catalog_3000_items_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url); // Pass url string here
  }

  /**
   * Pushes in chunks of 500 items via HTTP POST
   */
  public async pushBatchToHubApi(hubEndpointUrl: string, apiKey: string): Promise<number> {
    this.isSyncing.set(true);
    try {
      const all = await marketDb.products.toArray();
      const normalized = all.map(p => this.transformForHub(p as unknown as LocalProductItem));

      const chunkSize = 500;
      let totalSynced = 0;

      for (let i = 0; i < normalized.length; i += chunkSize) {
        const chunk = normalized.slice(i, i + chunkSize);

        const res = await fetch(hubEndpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            storeIdentifier: 'STORE-VRILISSIA',
            batchIndex: Math.floor(i / chunkSize) + 1,
            items: chunk
          })
        });

        if (!res.ok) {
          throw new Error(`Batch push failed at index ${i}`);
        }

        totalSynced += chunk.length;
      }

      return totalSynced;
    } finally {
      this.isSyncing.set(false);
    }
  }
}