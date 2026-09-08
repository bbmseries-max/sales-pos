import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, fromEvent, firstValueFrom } from 'rxjs';
import { posDb, OfflineSale } from '../db/pos-offline.db';

@Injectable({
  providedIn: 'root'
})
export class OfflineSyncService {
  private http = inject(HttpClient);
  private readonly API_SYNC_ENDPOINT = '/api/sales/sync'; // Adjust to your backend endpoint

  // Tracks if the browser has an active network connection
  public isOnline$ = new BehaviorSubject<boolean>(navigator.onLine);
  // Count of pending transactions waiting to be synced
  public pendingCount$ = new BehaviorSubject<number>(0);
  // Flag to prevent overlapping sync runs
  private isSyncing = false;

  constructor() {
    this.initNetworkListeners();
    this.updatePendingCount();

    // Trigger an initial sync if online upon app startup
    if (navigator.onLine) {
      this.syncPendingSales();
    }
  }

  private initNetworkListeners(): void {
    fromEvent(window, 'online').subscribe(() => {
      this.isOnline$.next(true);
      this.syncPendingSales();
    });

    fromEvent(window, 'offline').subscribe(() => {
      this.isOnline$.next(false);
    });
  }

  /**
   * Update the pending count for UI badges
   */
  async updatePendingCount(): Promise<void> {
    const count = await posDb.sales.where('syncStatus').equals('pending').count();
    this.pendingCount$.next(count);
  }

  /**
   * Record a sale: stores locally first, then attempts immediate sync if online
   */
  async recordSale(saleData: Omit<OfflineSale, 'id' | 'clientUuid' | 'syncStatus' | 'retryCount' | 'createdAt'>): Promise<OfflineSale> {
    const newSale: OfflineSale = {
      ...saleData,
      clientUuid: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      syncStatus: 'pending',
      retryCount: 0
    };

    const id = await posDb.sales.add(newSale);
    newSale.id = id;

    await this.updatePendingCount();

    // If online, immediately sync this sale in the background
    if (navigator.onLine) {
      this.syncPendingSales();
    }

    return newSale;
  }

  /**
   * Syncs all pending records in order
   */
  async syncPendingSales(): Promise<void> {
    if (this.isSyncing || !navigator.onLine) {
      return;
    }

    this.isSyncing = true;

    try {
      const pendingSales = await posDb.sales
        .where('syncStatus')
        .equals('pending')
        .sortBy('id');

      for (const sale of pendingSales) {
        try {
          // Mark as syncing
          await posDb.sales.update(sale.id!, { syncStatus: 'syncing' });

          // Send to backend
          await firstValueFrom(this.http.post(this.API_SYNC_ENDPOINT, sale));

          // On success, mark synced or delete if you prefer a compact local DB
          await posDb.sales.update(sale.id!, {
            syncStatus: 'synced'
          });
        } catch (err: any) {
          console.error(`Failed to sync sale ${sale.clientUuid}:`, err);
          await posDb.sales.update(sale.id!, {
            syncStatus: 'pending', // reset so it retries next time
            retryCount: (sale.retryCount || 0) + 1,
            lastError: err?.message || 'Network error'
          });
          // Break loop on network failure to avoid spamming
          break;
        }
      }
    } finally {
      this.isSyncing = false;
      await this.updatePendingCount();
    }
  }
}