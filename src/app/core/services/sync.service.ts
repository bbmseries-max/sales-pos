import { Injectable, inject } from '@angular/core';
import { Firestore, writeBatch, doc } from '@angular/fire/firestore';
import { marketDb } from '../db/market-db';
import { Product, normalizeDateToInput } from '../models';
import { TenantConfigService } from './tenant-config.service';

@Injectable({
  providedIn: 'root'
})
export class SyncService {
  private firestore = inject(Firestore);
  private tenantConfig = inject(TenantConfigService);
  private isSyncing = false;

  /**
   * Saves or updates a product in IndexedDB and marks it as 'dirty'
   * so it gets picked up during the next cloud sync.
   */
  async saveProduct(product: Product): Promise<void> {
    const now = new Date().toISOString();
    const barcode = String(product.barcode || product.sku || product.id).trim();
    const cleanDate = normalizeDateToInput(product.statusDate || product.expire);

    const currentStoreId = this.tenantConfig.activeShop()?.code || 'mar-market';
    const record: Product = {
  ...product,
  barcode: barcode,
  statusDate: cleanDate,
  expire: cleanDate,
  storeId: product.storeId || 'currentStoreId',
  updatedAt: now,
  _syncStatus: 'dirty'
    };

    await marketDb.products.put(record);
  }

  /**
   * Pushes ONLY modified/new ('dirty') products to Maranth Hub Firestore.
   */
  async pushDeltaToHub(): Promise<number> {
    if (this.isSyncing) {
      console.warn('[SyncService] Sync already in progress.');
      return 0;
    }

    this.isSyncing = true;

    try {
      // 1. Fetch only dirty products from Dexie
      const dirtyProducts = await marketDb.products
        .where('_syncStatus')
        .equals('dirty')
        .toArray();

      if (dirtyProducts.length === 0) {
        console.log('[SyncService] Everything is up to date (0 items to sync).');
        return 0;
      }

      

      console.log(`[SyncService] Found ${dirtyProducts.length} modified items. Syncing to Hub...`);

      // 2. Batch commit in chunks of 400 (Firestore limit is 500 ops per batch)
      const BATCH_SIZE = 400;
      for (let i = 0; i < dirtyProducts.length; i += BATCH_SIZE) {
        const chunk = dirtyProducts.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(this.firestore);

        for (const item of chunk) {
          const { _syncStatus, ...cloudPayload } = item;
          const cleanDocId = String(item.barcode).replace(/\//g, '-');
          const docRef = doc(this.firestore, `products/${cleanDocId}`);

          batch.set(docRef, cloudPayload, { merge: true });
        }

        await batch.commit();

        // 3. Mark local Dexie records as 'synced'
        const barcodes = chunk.map(c => c.barcode);
        await marketDb.products
          .where('barcode')
          .anyOf(barcodes)
          .modify({ _syncStatus: 'synced' });
      }

      console.log(`[SyncService] Successfully synced ${dirtyProducts.length} items to Hub.`);
      return dirtyProducts.length;
    } catch (err) {
      console.error('[SyncService] Delta sync failed:', err);
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }
}