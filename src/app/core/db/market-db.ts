import Dexie, { Table } from 'dexie';
import { 
  Product, 
  Category, 
  TransactionRecord, 
  SpoilageLog, 
  CashLog, 
  Customer, 
  Supplier, 
  PurchaseOrder, 
  Cashier, 
  CashierShift 
} from '../models/market.models';

/**
 * Reads the active shop code directly from localStorage to mount the correct isolated database sandbox.
 */
export function getActiveStoreCode(): string {
  try {
    const raw = localStorage.getItem('active_shop');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.code) return parsed.code;
    }
  } catch {}
  return localStorage.getItem('active_shop_code') || 'mar-market';
}

export class MarketDatabase extends Dexie {
  public products!: Table<Product, string | number>;
  public categories!: Table<Category, string>;
  public transactions!: Table<TransactionRecord, string>;
  public spoilageLogs!: Table<SpoilageLog, string>;
  public cashLogs!: Table<CashLog, string>;
  public customers!: Table<Customer, string>;
  public suppliers!: Table<Supplier, string>;
  public purchaseOrders!: Table<PurchaseOrder, string>;
  public cashiers!: Table<Cashier, string>;
  public shifts!: Table<CashierShift, string>;

  constructor(storeCode: string = getActiveStoreCode()) {
    // Each store gets its own dedicated, isolated IndexedDB container:
    // e.g., 'MaranthPOS_mar-market', 'MaranthPOS_ftest'
    super(`MaranthPOS_${storeCode}`);

    this.version(1).stores({
      products: '++id, barcode, sku, categoryId, name, isPinned, isActive, storeId, _syncStatus',
      categories: 'id, name, tenantId',
      transactions: 'id, timestamp, paymentMethod, customerPhone, storeId, mydataMark',
      spoilageLogs: 'id, productId, timestamp, storeId',
      cashLogs: 'id, type, timestamp, storeId',
      customers: 'id, phone, name, afm',
      suppliers: 'id, name, afm, phone',
      purchaseOrders: 'id, supplierId, status, orderDate, invoiceNumber, storeId',
      cashiers: 'id, pin, storeId, role, isActive',
      shifts: 'id, cashierId, status, startTime, storeId'
    });
  }
}

// Active singleton instance for current store
export const marketDb = new MarketDatabase();

// Expose globally to window for easy debugging in DevTools Console (F12)
if (typeof window !== 'undefined') {
  (window as any).marketDb = marketDb;
}