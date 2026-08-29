import { Injectable, inject } from '@angular/core';
import { marketDb } from '../../core/db/market-db';
import { Product } from '../../core/models';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
export interface ImportParsedRow {
  barcode: string;
  name: string;
  price: number;
  costPrice?: number;
  vatRate?: number;
  stockQuantity?: number;
  categoryId?: string;
  categoryName?: string;
  isPinned?: boolean;
  isValid: boolean;
  error?: string;
  raw?: any;
}

@Injectable({ providedIn: 'root' })
export class CatalogImportService {
  private tenantConfig = inject(TenantConfigService);
  private catalogService = inject(MarketCatalogService);

  /**
   * Universal parser for CSV, TSV, Semicolon (;), or Pipe (|) TXT files
   */
  public parseCsvText(rawText: string): ImportParsedRow[] {
    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) return [];

    // Detect delimiter from the first line
    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes(';')) delimiter = ';';
    else if (firstLine.includes('\t')) delimiter = '\t';
    else if (firstLine.includes('|')) delimiter = '|';

    // Check if line 1 is a header
    const hasHeader = /barcode|name|title|price|sku|τιμη|ονομα/i.test(firstLine);
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line, idx) => {
      const cols = line.split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
      
      const barcode = cols[0] || '';
      const name = cols[1] || '';
      
      // Clean up price (convert "1,50" -> 1.50)
      const rawPrice = cols[2] ? cols[2].replace(',', '.') : '0';
      const price = parseFloat(rawPrice) || 0;

      const rawVat = cols[3] ? cols[3].replace(',', '.') : '13';
      const vatRate = parseFloat(rawVat) || 13;

      const rawStock = cols[4] ? cols[4].replace(',', '.') : '10';
      const stockQuantity = parseFloat(rawStock) || 10;

      const categoryName = cols[5] || 'Παντοπωλείο & Τρόφιμα';
      const categoryId = cols[6] || 'cat-pantry';

      let isValid = true;
      let error = '';

      if (!barcode) {
        isValid = false;
        error = 'Λείπει το Barcode / Κωδικός';
      } else if (!name) {
        isValid = false;
        error = 'Λείπει το όνομα προϊόντος';
      }

      return {
        barcode,
        name,
        price,
        costPrice: Number((price * 0.7).toFixed(2)),
        vatRate,
        stockQuantity,
        categoryId,
        categoryName,
        isValid,
        error: error || undefined
      };
    });
  }

  /**
   * Commits the parsed rows to Dexie stamped with the active tenant
   */
  public async commitImport(
    rows: ImportParsedRow[], 
    mode: 'UPSERT' | 'REPLACE' = 'UPSERT'
  ): Promise<{ added: number; updated: number }> {
    const activeStoreCode = this.tenantConfig.activeShop().code || 'mar-market';
    const validRows = rows.filter(r => r.isValid);

    if (validRows.length === 0) {
      return { added: 0, updated: 0 };
    }

    if (mode === 'REPLACE') {
      // Clear ONLY products belonging to this specific store
      const all = await marketDb.products.toArray();
      const idsToDelete = all
  .filter(p => (p.storeId || 'mar-market') === activeStoreCode)
  .map(p => p.id)
  .filter((id): id is string => id !== undefined && id !== null);

if (idsToDelete.length > 0) {
  await marketDb.products.bulkDelete(idsToDelete);
      }
    }

    let added = 0;
    let updated = 0;

    const existingProducts = await marketDb.products.toArray();
    const existingStoreMap = new Map<string, Product>();

    existingProducts
      .filter(p => (p.storeId || 'mar-market') === activeStoreCode)
      .forEach(p => existingStoreMap.set(p.barcode, p));

    const productsToSave: Product[] = [];

    for (const r of validRows) {
      const existing = existingStoreMap.get(r.barcode);

      if (existing) {
        productsToSave.push({
          ...existing,
          name: r.name,
          price: r.price,
          vatRate: r.vatRate ?? existing.vatRate,
          stockQuantity: r.stockQuantity ?? existing.stockQuantity,
          categoryId: r.categoryId || existing.categoryId,
          categoryName: r.categoryName || existing.categoryName,
          storeId: activeStoreCode,
          updatedAt: new Date().toISOString(),
          _syncStatus: 'dirty'
        });
        updated++;
      } else {
        productsToSave.push({
          id: `PROD-${activeStoreCode}-${r.barcode}`,
          barcode: r.barcode,
          sku: r.barcode,
          name: r.name,
          price: r.price,
          costPrice: r.costPrice || Number((r.price * 0.7).toFixed(2)),
          vatRate: r.vatRate ?? 13,
          stockQuantity: r.stockQuantity ?? 10,
          stock: r.stockQuantity ?? 10,
          categoryId: r.categoryId || 'cat-pantry',
          categoryName: r.categoryName || 'Παντοπωλείο & Τρόφιμα',
          storeId: activeStoreCode,
          isActive: true,
          isPinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _syncStatus: 'dirty'
        });
        added++;
      }
    }

    // Write to Dexie/IndexedDB
    await marketDb.products.bulkPut(productsToSave);

    // Refresh active catalog signals
    await this.catalogService.loadInitialCatalog();

    return { added, updated };
  }

  public generateSampleCsv(): string {
    return [
      'barcode;name;price;vatRate;stockQuantity;categoryName;categoryId',
      '5201010101010;Φρέσκο Γάλα 1L;1.65;13;20;Γαλακτοκομικά;cat-dairy',
      '5202020202020;Ψωμί Τοστ 500g;1.40;24;15;Αρτοποιείο & Snacks;cat-bakery',
      '5203030303030;Coca Cola 330ml;0.90;24;48;Αναψυκτικά & Ποτά;cat-drinks'
    ].join('\n');
  }
}