import Dexie, { Table } from 'dexie';

export interface OfflineSale {
  id?: number;              // Auto-incremented primary key
  clientUuid: string;       // Unique UUID generated on frontend to prevent duplicate syncs
  createdAt: string;        // ISO date string
  items: Array<{
    productId: string;
    name: string;
    qty: number;
    price: number;
  }>;
  totalAmount: number;
  paymentMethod: 'CASH' | 'CARD';
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  lastError?: string;
}

export class PosOfflineDatabase extends Dexie {
  sales!: Table<OfflineSale, number>;

  constructor() {
    super('MaranthPosDb');

    // Define schema & indexed keys:
    // ++id is auto-increment PK, clientUuid is unique, syncStatus is indexed for fast querying
    this.version(1).stores({
      sales: '++id, clientUuid, syncStatus, createdAt'
    });
  }
}

export const posDb = new PosOfflineDatabase();