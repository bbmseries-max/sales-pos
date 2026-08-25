import { Injectable, signal } from '@angular/core';
import { marketDb } from '../db/market-db';
import { 
  Product, 
  Category
} from '../models';
import { SUPERMARKET_DEPARTMENTS, 
  MasterCategory  } from '../models/market.models'

export interface ExternalProductMatch {
  barcode: string;
  name: string;
  brand?: string;
  categoryId: string;
  categoryName: string;
  imageUrl?: string;
  suggestedVatRate: number;
  suggestedPrice?: number;
}

@Injectable({ providedIn: 'root' })
export class MarketCatalogService {
  public products = signal<Product[]>([]);
  public categories = signal<Category[]>([]);
  public readonly departments: MasterCategory[] = SUPERMARKET_DEPARTMENTS;
  public isSearchingExternal = signal<boolean>(false);

  public getCategoryName(categoryId?: string): string {
    const found = this.departments.find(d => d.id === categoryId);
    return found ? found.name : 'Παντοπωλείο & Τρόφιμα';
  }

  public getCategoryIcon(categoryId?: string): string {
    const found = this.departments.find(d => d.id === categoryId);
    return found ? found.icon : '🥫';
  }

  public async loadInitialCatalog(): Promise<void> {
    const [prods, cats] = await Promise.all([
      marketDb.products.toArray(),
      marketDb.categories.toArray()
    ]);

    this.products.set(prods);

    if (cats && cats.length > 0) {
      this.categories.set(cats);
    } else {
      // Initialize with the standard master departments
      const derivedCats = this.departments.map(d => ({
        id: d.id,
        name: d.name,
        tenantId: 'mar-market'
      }));
      this.categories.set(derivedCats);
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
      p.id?.toLowerCase() === q ||
      p.name.toLowerCase() === q
    );
  }

  public getCategoryPlaceholderSvg(categoryId?: string): string {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="%2364748b" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="3" fill="%230f172a"/><circle cx="9" cy="9" r="2" stroke="%2310b981"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" stroke="%2310b981"/></svg>';
  }

  public getProductImageUrl(product: Partial<Product>): string {
    // 1. Direct explicit URL/path
    const direct = product.imageUrl || product.image;
    if (direct && direct.trim().length > 0) {
      return direct.trim();
    }

    // 2. Local public asset path: /products/{barcode}.webp
    const barcode = String(product.barcode || product.id || '').trim();
    if (barcode && barcode.length >= 3) {
      return `/products/${barcode}.webp`;
    }

    // 3. Fallback placeholder SVG
    return this.getCategoryPlaceholderSvg(product.categoryId);
  }

  /**
   * Fast, resilient external lookup mapped directly to standard departments
   */
  public async fetchFromOpenFoodFacts(barcode: string): Promise<ExternalProductMatch | null> {
    const clean = (barcode || '').trim();
    if (!clean || clean.length < 6) return null;

    if (/^(28|29)\d{10,11}$/.test(clean)) {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);

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

            const rawName = p.product_name_el || p.generic_name_el || p.product_name || p.generic_name || '';
            const brand = p.brands ? p.brands.split(',')[0].trim() : '';
            let finalName = rawName || brand || `Είδος ${clean}`;

            if (brand && rawName && !rawName.toLowerCase().includes(brand.toLowerCase())) {
              finalName = `${brand} ${rawName}`;
            }

            // Map strictly to one of the 8 standard SUPERMARKET_DEPARTMENTS
            let categoryId = 'cat-pantry';
            let suggestedVat = 13;

            const categoryText = [
              p.categories || '',
              p.categories_tags ? p.categories_tags.join(' ') : '',
              p.product_name || ''
            ].join(' ').toLowerCase();

            if (/γάλα|τυρί|dairy|cheese|milk|yogurt|γιαούρτι|φέτα|αυγά|αλλαντικ|ζαμπον/i.test(categoryText)) {
              categoryId = 'cat-dairy';
              suggestedVat = 13;
            } else if (/ψωμί|bread|μπισκότ|snack|biscuit|chocolate|chips|cookie|σοκολάτ|κρουασάν/i.test(categoryText)) {
              categoryId = 'cat-bakery';
              suggestedVat = 24;
            } else if (/αναψυκτικ|drink|beverage|soda|cola|juice|νερό|water|χυμός|beer|wine|μπύρα|κρασί|alcohol/i.test(categoryText)) {
              categoryId = 'cat-drinks';
              suggestedVat = 24;
            } else if (/καθαριστικ|απορρυπαντικ|clean|detergent|paper|χαρτί|σαπούνι/i.test(categoryText)) {
              categoryId = 'cat-cleaning';
              suggestedVat = 24;
            } else if (/τσιγάρ|καπν|tobacco|vape|ψιλικ/i.test(categoryText)) {
              categoryId = 'cat-tobacco';
              suggestedVat = 24;
            } else if (/σκυλ|γατ|pet|dog|cat|ζωοτροφ/i.test(categoryText)) {
              categoryId = 'cat-pets';
              suggestedVat = 24;
            } else if (/μήλα|μπανάν|ντομάτ|πατάτ|fruit|vegetable|λαχανικ|φρούτ/i.test(categoryText)) {
              categoryId = 'cat-fruit';
              suggestedVat = 13;
            }

            return {
              barcode: clean,
              name: finalName.trim(),
              brand,
              categoryId,
              categoryName: this.getCategoryName(categoryId),
              imageUrl: p.image_front_small_url || p.image_url || '',
              suggestedVatRate: suggestedVat,
              suggestedPrice: 1.50
            };
          }
        } catch {
          // Continue to fallback endpoint
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
    categoryId?: string;
    categoryName?: string;
    price: number;
    vatRate: number;
    imageUrl?: string;
  }): Promise<Product> {
    const assignedCatId = params.categoryId || 'cat-pantry';
    const newProd: Product = {
      id: 'PROD-' + Date.now().toString(36),
      barcode: params.barcode,
      sku: params.barcode,
      name: params.name,
      categoryId: assignedCatId,
      categoryName: params.categoryName || this.getCategoryName(assignedCatId),
      price: Number(params.price.toFixed(2)),
      costPrice: Number((params.price * 0.7).toFixed(2)),
      purchasePrice: Number((params.price * 0.7).toFixed(2)),
      vatRate: params.vatRate || 13,
      stockQuantity: 10,
      stock: 10,
      image: params.imageUrl || '',
      imageUrl: params.imageUrl || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await marketDb.products.put(newProd);
    await this.loadInitialCatalog();
    return newProd;
  }

  public async updateCategoryName(categoryId: string, newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!categoryId || !trimmed) return;

    if (marketDb.categories) {
      await marketDb.categories.update(categoryId, { name: trimmed });
    }

    const prods = await marketDb.products.where('categoryId').equals(categoryId).toArray();
    for (const p of prods) {
  if (!p.id) continue;
  await marketDb.products.update(p.id, { categoryName: trimmed });
}

    await this.loadInitialCatalog();
  }

  /**
   * Normalizes all unassigned or legacy product categories into the 8 master departments
   */
  public async autoInferCategoryNames(): Promise<void> {
    const list = await marketDb.products.toArray();
    const updates: Promise<any>[] = [];

    const keywordRules: { match: RegExp; catId: string }[] = [
      { match: /γάλα|τυρί|φέτα|γιαούρτι|βούτυρο|αλλαντικ|ζαμπον|milk|cheese|feta|yogurt/i, catId: 'cat-dairy' },
      { match: /ψωμί|bread|μπισκότ|σνακ|σοκολάτ|κρουασάν|chips|snack|chocolate|biscuit/i, catId: 'cat-bakery' },
      { match: /cola|νερό|αναψυκτικό|χυμός|soda|water|juice|μπύρα|κρασί|beer|wine|ποτό/i, catId: 'cat-drinks' },
      { match: /skip|ariel|fairy|απορρυπαντικό|χαρτί|clean|soap|καθαριστικ/i, catId: 'cat-cleaning' },
      { match: /τσιγάρ|καπν|tobacco|vape|ψιλικ/i, catId: 'cat-tobacco' },
      { match: /σκυλ|γατ|pet|dog|cat|ζωοτροφ/i, catId: 'cat-pets' },
      { match: /μήλα|μπανάνες|ντομάτες|πατάτες|apple|banana|tomato|φρούτ|λαχανικ/i, catId: 'cat-fruit' }
    ];

    for (const prod of list) {
      const isUnmapped = !prod.categoryId || 
                         prod.categoryId === '5614' || 
                         prod.categoryId === 'CAT-GEN' || 
                         prod.categoryId.startsWith('CAT-') ||
                         !this.departments.some(d => d.id === prod.categoryId);

      if (isUnmapped) {
        let targetCatId = 'cat-pantry';

        for (const rule of keywordRules) {
          if (rule.match.test(prod.name)) {
            targetCatId = rule.catId;
            break;
          }
        }

        if (prod.id) {
  updates.push(marketDb.products.update(prod.id, {
    // ...
  }));
}
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
      await this.loadInitialCatalog();
    }
  }
}