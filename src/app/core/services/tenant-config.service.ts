import { Injectable, signal, computed } from '@angular/core';
import { sha256Pin } from '../utils/crypto.utils';

export type FiscalMode = 'FHM' | 'PROVIDER' | 'NONE';

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
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
  allowStoreSwitch?: boolean;
  fiscalMode?: FiscalMode;
  fhmEndpoint?: string;
  providerApiKey?: string;
}

export const DEFAULT_SHOPS: ShopInfo[] = [
  {
    code: 'mar-market',
    name: 'Maranth Market (Central)',
    adminPinSalt: 'mar-market',
    // Hash of "mar-market:2435"
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
    // Hash of "ftest:5564"
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
    // Hash of "parnasos:1978"
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
  public registeredShops = signal<ShopInfo[]>(this.getInitialRegisteredShops());
  public activeShopCode = signal<string>(this.resolveInitialShopCode());

  public activeShop = computed(() => {
    const code = this.activeShopCode();
    const found = this.registeredShops().find(s => s.code === code);
    return found || this.registeredShops()[0] || DEFAULT_SHOPS[0];
  });

  constructor() {
    this.syncStorage();
  }

  private resolveInitialShopCode(): string {
    // 1. Inspect URL Query Param: ?shop=ftest or ?store=ftest
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      const urlShop = params.get('shop') || params.get('store');
      
      const cleanCode = urlShop ? sanitizeStoreCode(urlShop) : '';
      if (cleanCode && this.getInitialRegisteredShops().some(s => s.code === cleanCode)) {
        localStorage.setItem('active_shop_code', cleanCode);
        return cleanCode;
      }
    }

    // 2. Local storage fallback
    const saved = localStorage.getItem('active_shop_code');
    if (saved && this.getInitialRegisteredShops().some(s => s.code === saved)) {
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
    if (!target) return false;

    if (this.activeShop()?.allowStoreSwitch === false) {
      console.warn('[Tenant] Store switching is restricted on this terminal.');
      return false;
    }

    this.activeShopCode.set(code);
    localStorage.setItem('active_shop_code', code);
    return true;
  }

  private syncStorage(): void {
    localStorage.setItem('registered_shops', JSON.stringify(this.registeredShops()));
    localStorage.setItem('active_shop_code', this.activeShopCode());
  }

  public async registerShop(shop: Partial<ShopInfo> & { code: string; name: string; adminPin?: string }, syncStorage = true): Promise<{ success: boolean; message?: string }> {
    const cleanCode = sanitizeStoreCode(shop.code);
    const salt = shop.adminPinSalt || cleanCode;

    // Compute hash if plaintext adminPin was passed
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
      providerApiKey: shop.providerApiKey
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

    return await this.registerShop(updated, true);
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