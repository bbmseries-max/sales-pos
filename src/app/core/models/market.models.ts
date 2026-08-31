import type { CartItem } from './cart.model';

export type { Product, Category } from './product.model';
export type { CartItem, HeldTicket } from './cart.model';
export type { Customer } from './customer.model';
export type { Cashier, CashierShift, ShiftPaymentSummary, CashMovement } from './cashier-shift.model';
export type { SpoilageLog, CashLog, SpoilageReason } from './spoilage.model';
export type { Supplier, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from './supplier.model';

export type PaymentMethod = 'Cash' | 'Card' | 'Debit' | 'Split';

export interface MasterCategory {
  id?: string | number;
  name: string;
  sku?: string;
  icon: string;
}

export interface MarketCompanyProfile {
  name: string;
  storeName?: string;
  companyTitle?: string;
  afm: string;
  doy?: string;
  address?: string;
  phone?: string;
  postalCode?: string;
  city?: string;
  email?: string;
}

export interface TransactionRecord {
  id: string;
  timestamp: string;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  cashier?: string;
  cashierName?: string;
  cashTendered?: number;
  changeDue?: number;
  vatBreakdown?: Record<string | number, { net: number; vat: number; gross: number }>;

  // Customer & Loyalty
  customerId?: string;
  customerPhone?: string;
  customerName?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  discountApplied?: number;

  // AADE myDATA
  mydataMark?: string;
  mydataUid?: string;
  mydataQrUrl?: string;
  _syncStatus?: 'synced' | 'pending' | 'dirty' | 'offline';
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

/**
 * Normalizes any date input (Firestore Timestamp, DD/MM/YYYY, ISO, string) into 'YYYY-MM-DD'
 */
export function normalizeDateToInput(raw: any): string | undefined {
  if (!raw) return undefined;

  // 1. Handle Firestore Timestamp objects { seconds, nanoseconds }
  if (typeof raw === 'object' && 'seconds' in raw) {
    const d = new Date(raw.seconds * 1000);
    return isNaN(d.getTime()) ? undefined : d.toISOString().split('T')[0];
  }

  const str = String(raw).trim();
  if (!str || str === 'null' || str === 'undefined' || str === '0') return undefined;

  // 2. Handle DD/MM/YYYY or DD-MM-YYYY (e.g. 22/04/2022)
  if (str.includes('/') || (str.includes('-') && str.split('-')[0].length <= 2)) {
    const delimiter = str.includes('/') ? '/' : '-';
    const parts = str.split(delimiter);
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${year}-${month}-${day}`;
    }
  }

  // 3. Handle standard ISO or YYYY-MM-DD
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }

  return undefined;
}