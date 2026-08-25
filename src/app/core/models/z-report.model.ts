export interface VatSummaryTier {
  rate: number;
  net: number;
  vat: number;
  gross: number;
}

export interface CashDenominationCount {
  denomination: number; // e.g., 50, 20, 10, 5, 2, 1, 0.50, 0.20, 0.10
  count: number;
}

export interface ZReportAudit {
  id: string; // e.g. "Z-0001"
  zNumber: number;
  date: string;
  openedAt: string;
  closedAt: string;
  cashierName: string;
  registerId: string;

  // Transaction Metrics
  transactionCount: number;
  refundCount: number;
  refundTotal: number;

  // Turnover & Financials
  grossTurnover: number;
  netTurnover: number;
  totalTax: number;
  progressiveGrandTotal: number; // Προοδευτικό Γενικό Σύνολο

  // Payment Breakdown
  salesCash: number;
  salesCard: number;
  salesOther: number;

  // Drawer Reconciliation
  openingFloat: number;
  cashIn: number;
  cashOut: number;
  expectedDrawerCash: number;
  actualCountedCash: number;
  variance: number; // Actual - Expected (Over/Short)

  // VAT (ΦΠΑ) Breakdown
  vatAnalysis: Record<string, VatSummaryTier>;

  status: 'DRAFT' | 'CLOSED';
}