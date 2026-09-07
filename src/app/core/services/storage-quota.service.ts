import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class StorageQuotaService {
  public isPersisted = signal<boolean>(false);
  public quotaUsageMb = signal<number>(0);
  public quotaTotalMb = signal<number>(0);

  constructor() {
    this.initPersistence();
  }

  public async initPersistence(): Promise<void> {
    if (!navigator.storage || !navigator.storage.persist) {
      console.warn('StorageManager API not fully supported on this platform.');
      return;
    }

    // 1. Check if already granted
    let persisted = await navigator.storage.persisted();

    // 2. If not granted, request permission
    if (!persisted) {
      persisted = await navigator.storage.persist();
    }

    this.isPersisted.set(persisted);
    await this.refreshQuotaEstimate();

    if (persisted) {
      console.info('IndexedDB storage locked in Persistent mode (No eviction).');
    } else {
      console.warn('Storage is Best-Effort. Browser may evict data under disk pressure.');
    }
  }

  public async refreshQuotaEstimate(): Promise<void> {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const used = (estimate.usage || 0) / (1024 * 1024);
      const total = (estimate.quota || 0) / (1024 * 1024);

      this.quotaUsageMb.set(parseFloat(used.toFixed(2)));
      this.quotaTotalMb.set(parseFloat(total.toFixed(0)));
    }
  }
}