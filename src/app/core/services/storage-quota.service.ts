import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class StorageQuotaService {
  public isPersisted = signal<boolean>(false);
  public usageMb = signal<number>(0);
  public quotaMb = signal<number>(0);

  public async initPersistence(): Promise<boolean> {
    if (typeof window === 'undefined' || !navigator.storage || !navigator.storage.persist) {
      console.warn('[Storage] StorageManager API not supported on this platform.');
      return false;
    }

    try {
      // 1. Check if already durable
      let persisted = await navigator.storage.persisted();

      // 2. Request durable storage if not yet granted
      if (!persisted) {
        persisted = await navigator.storage.persist();
      }

      this.isPersisted.set(persisted);

      if (persisted) {
        console.info('[Storage] Durable quota granted. IndexedDB is protected against browser eviction.');
      } else {
        console.warn('[Storage] Storage remains Best-Effort. Browser may clear data under extreme disk pressure.');
      }

      // 3. Inspect capacity
      await this.refreshQuota();
      return persisted;
    } catch (err) {
      console.error('[Storage] Error configuring storage persistence:', err);
      return false;
    }
  }

  public async refreshQuota(): Promise<void> {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const used = (estimate.usage || 0) / (1024 * 1024);
      const total = (estimate.quota || 0) / (1024 * 1024);

      this.usageMb.set(Number(used.toFixed(2)));
      this.quotaMb.set(Number(total.toFixed(0)));
    }
  }
}