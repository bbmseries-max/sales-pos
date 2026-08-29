import { Injectable, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { Product } from '../models';
import { MarketCatalogService } from './market-catalog.service';

export interface ImportParsedRow {
  barcode: string;
  sku?: string;
  name: string;
  categoryName?: string;
  categoryId?: string;
  price: number;
  costPrice?: number;
  vatRate: number;
  stockQuantity: number;
  expire?: string;
  shelfLocation?: string;
  isWeighted?: boolean;
  isValid: boolean;
  validationError?: string;
}

interface HeaderIndices {
  barcode: number;
  name: number;
  category: number;
  price: number;
  cost: number;
  vat: number;
  stock: number;
  expiry: number;
  shelf: number;
  weighted: number;
}

@Injectable({ providedIn: 'root' })
export class CatalogImportService {
  private catalogService = inject(MarketCatalogService);

  public generateSampleCsv(): string {
    const headers = [
      'Barcode',
      'Name',
      'Category',
      'RetailPrice',
      'CostPrice',
      'VAT',
      'Stock',
      'ExpiryDate',
      'ShelfLocation',
      'IsWeighted'
    ];

    const sampleRows = [
      '5201004001010;Φέτα Δωδώνη ΠΟΠ 400g;Γαλακτοκομικά;5.80;4.10;13;25;2026-12-31;A2;0',
      '5201010101010;Γάλα Όλυμπος Επιλεγμένο 1L;Γαλακτοκομικά;1.85;1.30;13;40;2026-09-15;A1;0',
      '5201123456789;Barilla Spaghetti No5 500g;Ζυμαρικά;1.45;0.95;13;60;2027-05-30;B4;0',
      '5201999888777;Μήλα Στάρκιν Αγιάς (Κιλό);Μανάβικη;2.10;1.20;13;50;;C1;1',
      '5200000000123;Coca-Cola Regular 330ml;Αναψυκτικά;0.90;0.55;24;120;2027-01-01;D3;0'
    ];

    return '\uFEFF' + headers.join(';') + '\n' + sampleRows.join('\n');
  }

  public parseCsvText(rawText: string): ImportParsedRow[] {
    const cleanText = rawText.replace(/^\uFEFF/, '').trim();
    if (!cleanText) return [];

    const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    // Auto-detect delimiter
    const firstLine = lines[0];
    let delimiter = ';';
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const pipeCount = (firstLine.match(/\|/g) || []).length;

    if (tabCount > semicolonCount && tabCount > commaCount) delimiter = '\t';
    else if (pipeCount > semicolonCount && pipeCount > commaCount) delimiter = '|';
    else if (commaCount > semicolonCount) delimiter = ',';

    // Check if line 1 is a header or data
    const hasHeader = /barcode|ean|κωδικ|name|ονομα|τιμη|price|retail|category/i.test(firstLine);

    let colIndex: HeaderIndices;
    let dataLines: string[];

    if (hasHeader) {
      const headers = this.parseLine(firstLine, delimiter).map(h => h.trim().toLowerCase());
      colIndex = this.mapHeaderIndices(headers);
      dataLines = lines.slice(1);
    } else {
      // Positional defaults: [0: barcode, 1: name, 2: price, 3: vat, 4: stock, 5: category]
      colIndex = {
        barcode: 0,
        name: 1,
        price: 2,
        vat: 3,
        stock: 4,
        category: 5,
        cost: -1,
        expiry: -1,
        shelf: -1,
        weighted: -1
      };
      dataLines = lines;
    }

    const parsedRows: ImportParsedRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const cols = this.parseLine(dataLines[i], delimiter);
      if (cols.length === 0 || (cols.length === 1 && !cols[0].trim())) continue;

      const barcode = this.getCol(cols, colIndex.barcode).trim();
      const name = this.getCol(cols, colIndex.name).trim();
      const rawPrice = this.getCol(cols, colIndex.price).replace(',', '.').trim();
      const rawCost = this.getCol(cols, colIndex.cost).replace(',', '.').trim();
      const rawVat = this.getCol(cols, colIndex.vat).replace(',', '.').trim();
      const rawStock = this.getCol(cols, colIndex.stock).replace(',', '.').trim();
      const rawExpiry = this.getCol(cols, colIndex.expiry).trim();
      const categoryName = this.getCol(cols, colIndex.category).trim() || 'Παντοπωλείο & Τρόφιμα';
      const shelfLocation = this.getCol(cols, colIndex.shelf).trim();
      const rawWeighted = this.getCol(cols, colIndex.weighted).trim().toLowerCase();

      const price = parseFloat(rawPrice) || 0;
      const costPrice = rawCost ? parseFloat(rawCost) : Number((price * 0.7).toFixed(2));
      const vatRate = rawVat !== '' && !isNaN(parseInt(rawVat, 10)) ? parseInt(rawVat, 10) : 13;
      const stockQuantity = rawStock !== '' && !isNaN(parseFloat(rawStock)) ? parseFloat(rawStock) : 10;
      const isWeighted = rawWeighted === '1' || rawWeighted === 'true' || rawWeighted === 'yes' || rawWeighted === 'ναι';

      let isValid = true;
      let validationError = '';

      if (!barcode && !name) {
        continue; // Skip empty rows
      }

      if (!name) {
        isValid = false;
        validationError = 'Λείπει το Όνομα Προϊόντος';
      } else if (!barcode) {
        isValid = false;
        validationError = 'Λείπει το Barcode / EAN';
      }

      parsedRows.push({
        barcode,
        sku: barcode,
        name,
        categoryName,
        price: Number(price.toFixed(2)),
        costPrice: Number(costPrice.toFixed(2)),
        vatRate,
        stockQuantity,
        expire: rawExpiry || undefined,
        shelfLocation: shelfLocation || undefined,
        isWeighted,
        isValid,
        validationError: validationError || undefined
      });
    }

    return parsedRows;
  }

  public async commitImport(rows: ImportParsedRow[], mode: 'UPSERT' | 'REPLACE' = 'UPSERT'): Promise<{ added: number; updated: number }> {
    const validRows = rows.filter(r => r.isValid);
    if (validRows.length === 0) return { added: 0, updated: 0 };

    if (mode === 'REPLACE') {
      await marketDb.products.clear();
    }

    const existingList = await marketDb.products.toArray();
    const barcodeMap = new Map<string, Product>();
    existingList.forEach(p => {
      if (p.barcode) barcodeMap.set(p.barcode, p);
    });

    let added = 0;
    let updated = 0;
    const productsToPut: Product[] = [];

    for (const row of validRows) {
      const existing = barcodeMap.get(row.barcode);

      if (existing && mode === 'UPSERT') {
        const updatedProd: Product = {
          ...existing,
          name: row.name,
          categoryName: row.categoryName || existing.categoryName,
          price: row.price,
          costPrice: row.costPrice ?? existing.costPrice,
          vatRate: row.vatRate,
          stockQuantity: row.stockQuantity,
          stock: row.stockQuantity,
          expire: row.expire || existing.expire,
          shelfLocation: row.shelfLocation || existing.shelfLocation,
          isWeighted: row.isWeighted ?? existing.isWeighted,
          updatedAt: new Date().toISOString(),
          _syncStatus: 'dirty'
        };
        productsToPut.push(updatedProd);
        updated++;
      } else {
        const newProd: Product = {
          id: `PROD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          barcode: row.barcode,
          sku: row.sku || row.barcode,
          name: row.name,
          categoryId: row.categoryId || 'cat-pantry',
          categoryName: row.categoryName || 'Παντοπωλείο & Τρόφιμα',
          price: row.price,
          costPrice: row.costPrice,
          vatRate: row.vatRate,
          stockQuantity: row.stockQuantity,
          stock: row.stockQuantity,
          expire: row.expire,
          shelfLocation: row.shelfLocation,
          isWeighted: row.isWeighted || false,
          isActive: true,
          isPinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _syncStatus: 'dirty'
        };
        productsToPut.push(newProd);
        barcodeMap.set(row.barcode, newProd);
        added++;
      }
    }

    await marketDb.products.bulkPut(productsToPut);
    await this.catalogService.loadInitialCatalog();

    return { added, updated };
  }

  private mapHeaderIndices(headers: string[]): HeaderIndices {
    const findIdx = (aliases: string[]): number => {
      return headers.findIndex(h => aliases.some(a => h.includes(a)));
    };

    return {
      barcode: findIdx(['barcode', 'ean', 'κωδικος', 'barcode/ean', 'code']),
      name: findIdx(['name', 'title', 'περιγραφη', 'ονομα', 'ειδος', 'item']),
      category: findIdx(['category', 'κατηγορια', 'group', 'τμημα']),
      price: findIdx(['retailprice', 'price', 'λιανικη', 'τιμη', 'τιμη λιανικης']),
      cost: findIdx(['costprice', 'cost', 'χονδρικη', 'κοστος', 'τιμη αγορας']),
      vat: findIdx(['vat', 'φπα', 'tax', 'συντελεστης']),
      stock: findIdx(['stock', 'αποθεμα', 'ποσοτητα', 'qty', 'quantity']),
      expiry: findIdx(['expiry', 'expire', 'ληξη', 'ημερομηνια ληξης', 'date']),
      shelf: findIdx(['shelf', 'ραφι', 'θεση', 'location', 'shelflocation']),
      weighted: findIdx(['weighted', 'ζυγιζομενο', 'scale', 'κιλο', 'kg'])
    };
  }

  private getCol(cols: string[], index: number): string {
    return index >= 0 && index < cols.length ? cols[index] : '';
  }

  private parseLine(line: string, delimiter: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));
    return values;
  }
}