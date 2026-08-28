import { Injectable, signal } from '@angular/core';
import { StoreTenant } from '../models/store-tenant.model';

export interface Shop {
  code: string;
  name: string;
}

const STORAGE_KEY_TENANTS = 'registered_shops';
const STORAGE_KEY_ACTIVE = 'active_shop_code';
const SESSION_SUPER_ADMIN = 'is_super_admin_active';

// SHA-256 helper for client-side pin comparison
async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

@Injectable({ providedIn: 'root' })
export class TenantConfigService {
  // SHA-256 hash of "8820"
  private readonly MASTER_PIN_HASH = '31b8160408544cb4469f3efec825f77db27d046d2a76f2d22a84b06fa45d6dd0';

  private defaultShops: StoreTenant[] = [
    {
      code: 'mar-market',
      name: 'Maranth Market (Central)',
      afm: '067424104',
      doy: 'ΚΕΦΟΔΕ',
      address: 'Leof. Pentelis 45, Vrilissia',
      phone: '210-6800000',
      currency: 'EUR',
      createdAt: new Date().toISOString()
    }
  ];

  // Persists unlock state across page reloads in the same tab session
  public isSuperAdmin = signal<boolean>(
    sessionStorage.getItem(SESSION_SUPER_ADMIN) === 'true'
  );

  public registeredShops = signal<StoreTenant[]>([]);
  public activeShop = signal<StoreTenant>(this.defaultShops[0]);

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TENANTS);
      let shops: StoreTenant[] = raw ? JSON.parse(raw) : this.defaultShops;
      
      if (!Array.isArray(shops) || shops.length === 0) {
        shops = this.defaultShops;
        localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(shops));
      }
      this.registeredShops.set(shops);

      const activeCode = localStorage.getItem(STORAGE_KEY_ACTIVE) || 'mar-market';
      const found = shops.find(s => s.code === activeCode) || shops[0];
      this.activeShop.set(found);
    } catch {
      this.registeredShops.set(this.defaultShops);
      this.activeShop.set(this.defaultShops[0]);
    }
  }

  public async unlockSuperAdmin(enteredPin: string): Promise<boolean> {
    const hashed = await hashPin(enteredPin.trim());
    if (hashed === this.MASTER_PIN_HASH || enteredPin.trim() === '8820') {
      this.isSuperAdmin.set(true);
      sessionStorage.setItem(SESSION_SUPER_ADMIN, 'true');
      return true;
    }
    return false;
  }

  public lockSuperAdmin(): void {
    this.isSuperAdmin.set(false);
    sessionStorage.removeItem(SESSION_SUPER_ADMIN);
  }

  public switchShop(target: StoreTenant | Shop | string): void {
    if (!this.isSuperAdmin()) {
      console.warn('[Tenant] Unauthorized attempt to switch shop.');
      return;
    }
    const code = typeof target === 'string' ? target : target.code;
    const shopObj = this.registeredShops().find(s => s.code === code);
    if (!shopObj) {
      console.error(`[Tenant] Shop "${code}" not found.`);
      return;
    }

    this.activeShop.set(shopObj);
    localStorage.setItem(STORAGE_KEY_ACTIVE, shopObj.code);
    location.reload();
  }

  public registerShop(newShop: StoreTenant): void {
    const updated = [...this.registeredShops().filter(s => s.code !== newShop.code), newShop];
    this.registeredShops.set(updated);
    localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(updated));
    this.switchShop(newShop);
  }

  public updateActiveShopDetails(updated: Partial<StoreTenant>): void {
    this.activeShop.update(current => {
      const next = { ...current, ...updated };
      const updatedList = this.registeredShops().map(s => s.code === next.code ? next : s);
      this.registeredShops.set(updatedList);
      localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(updatedList));
      return next;
    });
  }
}