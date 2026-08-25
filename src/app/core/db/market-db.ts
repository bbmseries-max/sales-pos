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
    
    this.version(5).stores({
      products: '++id, barcode, sku, categoryId, name, isPinned',
      categories: 'id, name',
      transactions: 'id, timestamp, paymentMethod, customerPhone',
      spoilageLogs: 'id, productId, timestamp',
      cashLogs: 'id, type, timestamp',
      customers: 'id, phone, name, afm',
      suppliers: 'id, name, afm, phone',
      purchaseOrders: 'id, supplierId, status, orderDate, invoiceNumber',
      cashiers: 'id, pin, role, isActive',
      shifts: 'id, cashierId, status, startTime'
    });
  }
}

export const marketDb = new MarketDatabase();