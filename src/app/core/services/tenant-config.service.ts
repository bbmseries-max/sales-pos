import { Injectable, signal } from '@angular/core';
import { StoreTenant } from '../models/store-tenant.model';

const STORAGE_KEY_TENANTS = 'registered_shops';
const STORAGE_KEY_ACTIVE = 'active_shop_code';

@Injectable({ providedIn: 'root' })
export class TenantConfigService {
  private defaultShops: StoreTenant[] = [
    {
      code: 'mar-market',
      name: 'Maranth Market (Central)',
      afm: '123456789',
      doy: 'XALANDRIOU',
      address: 'Leof. Pentelis 45, Vrilissia',
      phone: '210-6800000',
      currency: 'EUR',
      createdAt: new Date().toISOString()
    }
  ];

  public registeredShops = signal<StoreTenant[]>([]);
  public activeShop = signal<StoreTenant>(this.defaultShops[0]);

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const raw = localStorage.getItem(STORAGE_KEY_TENANTS);
    let shops: StoreTenant[] = raw ? JSON.parse(raw) : this.defaultShops;
    
    if (shops.length === 0) {
      shops = this.defaultShops;
      localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(shops));
    }
    this.registeredShops.set(shops);

    const activeCode = localStorage.getItem(STORAGE_KEY_ACTIVE) || 'mar-market';
    const found = shops.find(s => s.code === activeCode) || shops[0];
    this.activeShop.set(found);
  }

  /**
   * Registers a brand new shop / tenant branch
   */
  public registerShop(newShop: StoreTenant): void {
    const updated = [...this.registeredShops().filter(s => s.code !== newShop.code), newShop];
    this.registeredShops.set(updated);
    localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(updated));
    this.switchShop(newShop.code);
  }

  /**
   * Switches the active shop and reloads tenant catalog context
   */
  public switchShop(code: string): void {
    const found = this.registeredShops().find(s => s.code === code);
    if (found) {
      this.activeShop.set(found);
      localStorage.setItem(STORAGE_KEY_ACTIVE, code);
    }
  }

  public updateActiveShopDetails(updated: Partial<StoreTenant>): void {
  this.activeShop.update(current => {
    const next = { ...current, ...updated };
    // Persist to localStorage
    localStorage.setItem('active_tenant_shop', JSON.stringify(next));
    return next;
  });
}
}