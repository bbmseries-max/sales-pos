import { Injectable, signal } from '@angular/core';
export type FiscalMode = 'FHM' | 'PROVIDER' | 'NONE';

export interface ShopInfo {
  code: string;
  name: string;
  adminPin?: string; // Unique login PIN per shop
  address?: string;
  afm?: string;
  doy?: string;
  phone?: string;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
  // Fiscal configuration fields
  fiscalMode?: FiscalMode;
  fhmEndpoint?: string;
  providerApiKey?: string;
}

export const RESERVED_SYSTEM_PINS = ['8820'];

const DEFAULT_SHOPS: ShopInfo[] = [
  {
    code: 'mar-market',
    name: 'Maranth Market (Central)',
    adminPin: '2435',
    address: 'Leof. Pentelis 45, Vrilissia',
    afm: '123456789',
    doy: 'XALANDRIOU',
    phone: '210-6800000',
    currency: 'EUR',
    fiscalMode: 'PROVIDER',
    fhmEndpoint: 'http://127.0.0.1:8080/api/fhm'
  },
  {
    code: 'ftest',
    name: 'Epta Enteka',
    adminPin: '5564',
    address: 'Plateia Agias Paraskevis 12',
    afm: '998877665',
    doy: 'AGIAS PARASKEVIS',
    phone: '210-6001122',
    currency: 'EUR',
    fiscalMode: 'PROVIDER',
    fhmEndpoint: 'http://127.0.0.1:8080/api/fhm'
  },
  {
    code: 'parnasos',
    name: 'Maranth Parnassos',
    adminPin: '1978',
    address: 'Αρηστοτελους 103',
    afm: '887766554',
    doy: 'ΚΕΦΟΔΕ',
    phone: '22670-31000',
    currency: 'EUR',
    fiscalMode: 'PROVIDER',
    fhmEndpoint: 'http://127.0.0.1:8080/api/fhm'
  }
];

export function sanitizeStoreCode(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u0370-\u03ff-]/g, '') // allow greek, latin, numbers, dashes
    .replace(/-+/g, '-');
}

@Injectable({ providedIn: 'root' })
export class TenantConfigService {
  
  public registeredShops = signal<ShopInfo[]>(this.getInitialRegisteredShops());
  public activeShop = signal<ShopInfo>(this.getInitialShop());
  public isSuperAdmin = signal<boolean>(false);

  constructor() {
    this.loadFromStorage();
  }

  public isPinAvailable(pin: string, excludeStoreCode?: string): boolean {
    const cleanPin = pin.trim();
    if (RESERVED_SYSTEM_PINS.includes(cleanPin) || cleanPin.length < 4) {
      return false;
    }
    const conflict = this.registeredShops().find(
      s => s.adminPin === cleanPin && s.code !== excludeStoreCode
    );
    return !conflict;
  }

  private getInitialRegisteredShops(): ShopInfo[] {
    const saved = localStorage.getItem('registered_shops');
    if (saved) {
      try {
        const parsed: ShopInfo[] = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Merge defaults with saved: ALWAYS prioritize code-level adminPins for DEFAULT_SHOPS
          const mergedDefaults = DEFAULT_SHOPS.map(def => {
            const found = parsed.find(p => p.code === def.code);
            return found ? { ...found, adminPin: def.adminPin } : def;
          });

          const customShops = parsed.filter(p => !DEFAULT_SHOPS.some(def => def.code === p.code));
          return [...mergedDefaults, ...customShops];
        }
      } catch (e) {
        console.error('[TenantConfig] Corrupt cached shops, falling back to defaults', e);
      }
    }
    return [...DEFAULT_SHOPS];
  }

  private getInitialShop(): ShopInfo {
    const shops = this.getInitialRegisteredShops();
    const saved = localStorage.getItem('active_shop');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const match = shops.find(s => s.code === parsed.code);
        if (match) return match;
      } catch (e) {
        console.error('[TenantConfig] Corrupt cached active shop', e);
      }
    }
    return shops[0] || DEFAULT_SHOPS[0];
  }

  private loadFromStorage(): void {
    // 1. Restore Super-Admin session state
    const savedSuperAdmin = sessionStorage.getItem('maranth_super_admin');
    if (savedSuperAdmin === 'true') {
      this.isSuperAdmin.set(true);
    }

    // 2. Synchronize registered shops
    const syncedShops = this.getInitialRegisteredShops();
    this.registeredShops.set(syncedShops);
    localStorage.setItem('registered_shops', JSON.stringify(syncedShops));

    // 3. Synchronize active shop
    const syncedActive = this.getInitialShop();
    this.activeShop.set(syncedActive);
    localStorage.setItem('active_shop', JSON.stringify(syncedActive));
    localStorage.setItem('active_shop_code', syncedActive.code);
  }

  public registerShop(shop: ShopInfo, syncStorage = true): { success: boolean; message?: string } {
    const cleanCode = sanitizeStoreCode(shop.code);
    const pin = shop.adminPin ? String(shop.adminPin).trim() : '';

    if (pin && !this.isPinAvailable(pin, cleanCode)) {
      const msg = `Το PIN "${pin}" χρησιμοποιείται ήδη από άλλο κατάστημα ή είναι δεσμευμένο!`;
      console.error(`[TenantConfig] ${msg}`);
      return { success: false, message: msg };
    }

    const cleanShop: ShopInfo = {
      ...shop,
      code: cleanCode,
      currency: shop.currency || 'EUR'
    };

    const current = this.registeredShops();
    const updated = [...current.filter(s => s.code !== cleanShop.code), cleanShop];
    this.registeredShops.set(updated);

    if (syncStorage) {
      localStorage.setItem('registered_shops', JSON.stringify(updated));
    }

    return { success: true };
  }

  public registerNewStore(shop: ShopInfo): void {
    this.registerShop(shop, true);
  }

  public updateActiveShopDetails(details: Partial<ShopInfo>): { success: boolean; message?: string } {
    const current = this.activeShop();
    const targetCode = details.code ? sanitizeStoreCode(details.code) : current.code;
    const pin = details.adminPin ? String(details.adminPin).trim() : '';

    if (pin && !this.isPinAvailable(pin, targetCode)) {
      const msg = `Το PIN "${pin}" υπάρχει ήδη σε άλλο κατάστημα!`;
      console.error(`[TenantConfig] ${msg}`);
      return { success: false, message: msg };
    }

    const updated: ShopInfo = {
      ...current,
      ...details,
      code: targetCode,
      updatedAt: new Date().toISOString()
    };

    this.activeShop.set(updated);
    localStorage.setItem('active_shop', JSON.stringify(updated));
    localStorage.setItem('active_shop_code', updated.code);
    return this.registerShop(updated, true);
  }

  public resolveAndSwitchByPin(pin: string): { success: boolean; store?: ShopInfo } {
    const cleanPin = pin.trim();

    // 1. Super-Admin bypass
    if (cleanPin === '8820') {
      this.unlockSuperAdmin(cleanPin);
      return { success: true };
    }

    // 2. Identify all shops claiming this PIN
    const matches = this.registeredShops().filter(s => s.adminPin === cleanPin);

    if (matches.length > 1) {
      console.error(`🚨 PIN COLLISION: PIN ${cleanPin} is assigned to multiple stores:`, matches.map(m => m.code));
      alert('Σφάλμα διένεξης PIN: Περισσότερα από ένα καταστήματα έχουν το ίδιο PIN!');
      return { success: false };
    }

    if (matches.length === 1) {
      const targetStore = matches[0];
      if (this.activeShop().code !== targetStore.code) {
        this.switchShop(targetStore.code);
      }
      return { success: true, store: targetStore };
    }

    return { success: false };
  }

  public switchShop(storeCode: string): void {
    const cleanCode = sanitizeStoreCode(storeCode);
    const match = this.registeredShops().find(s => s.code === cleanCode || s.code === storeCode);
    if (!match) {
      console.error(`[TenantConfig] Cannot switch: Store code "${storeCode}" not found.`);
      return;
    }

    this.activeShop.set(match);
    localStorage.setItem('active_shop', JSON.stringify(match));
    localStorage.setItem('active_shop_code', match.code);

    // Reset session locks so previous cashier does not leak into the new store
    sessionStorage.removeItem('active_cashier_data');
    sessionStorage.setItem('pos_is_locked', 'true');

    // Reload triggers fresh Dexie instance MaranthPOS_<cleanCode>
    window.location.reload();
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

    if (this.activeShop().code === storeCode) {
      this.switchShop(updated[0].code);
    }
  }

  public unlockSuperAdmin(pin: string): boolean {
    if (pin.trim() === '8820') {
      this.isSuperAdmin.set(true);
      sessionStorage.setItem('maranth_super_admin', 'true');
      return true;
    }
    return false;
  }

  public lockSuperAdmin(): void {
    this.isSuperAdmin.set(false);
    sessionStorage.removeItem('maranth_super_admin');
  }
}