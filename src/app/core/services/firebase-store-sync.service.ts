import { Injectable } from '@angular/core';
import { marketDb } from '../db/market-db';

@Injectable({ providedIn: 'root' })
export class FirebaseStoreSyncService {
  /**
   * Syncs from your Vercel endpoint or Firebase REST export
   */
  public async syncFromApi(
    apiEndpointUrl: string,
    tenantId = 'mar-market'
  ): Promise<number> {
    const res = await fetch(apiEndpointUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch from remote: ${res.statusText}`);
    }

    const rawData = await res.json();
    const rawItems: any[] = Array.isArray(rawData)
      ? rawData
      : (rawData.products || Object.values(rawData));

    if (!rawItems || rawItems.length === 0) return 0;

    const mappedProducts = rawItems.map((doc: any) => {
      // Map taxRate (0.13 -> 13%, 0.24 -> 24%)
      const rawTax = Number(doc.taxRate || 0);
      let vatPercent = 24;
      if (rawTax > 0 && rawTax < 1) {
        vatPercent = Math.round(rawTax * 100);
      } else if (rawTax >= 1) {
        vatPercent = Math.round((rawTax - 1) * 100);
      }

      return {
        id: String(doc.id || doc.barcode || `PROD-${Date.now()}`),
        barcode: String(doc.barcode || doc.id || '').trim(),
        name: String(doc.name || '').trim(),
        categoryId: String(doc.categoryId || '100'),
        supplierId: String(doc.supplierId || ''),
        price: Number(doc.price || 0),
        purchasePrice: Number(doc.purchasePrice || 0),
        taxRate: rawTax < 1 ? (1 + rawTax) : rawTax,
        vatRate: vatPercent,
        stockQuantity: Number(doc.stockQuantity ?? 0),
        isActive: doc.status === 'Active' || doc.isActive !== false,
        isWeighted: Boolean(doc.isWeighted),
        expireDate: doc.statusDate || null,
        tenantId: tenantId,
        updatedAt: new Date().toISOString()
      };
    });

    // Chunked bulk put into IndexedDB (500 per transaction)
    const chunkSize = 500;
    for (let i = 0; i < mappedProducts.length; i += chunkSize) {
      const chunk = mappedProducts.slice(i, i + chunkSize);
      await marketDb.products.bulkPut(chunk);
    }

    return mappedProducts.length;
  }

  /**
   * Alternatively, import directly from a downloaded JSON file from Firebase Console
   */
  public async syncFromJsonFile(file: File, tenantId = 'mar-market'): Promise<number> {
    const text = await file.text();
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : (data.products || Object.values(data));
    
    // Create a temporary Blob URL and use syncFromApi
    const blob = new Blob([JSON.stringify(items)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      return await this.syncFromApi(url, tenantId);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}