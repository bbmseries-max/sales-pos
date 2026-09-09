import { Injectable, signal } from '@angular/core';

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
}

const DEFAULT_SHOPS: ShopInfo[] = [
  {
    code: 'mar-market',
    name: 'Maranth Market (Central)',
    adminPin: '2222',
    address: 'Leof. Pentelis 45, Vrilissia',
    afm: '123456789',
    doy: 'XALANDRIOU',
    phone: '210-6800000',
    currency: 'EUR'
  },
  {
    code: 'ftest',
    name: 'Epta Enteka',
    adminPin: '1111',
    address: 'Plateia Agias Paraskevis 12',
    afm: '998877665',
    doy: 'AGIAS PARASKEVIS',
    phone: '210-6001122',
    currency: 'EUR'
  },
  {
    code: 'parnasos',
    name: 'Maranth Parnassos',
    adminPin: '3333',
    address: 'Arahova Main Rd',
    afm: '887766554',
    doy: 'LIVADEIAS',
    phone: '22670-31000',
    currency: 'EUR'
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
  public activeStore = signal<ShopInfo>(this.getInitialShop());
  public isSuperAdmin = signal<boolean>(false);
  public registeredShops = signal<ShopInfo[]>(DEFAULT_SHOPS);
  public isPinAvailable(pin: string, excludeStoreCode?: string): boolean {
    const cleanPin = pin.trim();
    // Disallow reserved PINs or PINs shorter than 4 digits
    if (cleanPin === '8820' || cleanPin.length < 4) {
      return false;
    }
    const currentShops = this.registeredShops();
    const conflict = currentShops.find(s => 
      (s as any).adminPin === cleanPin && s.code !== excludeStoreCode
    );

    return !conflict;
  }

  constructor() {
    this.loadFromStorage();
  }

  private getInitialShop(): ShopInfo {
    const cached = localStorage.getItem('active_shop');
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        console.error('[TenantConfig] Failed to parse active_shop from localStorage', e);
      }
    }
    // Fall back to the default shop from your DEFAULT_SHOPS array
    const defaultCode = localStorage.getItem('active_shop_code') || 'ftest';
    const match = DEFAULT_SHOPS.find(s => s.code === defaultCode) || DEFAULT_SHOPS[0];
    return match;
  }

  private getInitialShops(): ShopInfo[] {
    const cached = localStorage.getItem('registered_shops');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error('[TenantConfig] Failed to parse registered_shops from localStorage', e);
      }
    }
    return [...DEFAULT_SHOPS];
  }

  private loadFromStorage(): void {
    // 1. Restore Super-Admin session state
    const savedSuperAdmin = sessionStorage.getItem('maranth_super_admin');
    if (savedSuperAdmin === 'true') {
      this.isSuperAdmin.set(true);
    }

    // 2. Restore Registered Shops
    let currentShops = DEFAULT_SHOPS;
    const savedShops = localStorage.getItem('registered_shops');
    if (savedShops) {
      try {
        const parsed = JSON.parse(savedShops);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Merge defaults with saved so adminPins are preserved even if localStorage is older
          currentShops = DEFAULT_SHOPS.map(def => {
            const found = parsed.find((p: ShopInfo) => p.code === def.code);
            return found ? { ...def, ...found, adminPin: found.adminPin || def.adminPin } : def;
          });

          // Add any custom shops created dynamically
          const customShops = parsed.filter((p: ShopInfo) => !DEFAULT_SHOPS.some(def => def.code === p.code));
          currentShops = [...currentShops, ...customShops];

          this.registeredShops.set(currentShops);
        }
      } catch (err) {
        console.warn('[TenantConfig] Failed to parse registered_shops:', err);
      }
    }

    // 3. Restore Active Shop safely
    const savedActive = localStorage.getItem('active_shop');
    if (savedActive) {
      try {
        const parsed: ShopInfo = JSON.parse(savedActive);
        if (parsed?.code) {
          const match = currentShops.find(s => s.code === parsed.code);
          const active = match || parsed;
          this.activeStore.set(active);

          if (!match) {
            this.registerShop(active, false);
          }
          return;
        }
      } catch (err) {
        console.warn('[TenantConfig] Failed to parse active_shop:', err);
      }
    }

    // Fallback default
    this.activeStore.set(currentShops[0] || DEFAULT_SHOPS[0]);
  }

  public registerShop(shop: ShopInfo, syncStorage = true): { success: boolean; message?: string } {
    const cleanCode = sanitizeStoreCode(shop.code);
    const pin = (shop as any).adminPin ? String((shop as any).adminPin).trim() : '';

    // Validate PIN uniqueness if a PIN was provided
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
    const current = this.activeStore();
    const targetCode = details.code ? sanitizeStoreCode(details.code) : current.code;
    const pin = (details as any).adminPin ? String((details as any).adminPin).trim() : '';

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

    this.activeStore.set(updated);
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
    const matches = this.registeredShops().filter(s => (s as any).adminPin === cleanPin);

    if (matches.length > 1) {
      console.error(`🚨 PIN COLLISION: PIN ${cleanPin} is assigned to multiple stores:`, matches.map(m => m.code));
      alert('Σφάλμα διένεξης PIN: Περισσότερα από ένα καταστήματα έχουν το ίδιο PIN!');
      return { success: false };
    }

    if (matches.length === 1) {
      const targetStore = matches[0];
      if (this.activeStore().code !== targetStore.code) {
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

    this.activeStore.set(match);
    localStorage.setItem('active_shop', JSON.stringify(match));
    localStorage.setItem('active_shop_code', match.code);

    // Reload triggers clean Dexie connection to MaranthPOS_<cleanCode>
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

    if (this.activeStore().code === storeCode) {
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