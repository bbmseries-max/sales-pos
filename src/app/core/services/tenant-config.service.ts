import { Injectable, signal } from '@angular/core';

export interface ShopInfo {
  code: string;
  name: string;
  address?: string;
  afm?: string;
  doy?: string;
  phone?: string;
}

const DEFAULT_SHOPS: ShopInfo[] = [
  { code: 'mar-market', name: 'Maranth Market (Central)', address: 'Leof. Pentelis 45, Vrilissia', afm: '123456789', doy: 'XALANDRIOU', phone: '210-6800000' },
  { code: 'ftest', name: 'Epta Enteka', address: 'Plateia Agias Paraskevis 12', afm: '998877665', doy: 'AGIAS PARASKEVIS', phone: '210-6001122' },
  { code: 'parnasos', name: 'Maranth Parnassos', address: 'Arahova Main Rd', afm: '887766554', doy: 'LIVADEIAS', phone: '22670-31000' }
];

@Injectable({ providedIn: 'root' })
export class TenantConfigService {
  public isSuperAdmin = signal<boolean>(false);
  public registeredShops = signal<ShopInfo[]>(DEFAULT_SHOPS);
  public activeShop = signal<ShopInfo>(DEFAULT_SHOPS[0]);

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const savedShops = localStorage.getItem('registered_shops');
    if (savedShops) {
      try {
        this.registeredShops.set(JSON.parse(savedShops));
      } catch {}
    }

    const savedActive = localStorage.getItem('active_shop');
    if (savedActive) {
      try {
        const parsed = JSON.parse(savedActive);
        const match = this.registeredShops().find(s => s.code === parsed.code);
        if (match) this.activeShop.set(match);
      } catch {}
    }
  }

  public registerNewStore(shop: ShopInfo): void {
    const current = this.registeredShops();
    const updated = [...current.filter(s => s.code !== shop.code), shop];
    this.registeredShops.set(updated);
    localStorage.setItem('registered_shops', JSON.stringify(updated));
  }

  public switchShop(storeCode: string): void {
    const match = this.registeredShops().find(s => s.code === storeCode);
    if (!match) return;

    localStorage.setItem('active_shop', JSON.stringify(match));
    localStorage.setItem('active_shop_code', match.code);

    // Clean page reload into the isolated DB sandbox
    window.location.reload();
  }

  public unlockSuperAdmin(pin: string): boolean {
    if (pin.trim() === '8820') {
      this.isSuperAdmin.set(true);
      return true;
    }
    return false;
  }

  public lockSuperAdmin(): void {
    this.isSuperAdmin.set(false);
  }
}