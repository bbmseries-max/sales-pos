import { CashierShift, TransactionRecord, ShiftPaymentSummary } from '../models/market.models';

export interface VatRateSummary {
  rate: number;
  net: number;
  vat: number;
  gross: number;
}

export interface LiveShiftAuditResult {
  shiftId: string;
  openedAt: string;
  cashierName: string;
  cashierRole?: string;
  transactionCount: number;
  totalSales: number;
  netSales: number;
  vatTotal: number;
  cashSales: number;
  cardSales: number;
  debitSales: number;
  openingFloat: number;
  expectedCashInDrawer: number;
  vatBreakdown: VatRateSummary[];
}

export function calculateExpectedShiftCash(shift: CashierShift): number {
  const opening = Number(shift.openingFloat) || 0;
  const cashSales = Number(shift.sales?.cash) || 0;
  const cashIn = Number(shift.cashInTotal) || 0;
  const cashOut = Number(shift.cashOutTotal) || 0;
  return Number((opening + cashSales + cashIn - cashOut).toFixed(2));
}

export function computeUpdatedShiftSales(
  currentSales: ShiftPaymentSummary | undefined,
  amount: number,
  method: string,
  isRefund = false,
  splitDetails?: { cash: number; card: number }
): ShiftPaymentSummary {
  const rawAmount = Number(amount) || 0;
  const signed = isRefund ? -Math.abs(rawAmount) : Math.abs(rawAmount);

  const sales: ShiftPaymentSummary = {
    cash: Number(currentSales?.cash) || 0,
    card: Number(currentSales?.card) || 0,
    split: Number(currentSales?.split) || 0,
    debit: Number(currentSales?.debit) || 0,
    totalSales: Number(currentSales?.totalSales) || 0,
    transactionCount: Number(currentSales?.transactionCount) || 0
  };

  sales.totalSales = Number((sales.totalSales + signed).toFixed(2));
  sales.transactionCount += 1;

  const normalized = (method || '').toUpperCase();

  if (normalized.includes('SPLIT')) {
    const cashPart = splitDetails ? (isRefund ? -Math.abs(splitDetails.cash) : Math.abs(splitDetails.cash)) : signed;
    const cardPart = splitDetails ? (isRefund ? -Math.abs(splitDetails.card) : Math.abs(splitDetails.card)) : 0;

    sales.cash = Number((sales.cash + cashPart).toFixed(2));
    sales.card = Number((sales.card + cardPart).toFixed(2));
    sales.split = Number(((sales.split ?? 0) + signed).toFixed(2));
  } else if (normalized.includes('DEBIT') || normalized.includes('VERESE')) {
    sales.debit = Number(((sales.debit ?? 0) + signed).toFixed(2));
  } else if (normalized.includes('CARD') || normalized.includes('POS')) {
    sales.card = Number((sales.card + signed).toFixed(2));
  } else {
    sales.cash = Number((sales.cash + signed).toFixed(2));
  }

  return sales;
}

export function aggregateShiftTransactions(
  shift: CashierShift,
  transactions: TransactionRecord[],
  cashierName = 'Ταμίας',
  cashierRole = 'CASHIER'
): LiveShiftAuditResult {
  const shiftStartTime = new Date(shift.startTime).getTime();

  const validTxs = transactions.filter(tx => {
    const txTime = new Date(tx.timestamp || 0).getTime();
    const matchStore = !shift.storeId || tx.storeId === shift.storeId;
    const isCancelled = Boolean((tx as any).isCancelled || (tx as any).status === 'cancelled');
    return txTime >= shiftStartTime && matchStore && !isCancelled;
  });

  let totalSales = 0;
  let cashSales = 0;
  let cardSales = 0;
  let debitSales = 0;
  let netSales = 0;
  let vatTotal = 0;

  const vatMap = new Map<number, { net: number; vat: number; gross: number }>();

  for (const tx of validTxs) {
    const gross = Number(tx.grandTotal || 0);
    totalSales += gross;

    const method = (tx.paymentMethod || 'Cash').toLowerCase();
    if (method === 'cash') {
      cashSales += gross;
    } else if (method === 'card') {
      cardSales += gross;
    } else if (method === 'debit') {
      debitSales += gross;
    } else if (method === 'split') {
      const splitCash = Number((tx as any).splitCash || (tx as any).splitDetails?.cash || 0);
      const splitCard = Number((tx as any).splitCard || (tx as any).splitDetails?.card || 0);
      cashSales += splitCash;
      cardSales += splitCard;
    }

    const items = tx.items || [];
    for (const item of items) {
      const itemRate = Number(item.product?.vatRate ?? 13);
      const lineGross = Number(item.lineTotal ?? (item.unitPrice ?? 0 * item.quantity));
      const lineNet = lineGross / (1 + itemRate / 100);
      const lineVat = lineGross - lineNet;

      netSales += lineNet;
      vatTotal += lineVat;

      const bucket = vatMap.get(itemRate) || { net: 0, vat: 0, gross: 0 };
      bucket.net += lineNet;
      bucket.vat += lineVat;
      bucket.gross += lineGross;
      vatMap.set(itemRate, bucket);
    }
  }

  const float = Number(shift.openingFloat || 0);
  const expectedCashInDrawer = float + cashSales;

  const vatBreakdown: VatRateSummary[] = Array.from(vatMap.entries()).map(([rate, vals]) => ({
    rate,
    net: parseFloat(vals.net.toFixed(2)),
    vat: parseFloat(vals.vat.toFixed(2)),
    gross: parseFloat(vals.gross.toFixed(2))
  }));

  return {
    shiftId: shift.id,
    openedAt: shift.startTime,
    cashierName,
    cashierRole,
    transactionCount: validTxs.length,
    totalSales: parseFloat(totalSales.toFixed(2)),
    netSales: parseFloat(netSales.toFixed(2)),
    vatTotal: parseFloat(vatTotal.toFixed(2)),
    cashSales: parseFloat(cashSales.toFixed(2)),
    cardSales: parseFloat(cardSales.toFixed(2)),
    debitSales: parseFloat(debitSales.toFixed(2)),
    openingFloat: parseFloat(float.toFixed(2)),
    expectedCashInDrawer: parseFloat(expectedCashInDrawer.toFixed(2)),
    vatBreakdown
  };
}