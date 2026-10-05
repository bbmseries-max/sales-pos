export interface Customer {
  id: string;
  phone: string;              // Primary lookup key (e.g. "6971234567")
  name: string;
  cardBarcode?: string;       // Scannable Loyalty Card barcode / QR code
  email?: string;
  loyaltyPoints: number;      // Current active point balance
  totalSpent: number;         // Lifetime spend
  totalVisits: number;
  discountRate?: number;      // Fixed VIP discount percentage (e.g. 5 = 5%)
  
  // "Τεφτέρι" / Debit Ledger
  currentDebt?: number;       // Current unpaid debt balance in €
  maxCreditLimit?: number;    // Credit cap (e.g. max 150€)
  
  // B2B Invoice Data (Τιμολόγιο / myDATA)
  afm?: string;               // Greek VAT ID (9 digits)
  doy?: string;               // Tax office
  profession?: string;        // Business activity (Required by AADE for B2B)
  address?: string;
  city?: string;
  postalCode?: string;

  notes?: string;
  createdAt: string;
  lastVisit: string;
  updatedAt?: string;
}