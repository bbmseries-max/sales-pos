import { Product } from './product.model';

export type PaymentMethod = 'Cash' | 'Card' | 'Debit' | 'Split';

export interface CartItem {
  product: Product;
  quantity: number;
  isRefund?: boolean;
  unitPrice?: number;
  lineTotal?: number;
}

export interface MarketCompanyProfile {
  storeName: string;
  companyTitle?: string;
  address: string;
  city?: string;
  postalCode?: string;
  afm: string;
  doy: string;
  phone: string;
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
  
  // Customer & Loyalty Fields
  customerId?: string;
  customerPhone?: string;
  customerName?: string;
  pointsEarned?: number;
  pointsRedeemed?: number;
  discountApplied?: number;
  
  // AADE myDATA Fields
  mydataMark?: string;
  mydataUid?: string;
  mydataQrUrl?: string;
}

export * from './index';