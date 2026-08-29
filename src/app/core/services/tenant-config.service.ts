import { Injectable, signal, inject } from '@angular/core';
import { Firestore, collection, getDocs, doc, setDoc } from '@angular/fire/firestore';
import { StoreTenant } from '../models/store-tenant.model';

export interface Shop {
  code: string;
  name: string;
}

const STORAGE_KEY_TENANTS = 'registered_shops';
const STORAGE_KEY_ACTIVE = 'active_shop_code';
const SESSION_SUPER_ADMIN = 'is_super_admin_active';

async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

@Injectable({ providedIn: 'root' })
export class TenantConfigService {
  private firestore = inject(Firestore);

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

  public isSuperAdmin = signal<boolean>(
    sessionStorage.getItem(SESSION_SUPER_ADMIN) === 'true'
  );

  public registeredShops = signal<StoreTenant[]>(this.defaultShops);
  public activeShop = signal<StoreTenant>(this.defaultShops[0]);

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    // 1. First hydrate instantly from local storage for zero-delay startup
    try {
      const rawTenants = localStorage.getItem(STORAGE_KEY_TENANTS);
      let localShops: StoreTenant[] = rawTenants ? JSON.parse(rawTenants) : this.defaultShops;
      if (!Array.isArray(localShops) || localShops.length === 0) {
        localShops = this.defaultShops;
      }
      this.registeredShops.set(localShops);

      const savedCode = localStorage.getItem(STORAGE_KEY_ACTIVE) || 'mar-market';
      const active = localShops.find(s => s.code === savedCode) || localShops[0];
      this.activeShop.set(active);
    } catch {
      this.registeredShops.set(this.defaultShops);
      this.activeShop.set(this.defaultShops[0]);
    }

    // 2. Fetch all globally registered stores from Firestore
    await this.fetchRemoteShops();
  }

  public async fetchRemoteShops(): Promise<void> {
    try {
      const colRef = collection(this.firestore, 'shops');
      const snap = await getDocs(colRef);

      if (!snap.empty) {
        const remoteShops: StoreTenant[] = [];
        snap.forEach(docSnap => {
          remoteShops.push(docSnap.data() as StoreTenant);
        });

        // Merge local default with remote
        const mergedMap = new Map<string, StoreTenant>();
        this.defaultShops.forEach(s => mergedMap.set(s.code, s));
        this.registeredShops().forEach(s => mergedMap.set(s.code, s));
        remoteShops.forEach(s => mergedMap.set(s.code, s));

        const updatedList = Array.from(mergedMap.values());
        this.registeredShops.set(updatedList);
        localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(updatedList));

        // Re-align active shop
        const savedCode = localStorage.getItem(STORAGE_KEY_ACTIVE) || 'mar-market';
        const found = updatedList.find(s => s.code === savedCode) || updatedList[0];
        this.activeShop.set(found);
      }
    } catch (err) {
      console.warn('[Tenant] Could not fetch remote shops from cloud (offline mode active):', err);
    }
  }

  public async registerShop(newShop: StoreTenant): Promise<void> {
    const updated = [...this.registeredShops().filter(s => s.code !== newShop.code), newShop];
    
    // Save locally
    this.registeredShops.set(updated);
    localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(updated));
    localStorage.setItem(STORAGE_KEY_ACTIVE, newShop.code);
    this.activeShop.set(newShop);

    // Save globally to Firestore `shops` collection
    try {
      const shopDocRef = doc(this.firestore, `shops/${newShop.code}`);
      await setDoc(shopDocRef, newShop, { merge: true });
    } catch (err) {
      console.error('[Tenant] Failed to save store to Firestore:', err);
    }

    setTimeout(() => {
      location.reload();
    }, 100);
  }

  public switchShop(target: StoreTenant | Shop | string): void {
    if (!this.isSuperAdmin()) {
      console.warn('[Tenant] Unauthorized attempt to switch shop.');
      return;
    }

    const code = typeof target === 'string' ? target : target.code;
    const found = this.registeredShops().find(s => s.code === code);
    if (!found) {
      console.error(`[Tenant] Shop "${code}" not found.`);
      return;
    }

    this.activeShop.set(found);
    localStorage.setItem(STORAGE_KEY_ACTIVE, found.code);

    setTimeout(() => {
      location.reload();
    }, 50);
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