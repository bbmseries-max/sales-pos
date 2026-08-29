import { Injectable, signal, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { 
  Product, 
  Category, 
  normalizeDateToInput 
} from '../models';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { 
  SUPERMARKET_DEPARTMENTS, 
  MasterCategory 
} from '../models/market.models';
import { TenantConfigService } from './tenant-config.service';

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
  private firestore = inject(Firestore);
  private tenantConfig = inject(TenantConfigService);

  public products = signal<Product[]>([]);
  public categories = signal<Category[]>([]);
  public readonly departments: MasterCategory[] = SUPERMARKET_DEPARTMENTS;
  public isSearchingExternal = signal<boolean>(false);

  /**
   * Syncs products from Firestore directly into this store's isolated DB
   */
  public async syncFromCloud(): Promise<number> {
    const activeStoreCode = this.tenantConfig.activeShop().code;
    console.log(`[MarketCatalog] Fetching catalog for store "${activeStoreCode}" from Maranth Hub...`);
    
    const colRef = collection(this.firestore, 'products');
    const snap = await getDocs(colRef);

    if (snap.empty) {
      console.warn('[MarketCatalog] No products found in Firestore "products" collection.');
      return 0;
    }

    const fetchedProducts: Product[] = [];
    snap.forEach(doc => {
      const raw = doc.data() as any;
      const cleanDate = normalizeDateToInput(raw.statusDate || raw.expire || raw.expireDate);
      
      fetchedProducts.push({
        ...raw,
        barcode: String(raw.barcode || raw.id || doc.id).trim(),
        statusDate: cleanDate,
        expire: cleanDate,
        storeId: activeStoreCode,
        _syncStatus: 'synced'
      });
    });

    // Save into this store's isolated IndexedDB
    await marketDb.products.bulkPut(fetchedProducts);

    // Refresh active catalog
    await this.loadInitialCatalog();

    return this.products().length;
  }

  public getCategoryName(categoryId?: string): string {
    const found = this.departments.find(d => d.id === categoryId);
    return found ? found.name : 'Παντοπωλείο & Τρόφιμα';
  }

  public getCategoryIcon(categoryId?: string): string {
    const found = this.departments.find(d => d.id === categoryId);
    return found ? found.icon : '🥫';
  }

  /**
   * Loads catalog directly from this store's database sandbox
   */
  public async loadInitialCatalog(): Promise<void> {
    const [allProds, cats] = await Promise.all([
      marketDb.products.toArray(),
      marketDb.categories.toArray()
    ]);

    // DB is already 100% store-isolated: load all active products
    const activeProducts = (allProds || []).filter(p => p.isActive !== false);
    this.products.set(activeProducts);

    if (cats && cats.length > 0) {
      this.categories.set(cats);
    } else {
      const derivedCats = this.departments.map(d => ({
        id: d.id,
        name: d.name
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
    const direct = product.imageUrl || product.image;
    if (direct && direct.trim().length > 0) {
      return direct.trim();
    }

    const barcode = String(product.barcode || product.id || '').trim();
    if (barcode && barcode.length >= 3) {
      return `/products/${barcode}.webp`;
    }

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

    const endpoints = [
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json`,
      `https://world.openfoodfacts.org/api/v0/product/${clean}.json`
    ];

    for (const url of endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'MaranthMarketPOS/1.0 (Angular-PWA)'
          },
          signal: controller.signal
        });

        if (!res.ok) continue;

        const data = await res.json();
        if (data?.status === 1 && data.product) {
          const p = data.product;

          const rawName = p.product_name_el || p.generic_name_el || p.product_name || p.generic_name || '';
          const brand = p.brands ? p.brands.split(',')[0].trim() : '';
          let finalName = rawName || brand || `Είδος ${clean}`;

          if (brand && rawName && !rawName.toLowerCase().includes(brand.toLowerCase())) {
            finalName = `${brand} ${rawName}`;
          }

          let categoryId = 'cat-pantry';
          let suggestedVat = 13;

          const categoryText = [
            p.categories || '',
            p.categories_tags ? p.categories_tags.join(' ') : '',
            p.product_name || '',
            brand || ''
          ].join(' ').toLowerCase();

          if (/τσιγάρ|καπν|καπνος|πουρο|τσιγαριλ|καπνοβιομηχαν|καρελια|marlboro|karelia|winston|camel|heets|terea|glo|neo|vape|iqos|tobacco|cigar|cigarette|rolling paper|χαρτακια|φιλτρακια|αναπτηρ/i.test(categoryText)) {
            categoryId = 'cat-tobacco';
            suggestedVat = 0;
          } else if (/γάλα|τυρί|dairy|cheese|milk|yogurt|γιαούρτι|φέτα|αυγά|αλλαντικ|ζαμπον/i.test(categoryText)) {
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
            suggestedPrice: suggestedVat === 0 ? 4.50 : 1.50
          };
        }
      } catch {
        // Timed out or failed, continue to next endpoint
      } finally {
        clearTimeout(timer);
      }
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
    const activeStoreCode = this.tenantConfig.activeShop().code;

    const newProd: Product = {
      id: 'PROD-' + Date.now().toString(36),
      barcode: params.barcode,
      sku: params.barcode,
      name: params.name,
      storeId: activeStoreCode,
      categoryId: assignedCatId,
      categoryName: params.categoryName || this.getCategoryName(assignedCatId),
      price: Number(params.price.toFixed(2)),
      costPrice: Number((params.price * 0.7).toFixed(2)),
      purchasePrice: Number((params.price * 0.7).toFixed(2)),
      vatRate: params.vatRate !== undefined ? params.vatRate : 13,
      stockQuantity: 10,
      stock: 10,
      image: params.imageUrl || '',
      imageUrl: params.imageUrl || '',
      isActive: true,
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

  public async autoInferCategoryNames(): Promise<void> {
    const list = await marketDb.products.toArray();
    const updates: Promise<any>[] = [];

    const keywordRules: { match: RegExp; catId: string; vatRate: number }[] = [
      { 
        match: /τσιγάρ|καπν|καπνος|πουρο|τσιγαριλ|καρελια|marlboro|karelia|winston|camel|heets|terea|glo|neo|vape|iqos|tobacco|cigar|cigarette|rolling paper|χαρτακια|φιλτρακια|αναπτηρ/i, 
        catId: 'cat-tobacco', 
        vatRate: 0 
      },
      { match: /γάλα|τυρί|φέτα|γιαούρτι|βούτυρο|αλλαντικ|ζαμπον|milk|cheese|feta|yogurt/i, catId: 'cat-dairy', vatRate: 13 },
      { match: /ψωμί|bread|μπισκότ|σνακ|σοκολάτ|κρουασάν|chips|snack|chocolate|biscuit/i, catId: 'cat-bakery', vatRate: 24 },
      { match: /cola|νερό|αναψυκτικό|χυμός|soda|water|juice|μπύρα|κρασί|beer|wine|ποτό/i, catId: 'cat-drinks', vatRate: 24 },
      { match: /skip|ariel|fairy|απορρυπαντικό|χαρτί|clean|soap|καθαριστικ/i, catId: 'cat-cleaning', vatRate: 24 },
      { match: /σκυλ|γατ|pet|dog|cat|ζωοτροφ/i, catId: 'cat-pets', vatRate: 24 },
      { match: /μήλα|μπανάνες|ντομάτες|πατάτες|apple|banana|tomato|φρούτ|λαχανικ/i, catId: 'cat-fruit', vatRate: 13 }
    ];

    for (const prod of list) {
      const isUnmapped = !prod.categoryId || 
                         prod.categoryId === '5614' || 
                         prod.categoryId === 'CAT-GEN' || 
                         prod.categoryId.startsWith('CAT-') ||
                         !this.departments.some(d => d.id === prod.categoryId);

      if (isUnmapped) {
        let targetCatId = 'cat-pantry';
        let suggestedVat = prod.vatRate ?? 13;

        for (const rule of keywordRules) {
          if (rule.match.test(prod.name)) {
            targetCatId = rule.catId;
            suggestedVat = rule.vatRate;
            break;
          }
        }

        if (prod.id) {
          updates.push(marketDb.products.update(prod.id, {
            categoryId: targetCatId,
            categoryName: this.getCategoryName(targetCatId),
            vatRate: suggestedVat
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