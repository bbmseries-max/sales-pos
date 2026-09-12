export type FiscalMode = 'FHM' | 'PROVIDER' | 'NONE';

export interface FiscalTransaction {
  id?: number;
  localOrderId: string;
  storeCode: string;
  timestamp: number;
  totalGross: number;
  vatAmounts: {
    rate: number;      // e.g., 24, 13, 6
    net: number;
    vat: number;
  }[];
  items: {
    name: string;
    quantity: number;
    price: number;
    vatRate: number;
  }[];
  status: 'pending_fiscal' | 'completed' | 'failed';
  fiscalMode: FiscalMode;
  mark?: string;
  uid?: string;
  qrUrl?: string;
  errorMessage?: string;
  retryCount: number;
}