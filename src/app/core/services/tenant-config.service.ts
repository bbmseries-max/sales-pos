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
  public isSuperAdmin = signal<boolean>(false);
  public registeredShops = signal<ShopInfo[]>(DEFAULT_SHOPS);
  public activeShop = signal<ShopInfo>(DEFAULT_SHOPS[0]);

  constructor() {
    this.loadFromStorage();
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
          this.activeShop.set(active);

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
    this.activeShop.set(currentShops[0] || DEFAULT_SHOPS[0]);
  }

  /**
   * Resolves store by unique admin PIN.
   * If the user is logging into a different shop than currently active,
   * switches the active store and reloads to re-bind the Dexie instance.
   */
  public resolveAndSwitchByPin(pin: string): { success: boolean; shop?: ShopInfo; isSuperAdmin?: boolean } {
    const cleanPin = pin.trim();

    // Check Master PIN first
    if (cleanPin === '8820') {
      this.unlockSuperAdmin(cleanPin);
      return { success: true, shop: this.activeShop(), isSuperAdmin: true };
    }

    // Check store-specific PINs
    const matched = this.registeredShops().find(s => s.adminPin === cleanPin);
    if (matched) {
      if (this.activeShop().code !== matched.code) {
        this.switchShop(matched.code);
      }
      return { success: true, shop: matched, isSuperAdmin: false };
    }

    return { success: false };
  }

  public registerShop(shop: ShopInfo, syncStorage = true): void {
    const cleanShop: ShopInfo = {
      ...shop,
      code: sanitizeStoreCode(shop.code),
      currency: shop.currency || 'EUR'
    };

    const current = this.registeredShops();
    const updated = [...current.filter(s => s.code !== cleanShop.code), cleanShop];
    this.registeredShops.set(updated);

    if (syncStorage) {
      localStorage.setItem('registered_shops', JSON.stringify(updated));
    }
  }

  public registerNewStore(shop: ShopInfo): void {
    this.registerShop(shop, true);
  }

  public updateActiveShopDetails(details: Partial<ShopInfo>): void {
    const current = this.activeShop();
    const updated: ShopInfo = {
      ...current,
      ...details,
      code: details.code ? sanitizeStoreCode(details.code) : current.code,
      updatedAt: new Date().toISOString()
    };

    this.activeShop.set(updated);
    localStorage.setItem('active_shop', JSON.stringify(updated));
    localStorage.setItem('active_shop_code', updated.code);
    this.registerShop(updated, true);
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