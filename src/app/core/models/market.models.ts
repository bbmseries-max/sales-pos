export type { Product, Category } from './product.model';
export type { CartItem, HeldTicket } from './cart.model';
export type { MarketCompanyProfile, PaymentMethod, TransactionRecord } from './transaction.model';
export type { Customer } from './customer.model';
export type { Cashier, CashierShift, ShiftPaymentSummary, CashMovement } from './cashier-shift.model';
export type { SpoilageLog, CashLog, SpoilageReason } from './spoilage.model';
export type { Supplier, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from './supplier.model';

export interface MasterCategory {
  id: string;
  name: string;
  icon: string;
}

export const SUPERMARKET_DEPARTMENTS: MasterCategory[] = [
  { id: 'cat-fruit', name: 'Οπωροπωλείο (Φρούτα & Λαχανικά)', icon: '🍎' },
  { id: 'cat-dairy', name: 'Γαλακτοκομικά, Τυριά & Αλλαντικά', icon: '🧀' },
  { id: 'cat-bakery', name: 'Αρτοποιείο, Μπισκότα & Σνακ', icon: '🍞' },
  { id: 'cat-drinks', name: 'Αναψυκτικά, Νερά & Ποτά', icon: '🥤' },
  { id: 'cat-cleaning', name: 'Καθαριστικά & Χαρτικά', icon: '🧼' },
  { id: 'cat-tobacco', name: 'Καπνικά & Ψιλικά', icon: '🚬' },
  { id: 'cat-pets', name: 'Κατοικίδια & Pet Shop', icon: '🐾' },
  { id: 'cat-pantry', name: 'Παντοπωλείο & Τρόφιμα', icon: '🥫' }
];