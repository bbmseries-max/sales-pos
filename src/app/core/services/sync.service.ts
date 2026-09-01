import { Injectable, inject, signal } from '@angular/core';
import { Firestore, writeBatch, doc } from '@angular/fire/firestore';
import { marketDb } from '../db/market-db';
import { Product, normalizeDateToInput } from '../models';
import { TenantConfigService } from './tenant-config.service';
import { MyDataService } from './mydata.service';
//import type { TransactionRecord } from '../models';
@Injectable({
  providedIn: 'root'
})
export class SyncService {
  private firestore = inject(Firestore);
  private tenantConfig = inject(TenantConfigService);
  private myDataService = inject(MyDataService);

  // Reactive UI signals for header badges and loaders
  public isSyncing = signal<boolean>(false);
  public pendingCount = signal<number>(0);
  public isOnline = signal<boolean>(navigator.onLine);

  private syncLock = false;
  /**
   * Backwards-compatible alias for pushing product changes
   */
  public async pushDeltaToHub(): Promise<number> {
    return this.pushProductsDeltaToHub();
  }

  /**
   * Backwards-compatible alias for full sync
   */
  public async sync(): Promise<void> {
    await this.syncAll();
  }

  constructor() {
    this.initNetworkListeners();
    this.refreshPendingCount();
  }

  /**
   * Browser online/offline event listeners & periodic sync fallback
   */
  private initNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.isOnline.set(true);
      console.log('[SyncService] Network restored. Processing queue...');
      this.syncAll();
    });

    window.addEventListener('offline', () => {
      this.isOnline.set(false);
      console.log('[SyncService] Network offline. Changes queued in Dexie.');
    });

    // Heartbeat every 60s
    setInterval(() => {
      if (navigator.onLine && !this.syncLock) {
        this.syncAll();
      }
    }, 60000);
  }

  /**
   * Recounts all pending transactions and product edits in local Dexie
   */
  public async refreshPendingCount(): Promise<number> {
    try {
      const [pendingTx, pendingProds] = await Promise.all([
        marketDb.transactions.where('_syncStatus').equals('dirty').count(),
        marketDb.products.where('_syncStatus').equals('dirty').count()
      ]);
      const total = pendingTx + pendingProds;
      this.pendingCount.set(total);
      return total;
    } catch (err) {
      console.warn('[SyncService] Pending count calculation failed:', err);
      return 0;
    }
  }

  /**
   * Saves or updates a product in Dexie and marks it dirty
   */
  public async saveProduct(product: Product): Promise<void> {
    const now = new Date().toISOString();
    const barcode = String(product.barcode || product.sku || product.id).trim();
    const cleanDate = normalizeDateToInput(product.statusDate || product.expire);
    const currentStoreId = this.tenantConfig.activeShop()?.code || 'mar-market';

    const record: Product = {
      ...product,
      barcode,
      statusDate: cleanDate,
      expire: cleanDate,
      storeId: currentStoreId,
      updatedAt: now,
      _syncStatus: 'dirty'
    };

    await marketDb.products.put(record);
    await this.refreshPendingCount();
  }

  /**
   * Master sync runner: synchronizes both dirty sales and product catalog changes
   */
  public async syncAll(): Promise<{ txSynced: number; prodsSynced: number }> {
    if (this.syncLock || !navigator.onLine) {
      return { txSynced: 0, prodsSynced: 0 };
    }

    this.syncLock = true;
    this.isSyncing.set(true);

    let txSynced = 0;
    let prodsSynced = 0;

    try {
      txSynced = await this.pushTransactionsToHub();
      prodsSynced = await this.pushProductsDeltaToHub();
    } catch (err) {
      console.error('[SyncService] Sync cycle failure:', err);
    } finally {
      this.syncLock = false;
      this.isSyncing.set(false);
      await this.refreshPendingCount();
    }

    return { txSynced, prodsSynced };
  }

  /**
   * 1. PUSH TRANSACTIONS: Transmits myDATA fiscal MARK and saves to Firestore
   */
  public async pushTransactionsToHub(): Promise<number> {
    const dirtyTransactions = await marketDb.transactions
      .where('_syncStatus')
      .equals('dirty')
      .sortBy('timestamp');

    if (dirtyTransactions.length === 0) return 0;

    const currentStoreId = this.tenantConfig.activeShop()?.code || 'mar-market';
    const activeShop = this.tenantConfig.activeShop?.() || {};
    const companyProfile = {
      storeName: activeShop.name || 'MARANTH MARKET',
      afm: activeShop.afm || '123456789',
      doy: activeShop.doy || 'DOY',
      address: activeShop.address || ''
    };

    let synced = 0;

    for (const tx of dirtyTransactions) {
      try {
        // Step A: AADE myDATA transmission if not already stamped
        if (!tx.mydataMark && this.myDataService?.transmitReceipt) {
          const myDataRes = await Promise.race([
            this.myDataService.transmitReceipt(tx, companyProfile),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('myDATA timeout')), 5000))
          ]);

          if (myDataRes?.success && myDataRes?.mark) {
            tx.mydataMark = myDataRes.mark;
            tx.mydataUid = myDataRes.uid;
            tx.mydataQrUrl = myDataRes.qrUrl;
          }
        }

        // Step B: Push to Firebase Firestore
        const { _syncStatus, ...payload } = tx;
        const sanitized = this.cleanUndefinedFields(payload);
        const txDocRef = doc(this.firestore, `tenants/${currentStoreId}/transactions/${tx.id}`);
        
        const batch = writeBatch(this.firestore);
        batch.set(txDocRef, { ...sanitized, storeId: currentStoreId }, { merge: true });
        await batch.commit();

        // Step C: Mark locally as synced
        tx._syncStatus = 'synced';
        await marketDb.transactions.put(tx);
        synced++;
      } catch (itemErr) {
        console.warn(`[SyncService] Transaction ${tx.id} sync paused:`, itemErr);
        // Break out to preserve chronological processing order on network failure
        break;
      }
    }

    return synced;
  }

  /**
   * 2. PUSH PRODUCTS: Batched Firestore sync for stock updates and catalog edits
   */
  public async pushProductsDeltaToHub(): Promise<number> {
    const currentStoreId = this.tenantConfig.activeShop()?.code || 'mar-market';
    const dirtyProducts = await marketDb.products
      .where('_syncStatus')
      .equals('dirty')
      .toArray();

    if (dirtyProducts.length === 0) return 0;

    const BATCH_SIZE = 400;
    for (let i = 0; i < dirtyProducts.length; i += BATCH_SIZE) {
      const chunk = dirtyProducts.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(this.firestore);

      for (const item of chunk) {
        const { _syncStatus, ...cloudPayload } = item;
        const cleanBarcode = String(item.barcode).replace(/\//g, '-');
        const sanitized = this.cleanUndefinedFields(cloudPayload);
        const docRef = doc(this.firestore, `tenants/${currentStoreId}/products/${cleanBarcode}`);

        batch.set(docRef, { ...sanitized, storeId: currentStoreId }, { merge: true });
      }

      await batch.commit();

      const barcodes = chunk.map(c => c.barcode);
      await marketDb.products
        .where('barcode')
        .anyOf(barcodes)
        .modify({ _syncStatus: 'synced' });
    }

    return dirtyProducts.length;
  }

  /**
   * Removes undefined values so Firestore does not throw serialization errors
   */
  private cleanUndefinedFields(obj: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined) {
        clean[key] = val;
      }
    }
    return clean;
  }
}