import Dexie, { Table } from 'dexie';
import { 
  Product, 
  Category, 
  StockAuditLog,
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
 * Reads the active shop code first from URL query params (?shop=...),
 * falling back to localStorage, and defaulting to 'mar-market'.
 */
export function getActiveStoreCode(): string {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      const urlShop = params.get('shop');
      if (urlShop) {
        return urlShop;
      }
    }
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('active_shop');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.code) return parsed.code;
      }
      const stored = localStorage.getItem('active_shop_code');
      if (stored) return stored;
    }
  } catch (e) {
    console.warn('[DB] Could not resolve store code:', e);
  }
  return 'mar-market';
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
  public stockLogs!: Table<StockAuditLog, string>;
  public goodsReceipts!: Table<any, string>;

  constructor(storeCode: string = getActiveStoreCode()) {
    super(`MaranthPOS_${storeCode}`);

    this.version(1).stores({
      products: 'id, barcode, sku, categoryId, name, isPinned, isActive, storeId, _syncStatus',
      categories: 'id, name, tenantId',
      transactions: 'id, timestamp, paymentMethod, customerPhone, storeId, mydataMark, _syncStatus',
      spoilageLogs: 'id, productId, timestamp, storeId',
      cashLogs: 'id, type, timestamp, storeId',
      customers: 'id, phone, name, afm',
      suppliers: 'id, name, afm, phone',
      purchaseOrders: 'id, supplierId, status, orderDate, invoiceNumber, storeId',
      cashiers: 'id, pin, storeId, role, isActive',
      shifts: 'id, cashierId, status, startTime, storeId',
      goodsReceipts: 'id, supplierId, invoiceNumber, receivedAt, storeId, _syncStatus',
      stockLogs: 'id, productId, storeId, cashierId, timestamp, _syncStatus'
    });
  }
}

// Active singleton instance for current store
export const marketDb = new MarketDatabase();

if (typeof window !== 'undefined') {
  (window as any).marketDb = marketDb;
}

marketDb.open()
  .then(db => {
    console.log('[Dexie] Database opened successfully:', db.name, 'version:', db.verno);
  })
  .catch(err => {
    console.error('[Dexie] FATAL: Failed to open IndexedDB:', err);
  });