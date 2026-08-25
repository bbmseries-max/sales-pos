import { Injectable, signal } from '@angular/core';
import { marketDb } from '../db/market-db';
import { Product } from '../models';

export interface ImportSummary {
  totalReceived: number;
  importedCount: number;
  skippedDuplicates: number;
  errorCount: number;
  tenantId: string;
}

@Injectable({ providedIn: 'root' })
export class TenantCatalogImporterService {
  public isImporting = signal<boolean>(false);
  public importProgress = signal<number>(0);
  public lastSummary = signal<ImportSummary | null>(null);

  /**
   * Imports a raw product array or Hub JSON file into Dexie for a specific tenant
   */
  public async importCatalogForTenant(
    rawProducts: any[], 
    tenantId = 'mar-market'
  ): Promise<ImportSummary> {
    this.isImporting.set(true);
    this.importProgress.set(0);

    const summary: ImportSummary = {
      totalReceived: rawProducts.length,
      importedCount: 0,
      skippedDuplicates: 0,
      errorCount: 0,
      tenantId
    };

    const seenBarcodes = new Set<string>();
    const validProducts: Product[] = [];

    // 1. Validation & Deduplication Pass
    for (const raw of rawProducts) {
      try {
        const barcode = (raw.barcode || raw.sku || raw.id || '').toString().trim();
        const name = (raw.name || raw.title || '').toString().trim();
        const price = Number(raw.price || raw.retailPriceGross || 0);

        if (!name || price <= 0) {
          summary.errorCount++;
          continue;
        }

        if (barcode && seenBarcodes.has(barcode)) {
          summary.skippedDuplicates++;
          continue;
        }
        if (barcode) seenBarcodes.add(barcode);

        // Normalize VAT rate
        let vatRate = 24;
        if (raw.vatRatePercent) {
          vatRate = raw.vatRatePercent;
        } else if (raw.taxRate && raw.taxRate > 1) {
          vatRate = Math.round((raw.taxRate - 1) * 100);
        } else if (raw.vatRate) {
          vatRate = raw.vatRate;
        }

        const product: Product = {
          id: raw.id ? String(raw.id) : `PROD-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          barcode: barcode || undefined,
          sku: raw.sku || barcode || undefined,
          categoryId: raw.categoryId ? String(raw.categoryId) : '100',
          categoryName: raw.categoryName || 'General',
          name,
          price,
          vatRate,
          stockQuantity: Number(raw.stockQuantity ?? raw.stock ?? 0),
          costPrice: Number(raw.purchasePrice ?? raw.costPrice ?? 0),
          isWeighted: Boolean(raw.isWeighted),
          isActive: raw.isActive !== false && raw.status !== 'ARCHIVED',
          isPinned: Boolean(raw.isPinned),
          expire: raw.expire || undefined,
          notes: raw.notes ? String(raw.notes) : `Tenant: ${tenantId}`,
          updatedAt: new Date().toISOString()
        };

        validProducts.push(product);
      } catch {
        summary.errorCount++;
      }
    }

    // 2. Chunked Batch Persistence (500 items per Dexie transaction)
    const chunkSize = 500;
    for (let i = 0; i < validProducts.length; i += chunkSize) {
      const chunk = validProducts.slice(i, i + chunkSize);
      await marketDb.products.bulkPut(chunk);
      summary.importedCount += chunk.length;
      this.importProgress.set(Math.round((summary.importedCount / validProducts.length) * 100));
    }

    this.isImporting.set(false);
    this.lastSummary.set(summary);
    return summary;
  }

  /**
   * Helper to parse and import a JSON file uploaded from disk
   */
  public async importFromFile(file: File, tenantId = 'mar-market'): Promise<ImportSummary> {
    const text = await file.text();
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : data.products || Object.values(data);
    return this.importCatalogForTenant(items, tenantId);
  }
}