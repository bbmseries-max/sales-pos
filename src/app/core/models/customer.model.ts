export interface Customer {
  id: string;
  phone: string;              // Primary lookup key (e.g. "6971234567")
  name: string;
  email?: string;
  loyaltyPoints: number;      // Current active point balance
  totalSpent: number;         // Lifetime spend
  totalVisits: number;
  discountRate?: number;      // Fixed VIP discount percentage (e.g. 5 = 5%)
  afm?: string;               // Greek VAT ID for B2B Invoices
  doy?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  lastVisit: string;
}