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

  constructor() {
    super('MaranthMarketDB');

    // Keep version 6 history
    this.version(6).stores({
      products: '++id, barcode, sku, categoryId, name, isPinned, isActive, storeId',
      categories: 'id, name, tenantId',
      transactions: 'id, timestamp, paymentMethod, customerPhone, storeId',
      spoilageLogs: 'id, productId, timestamp, storeId',
      cashLogs: 'id, type, timestamp, storeId',
      customers: 'id, phone, name, afm',
      suppliers: 'id, name, afm, phone',
      purchaseOrders: 'id, supplierId, status, orderDate, invoiceNumber, storeId',
      cashiers: 'id, pin, storeId, role, isActive',
      shifts: 'id, cashierId, status, startTime, storeId'
    });

    // Version 8 - Preserves all tables & original primary keys while adding storeId + _syncStatus
    this.version(8).stores({
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

export const marketDb = new MarketDatabase();