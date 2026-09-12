import Dexie, { Table } from 'dexie';
import { FiscalTransaction } from '../models/fiscal.model';

export class AppDatabase extends Dexie {
  fiscalQueue!: Table<FiscalTransaction, number>;

  constructor(storeCode: string) {
    super(`MaranthPOS_${storeCode}`);
    this.version(1).stores({
      fiscalQueue: '++id, localOrderId, status, timestamp, fiscalMode'
    });
  }
}