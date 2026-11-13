import { Injectable, signal, computed, inject } from '@angular/core';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { sha256Pin } from '../utils/crypto.utils';

export type FiscalMode = 'FHM' | 'PROVIDER' | 'NONE';
export type SubscriptionTier = 'TRIAL_7D' | 'TRIAL_30D' | 'PAID_MONTHLY' | 'PAID_ANNUAL' | 'LIFETIME';
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'GRACE_PERIOD';

export interface ShopSubscription {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  activatedAt: string;       // ISO date, e.g. "2026-10-24T00:00:00Z"
  validUntil: string | null; // ISO date, or null for LIFETIME
  licenseKey?: string;       // Signature / verification key
  trialNoticeDismissed?: boolean;
}

export interface ShopInfo {
  code: string;
  name: string;
  adminPinSalt?: string;
  adminPinHash?: string; // SHA-256 hash of salt:pin
  defaultFloat?: number;
  defaultRegister?: string;
  address?: string;
  afm?: string;
  doy?: string;
  phone?: string;
  registerId?: string;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
  allowStoreSwitch?: boolean;
  fiscalMode?: FiscalMode;
  fhmEndpoint?: string;
  providerApiKey?: string;
  subscription?: ShopSubscription;
  [key: string]: any;
}

export const DEFAULT_SHOPS: ShopInfo[] = [
  {
    code: 'mar-market',
    name: 'Maranth Market (Central)',
    adminPinSalt: 'mar-market',
    adminPinHash: '9b0919b5f30eaf305e85a691684b27c38014260204851be92d652856b0893fee', // PIN: 2435
    defaultFloat: 100,
    defaultRegister: 'REG-01',
    address: 'Leof. Pentelis 45, Vrilissia',
    afm: '123456789',
    doy: 'XALANDRIOU',
    phone: '210-6800000',
    currency: 'EUR',
    isActive: true,
    allowStoreSwitch: true
  },
  {
    code: 'ftest',
    name: 'Epta Enteka',
    adminPinSalt: 'ftest',
    adminPinHash: '1198cab3e7bf1dead5c7e19e044821e281b17044e12d9b37b65a3e3b056b7b5b', // PIN: 5564
    defaultFloat: 50,
    defaultRegister: 'REG-01',
    address: 'Plateia Agias Paraskevis 12',
    afm: '998877665',
    doy: 'AGIAS PARASKEVIS',
    phone: '210-6001122',
    currency: 'EUR',
    isActive: true,
    allowStoreSwitch: false
  },
  {
    code: 'parnasos',
    name: 'Maranth Parnassos',
    adminPinSalt: 'parnasos',
    adminPinHash: 'ca4bd03986619a01a38d485124ce7b251f158431986027d2e915fb8ba459991f', // PIN: 1978
    defaultFloat: 50,
    defaultRegister: 'REG-01',
    address: 'Αρηστοτελους 103',
    afm: '887766554',
    doy: 'ΚΕΦΟΔΕ',
    phone: '22670-31000',
    currency: 'EUR',
    isActive: true,
    allowStoreSwitch: false
  },
  {
    code: 'glyfada-store',
    name: 'Maranth Glyfada',
    adminPinSalt: 'glyfada-store',
    // Hash of "glyfada-store:1234"
    adminPinHash: '0bc62e0a293bf66b7bb8eb90956b9c9f0b5d5ba6f0ee4957e841267b2d56a73c', // PIN: 1234
    defaultFloat: 50,
    defaultRegister: 'REG-01',
    address: 'Metaxa 10',
    afm: '999111222',
    doy: 'GLYFADAS',
    phone: '210-8900000',
    currency: 'EUR',
    isActive: true,
    allowStoreSwitch: true
  }
];

export function sanitizeStoreCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u0370-\u03ff-]/g, '')
    .replace(/-+/g, '-');
}

@Injectable({ providedIn: 'root' })
export class TenantConfigService {
  private firestore = inject(Firestore);

  public registeredShops = signal<ShopInfo[]>(this.getInitialRegisteredShops());
  public activeShopCode = signal<string>(this.resolveInitialShopCode());

  public activeShop = computed(() => {
    const code = this.activeShopCode();
    const found = this.registeredShops().find(s => s.code === code);
    return found || this.registeredShops()[0] || DEFAULT_SHOPS[0];
  });

  public isSubscriptionValid = computed(() => {
    const shop = this.activeShop();
    if (!shop.subscription) return true;
    if (shop.subscription.tier === 'LIFETIME' || !shop.subscription.validUntil) return true;

    const now = new Date().getTime();
    const expiry = new Date(shop.subscription.validUntil).getTime();
    return now <= expiry;
  });

  public daysRemaining = computed(() => {
    const shop = this.activeShop();
    if (!shop.subscription || !shop.subscription.validUntil) return null;

    const diffMs = new Date(shop.subscription.validUntil).getTime() - new Date().getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  });

  constructor() {
    this.syncStorage();
    // Resolve tenant document from Firestore parent path: /tenants/{shopSlug}
    this.fetchRemoteTenantMetadata(this.activeShopCode());
  }

  /**
   * Fetches the parent tenant document at /tenants/{shopSlug} from Firestore
   */
  public async fetchRemoteTenantMetadata(shopSlug: string): Promise<ShopInfo | null> {
    const cleanCode = sanitizeStoreCode(shopSlug);
    if (!cleanCode) return null;

    try {
      const tenantDocRef = doc(this.firestore, 'tenants', cleanCode);
      const snap = await getDoc(tenantDocRef);

      if (snap.exists()) {
        const remoteData = snap.data() as Partial<ShopInfo>;
        const merged: ShopInfo = {
          ...this.activeShop(),
          ...remoteData,
          code: cleanCode,
          name: remoteData.name || this.activeShop().name
        };

        await this.registerShop(merged, true);
        return merged;
      } else {
        // Document does not exist yet; bootstrap it into /tenants/{shopSlug}
        const currentLocal = this.activeShop();
        if (currentLocal.code === cleanCode) {
          await setDoc(tenantDocRef, {
            ...currentLocal,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      }
    } catch (err) {
      console.warn(`[TenantConfig] Could not sync parent doc for /tenants/${cleanCode}:`, err);
    }
    return null;
  }

  private resolveInitialShopCode(): string {
    // 1. Inspect URL Query Param: ?shop=ftest or ?store=ftest
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      const urlShop = params.get('shop') || params.get('store');
      
      if (urlShop) {
        const cleanCode = sanitizeStoreCode(urlShop);
        if (cleanCode) {
          localStorage.setItem('active_shop_code', cleanCode);
          return cleanCode;
        }
      }
    }

    // 2. Local storage fallback
    const saved = localStorage.getItem('active_shop_code');
    if (saved) {
      return saved;
    }

    // 3. Fallback default
    return DEFAULT_SHOPS[0].code;
  }

  private getInitialRegisteredShops(): ShopInfo[] {
    const saved = localStorage.getItem('registered_shops');
    if (saved) {
      try {
        const parsed: ShopInfo[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const mergedDefaults = DEFAULT_SHOPS.map(def => {
            const found = parsed.find(p => p.code === def.code);
            return found ? { ...found, adminPinHash: def.adminPinHash, adminPinSalt: def.adminPinSalt } : def;
          });
          const customShops = parsed.filter(p => !DEFAULT_SHOPS.some(def => def.code === p.code));
          return [...mergedDefaults, ...customShops];
        }
      } catch (e) {
        console.error('[TenantConfig] Corrupt cached shops, fallback to defaults', e);
      }
    }
    return [...DEFAULT_SHOPS];
  }

  public switchShop(code: string): boolean {
    const target = this.registeredShops().find(s => s.code === code);
    if (!target) {
      // If store is unknown locally, register it dynamically and fetch its /tenants/{code} parent
      this.registerShop({ code, name: code }, true);
    }

    if (this.activeShop()?.allowStoreSwitch === false) {
      console.warn('[Tenant] Store switching is restricted on this terminal.');
      return false;
    }

    this.activeShopCode.set(code);
    localStorage.setItem('active_shop_code', code);
    this.fetchRemoteTenantMetadata(code);
    return true;
  }

  private syncStorage(): void {
    localStorage.setItem('registered_shops', JSON.stringify(this.registeredShops()));
    localStorage.setItem('active_shop_code', this.activeShopCode());
  }

  public async registerShop(
    shop: Partial<ShopInfo> & { code: string; name: string; adminPin?: string },
    syncStorage = true
  ): Promise<{ success: boolean; message?: string }> {
    const cleanCode = sanitizeStoreCode(shop.code);
    const salt = shop.adminPinSalt || cleanCode;

    let hash = shop.adminPinHash;
    if (!hash && shop.adminPin) {
      hash = await sha256Pin(shop.adminPin, salt);
    }

    const cleanShop: ShopInfo = {
      code: cleanCode,
      name: shop.name,
      adminPinSalt: salt,
      adminPinHash: hash || '',
      defaultFloat: shop.defaultFloat ?? 50,
      defaultRegister: shop.defaultRegister ?? 'REG-01',
      address: shop.address || '',
      afm: shop.afm || '',
      doy: shop.doy || '',
      phone: shop.phone || '',
      currency: shop.currency || 'EUR',
      isActive: shop.isActive !== false,
      allowStoreSwitch: shop.allowStoreSwitch ?? false,
      fiscalMode: shop.fiscalMode,
      fhmEndpoint: shop.fhmEndpoint,
      providerApiKey: shop.providerApiKey,
      subscription: shop.subscription
    };

    const current = this.registeredShops();
    const updated = [...current.filter(s => s.code !== cleanShop.code), cleanShop];
    this.registeredShops.set(updated);

    if (syncStorage) {
      localStorage.setItem('registered_shops', JSON.stringify(updated));
    }
    return { success: true };
  }

  public async registerNewStore(shop: Partial<ShopInfo> & { code: string; name: string; adminPin?: string }): Promise<void> {
    await this.registerShop(shop, true);
  }

  public async updateActiveShopDetails(details: Partial<ShopInfo>): Promise<{ success: boolean; message?: string }> {
    const current = this.activeShop();
    const targetCode = details.code ? sanitizeStoreCode(details.code) : current.code;

    const updated: ShopInfo = {
      ...current,
      ...details,
      code: targetCode,
      updatedAt: new Date().toISOString()
    };

    // 1. Update local state
    const res = await this.registerShop(updated, true);

    // 2. Persist directly to parent /tenants/{targetCode} in Firestore
    try {
      const docRef = doc(this.firestore, 'tenants', targetCode);
      await setDoc(docRef, updated, { merge: true });
    } catch (e) {
      console.warn(`[TenantConfig] Could not sync updated details to /tenants/${targetCode}:`, e);
    }

    return res;
  }

  public deleteShop(storeCode: string): void {
    const current = this.registeredShops();
    if (current.length <= 1) {
      console.warn('[TenantConfig] Cannot delete the only remaining store.');
      return;
    }

    const updated = current.filter(s => s.code !== storeCode);
    this.registeredShops.set(updated);
    localStorage.setItem('registered_shops', JSON.stringify(updated));

    if (this.activeShopCode() === storeCode) {
      this.switchShop(updated[0].code);
    }
  }
}