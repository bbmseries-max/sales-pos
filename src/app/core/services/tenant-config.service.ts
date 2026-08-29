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

  private readonly MASTER_PIN_HASH = '31b8160408544cb4469f3efec825f77db27d046d2a76f2d22a84b06fa45d6dd0'; // 8820

  private defaultShops: StoreTenant[] = [
    {
      code: 'mar-market',
      name: 'Maranth Market (Central)',
      afm: '067424104',
      doy: 'ΚΕΦΟΔΕ',
      address: 'Leof. Pentelis 45, Vrilissia',
      phone: '210-6800000',
      currency: 'EUR',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ];

  public isSuperAdmin = signal<boolean>(
    sessionStorage.getItem(SESSION_SUPER_ADMIN) === 'true'
  );

  public registeredShops = signal<StoreTenant[]>(this.defaultShops);
  public activeShop = signal<StoreTenant>(this.defaultShops[0]);

  constructor() {
    this.initialize();
    this.fetchRemoteShops();
  }

  /**
   * Public initialize method to load synchronous local storage state
   */
  public initialize(): void {
    try {
      const rawTenants = localStorage.getItem(STORAGE_KEY_TENANTS);
      let localShops: StoreTenant[] = rawTenants ? JSON.parse(rawTenants) : this.defaultShops;
      
      if (!Array.isArray(localShops) || localShops.length === 0) {
        localShops = this.defaultShops;
        localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(localShops));
      }
      this.registeredShops.set(localShops);

      const targetCode = localStorage.getItem(STORAGE_KEY_ACTIVE) || 'mar-market';
      const found = localShops.find(s => s.code === targetCode) || localShops[0];
      
      this.activeShop.set(found);
      localStorage.setItem(STORAGE_KEY_ACTIVE, found.code);
      console.log(`[Tenant] Initialized active shop: ${found.code} (${found.name})`);
    } catch (e) {
      console.error('[Tenant] Local init error:', e);
      this.registeredShops.set(this.defaultShops);
      this.activeShop.set(this.defaultShops[0]);
    }
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

        // Merge defaults, local, and Firestore
        const mergedMap = new Map<string, StoreTenant>();
        this.defaultShops.forEach(s => mergedMap.set(s.code, s));
        this.registeredShops().forEach(s => mergedMap.set(s.code, s));
        remoteShops.forEach(s => mergedMap.set(s.code, s));

        const updatedList = Array.from(mergedMap.values());
        this.registeredShops.set(updatedList);
        localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(updatedList));

        // Preserve current active selection strictly
        const currentActiveCode = localStorage.getItem(STORAGE_KEY_ACTIVE);
        const match = updatedList.find(s => s.code === currentActiveCode);
        if (match) {
          this.activeShop.set(match);
        }
      }
    } catch (err) {
      console.warn('[Tenant] Remote sync skipped or offline:', err);
    }
  }

  public async registerShop(newShop: StoreTenant): Promise<void> {
    const cleanCode = newShop.code.trim().toLowerCase().replace(/\s+/g, '-');
    const shopToSave: StoreTenant = {
      ...newShop,
      code: cleanCode
    };

    // 1. Update list locally
    const currentList = this.registeredShops().filter(s => s.code !== shopToSave.code);
    const updated = [...currentList, shopToSave];

    this.registeredShops.set(updated);
    this.activeShop.set(shopToSave);

    // 2. Synchronously write both keys to localStorage
    localStorage.setItem(STORAGE_KEY_TENANTS, JSON.stringify(updated));
    localStorage.setItem(STORAGE_KEY_ACTIVE, shopToSave.code);

    console.log(`[Tenant] Registered and switched to ${shopToSave.code}`);

    // 3. Save to Firestore in background
    try {
      const shopDocRef = doc(this.firestore, `shops/${shopToSave.code}`);
      await setDoc(shopDocRef, shopToSave, { merge: true });
    } catch (err) {
      console.error('[Tenant] Firestore write failed:', err);
    }

    // 4. Reload page to initialize new active store
    setTimeout(() => {
      window.location.href = window.location.origin + window.location.pathname;
    }, 150);
  }

  public switchShop(target: StoreTenant | Shop | string): void {
    if (!this.isSuperAdmin()) {
      console.warn('[Tenant] Unauthorized attempt to switch shop.');
      return;
    }

    const code = typeof target === 'string' ? target : target.code;
    const found = this.registeredShops().find(s => s.code === code);
    
    if (!found) {
      console.error(`[Tenant] Cannot switch: code "${code}" not found.`);
      return;
    }

    localStorage.setItem(STORAGE_KEY_ACTIVE, found.code);
    this.activeShop.set(found);

    setTimeout(() => {
      window.location.href = window.location.origin + window.location.pathname;
    }, 150);
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