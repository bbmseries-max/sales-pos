export interface VatSummaryTier {
  rate: number;
  net: number;
  vat: number;
  gross: number;
}

export interface CashDenominationCount {
  denomination: number;
  count: number;
}

export interface ZReportAudit {
  id: string;
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
  progressiveGrandTotal: number;

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
  variance: number;

  // VAT Breakdown
  vatAnalysis: Record<string, VatSummaryTier>;

  status: 'DRAFT' | 'CLOSED';
}