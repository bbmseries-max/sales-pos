import { Injectable, signal } from '@angular/core';
import { marketDb } from '../db/market-db';
import { Product, Category } from '../models';

export interface ExternalProductMatch {
  barcode: string;
  name: string;
  brand?: string;
  categoryName: string;
  imageUrl?: string;
  suggestedVatRate: number;
  suggestedPrice?: number;
}

@Injectable({ providedIn: 'root' })
export class MarketCatalogService {
  public products = signal<Product[]>([]);
  public categories = signal<Category[]>([]);
  public isSearchingExternal = signal<boolean>(false);

  public async loadInitialCatalog(): Promise<void> {
    const [productList, catList] = await Promise.all([
      marketDb.products.toArray(),
      marketDb.categories ? marketDb.categories.toArray() : Promise.resolve([])
    ]);

    this.products.set(productList);
    if (catList && catList.length > 0) {
      this.categories.set(catList);
    } else {
      // Derive unique categories from products if categories table is empty
      const derivedMap = new Map<string, Category>();
      productList.forEach(p => {
        const catName = p.categoryName || 'General';
        const catId = p.categoryId || 'CAT-GEN';
        if (!derivedMap.has(catId)) {
          derivedMap.set(catId, { id: catId, name: catName });
        }
      });
      this.categories.set(Array.from(derivedMap.values()));
    }
  }

  public getByBarcode(barcode: string): Product | undefined {
    return this.products().find(p => p.barcode === barcode);
  }

  public getProductByAnyIdentifier(query: string): Product | undefined {
    const q = query.trim().toLowerCase();
    return this.products().find(p => 
      p.barcode === query || 
      p.sku?.toLowerCase() === q || 
      p.id.toLowerCase() === q ||
      p.name.toLowerCase() === q
    );
  }

  public getProductImageUrl(product?: Product | null): string {
    if (product?.image && product.image.trim()) {
      return product.image;
    }
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%2364748b" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
  }

/**
   * Fast, resilient external lookup with timeout & Greek text normalization
   */
  public async fetchFromOpenFoodFacts(barcode: string): Promise<ExternalProductMatch | null> {
    const clean = (barcode || '').trim();
    if (!clean || clean.length < 6) return null;

    // Do not query online if it looks like a variable scale barcode (starts with 28 or 29)
    if (/^(28|29)\d{10,11}$/.test(clean)) {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800); // 1.8s max network budget

    const endpoints = [
      `https://world.openfoodfacts.org/api/v0/product/${clean}.json`,
      `https://corsproxy.io/?https://world.openfoodfacts.org/api/v0/product/${clean}.json`
    ];

    try {
      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
          });

          if (!res.ok) continue;

          const data = await res.json();
          if (data?.status === 1 && data.product) {
            const p = data.product;
            clearTimeout(timer);

            // 1. Greek Product Name Priority
            const rawName = p.product_name_el || p.generic_name_el || p.product_name || p.generic_name || '';
            const brand = p.brands ? p.brands.split(',')[0].trim() : '';
            let finalName = rawName || brand || `Είδος ${clean}`;

            if (brand && rawName && !rawName.toLowerCase().includes(brand.toLowerCase())) {
              finalName = `${brand} ${rawName}`;
            }

            // 2. Intelligent Category & Greek VAT Rate (13% vs 24%)
            let categoryName = 'General';
            let suggestedVat = 13;

            const categoryText = [
              p.categories || '',
              p.categories_tags ? p.categories_tags.join(' ') : '',
              p.product_name || ''
            ].join(' ').toLowerCase();

            if (/γάλα|τυρί|dairy|cheese|milk|yogurt|γιαούρτι|φέτα|αυγά|ψωμί|bread/i.test(categoryText)) {
              categoryName = 'Γαλακτοκομικά & Τρόφιμα';
              suggestedVat = 13;
            } else if (/αναψυκτικ|drink|beverage|soda|cola|juice|νερό|water|χυμός/i.test(categoryText)) {
              categoryName = 'Αναψυκτικά & Νερά';
              suggestedVat = 24;
            } else if (/σνακ|snack|biscuit|chocolate|chips|cookie|μπισκότ|σοκολάτ/i.test(categoryText)) {
              categoryName = 'Σνακ & Σοκολάτες';
              suggestedVat = 24;
            } else if (/καφές|coffee|tea|τσάι/i.test(categoryText)) {
              categoryName = 'Καφέδες & Ροφήματα';
              suggestedVat = 24;
            } else if (/απορρυπαντικ|clean|detergent|paper|χαρτί|σαπούνι/i.test(categoryText)) {
              categoryName = 'Καθαριστικά & Χαρτικά';
              suggestedVat = 24;
            } else if (/μπύρα|beer|wine|κρασί|alcohol|ποτό/i.test(categoryText)) {
              categoryName = 'Μπύρες & Αλκοολούχα';
              suggestedVat = 24;
            } else if (/ζυμαρικ|pasta|rice|ρύζι|όσπρια|λάδι|oil/i.test(categoryText)) {
              categoryName = 'Είδη Παντοπωλείου';
              suggestedVat = 13;
            }

            return {
              barcode: clean,
              name: finalName.trim(),
              brand,
              categoryName,
              imageUrl: p.image_front_small_url || p.image_url || '',
              suggestedVatRate: suggestedVat,
              suggestedPrice: 1.50
            };
          }
        } catch {
          // Continue to proxy endpoint if direct failed
        }
      }
    } finally {
      clearTimeout(timer);
    }

    return null;
  }

  public async autoRegisterProduct(params: {
    barcode: string;
    name: string;
    categoryName: string;
    price: number;
    vatRate: number;
    imageUrl?: string;
  }): Promise<Product> {
    const newProd: Product = {
      id: 'PROD-' + Date.now().toString(36),
      barcode: params.barcode,
      sku: params.barcode,
      name: params.name,
      categoryId: 'CAT-DISCOVERED',
      categoryName: params.categoryName || 'General',
      price: Number(params.price.toFixed(2)),
      costPrice: Number((params.price * 0.7).toFixed(2)),
      vatRate: params.vatRate || 13,
      stockQuantity: 10,
      stock: 10,
      image: params.imageUrl || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await marketDb.products.put(newProd);
    await this.loadInitialCatalog();
    return newProd;
  }

  /**
   * Resolves category name by categoryId with fallback
   */
  public getCategoryName(categoryId?: string): string {
    if (!categoryId) return 'General';
    const found = this.categories().find(c => c.id === categoryId);
    return found ? found.name : 'General';
  }

  /**
   * Updates category name across database and local state
   */
  public async updateCategoryName(categoryId: string, newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!categoryId || !trimmed) return;

    if (marketDb.categories) {
      await marketDb.categories.update(categoryId, { name: trimmed });
    }

    // Also update all products linked to this category
    const prods = await marketDb.products.where('categoryId').equals(categoryId).toArray();
    for (const p of prods) {
      await marketDb.products.update(p.id, { categoryName: trimmed });
    }

    await this.loadInitialCatalog();
  }

  /**
   * Auto-infers and back-fills category names from product names or existing categories
   */
  public async autoInferCategoryNames(): Promise<void> {
    const list = await marketDb.products.toArray();
    const updates: Promise<any>[] = [];

    const keywordRules: { match: RegExp; catId: string; catName: string }[] = [
      { match: /γάλα|τυρί|φέτα|γιαούρτι|βούτυρο|milk|cheese|feta|yogurt/i, catId: 'CAT-DAIRY', catName: 'Γαλακτοκομικά & Τυριά' },
      { match: /λάδι|ελαιόλαδο|ξύδι|oil|olive/i, catId: 'CAT-OIL', catName: 'Έλαια & Ξύδια' },
      { match: /μακαρόνια|σπαγγέτι|ρύζι|φακές|φασόλια|pasta|spaghetti|rice/i, catId: 'CAT-PASTA', catName: 'Ζυμαρικά & Όσπρια' },
      { match: /cola|νερό|αναψυκτικό|χυμός|soda|water|juice|sprite|fanta/i, catId: 'CAT-BEV', catName: 'Αναψυκτικά & Νερά' },
      { match: /καφές|nescafe|espresso|coffee|tea|τσάι/i, catId: 'CAT-COFFEE', catName: 'Καφέδες & Ροφήματα' },
      { match: /μπύρα|κρασί|τσίπουρο|beer|wine|vodka|whiskey/i, catId: 'CAT-ALCOHOL', catName: 'Μπύρες & Ποτά' },
      { match: /μπισκότα|σοκολάτα|κρουασάν|chips|snack|chocolate/i, catId: 'CAT-SNACK', catName: 'Σνακ & Μπισκότα' },
      { match: /skip|ariel|fairy|απορρυπαντικό|χαρτί|clean|soap/i, catId: 'CAT-CLEAN', catName: 'Απορρυπαντικά & Καθαριστικά' },
      { match: /μήλα|μπανάνες|ντομάτες|πατάτες|apple|banana|tomato/i, catId: 'CAT-PRODUCE', catName: 'Φρούτα & Λαχανικά' }
    ];

    for (const prod of list) {
      if (!prod.categoryName || prod.categoryName === 'General' || !prod.categoryId || prod.categoryId === 'CAT-GEN') {
        for (const rule of keywordRules) {
          if (rule.match.test(prod.name)) {
            updates.push(marketDb.products.update(prod.id, {
              categoryId: rule.catId,
              categoryName: rule.catName
            }));
            break;
          }
        }
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      await this.loadInitialCatalog();
    }
  }
}