import { Injectable, inject, signal } from '@angular/core';
import { marketDb } from '../db/market-db';
import { TransactionRecord, MarketCompanyProfile, CashLog } from '../models';
import { ZReportAudit, VatSummaryTier } from '../models/z-report.model';
import { EscPosPrinterService } from './esc-pos-printer.service';

@Injectable({ providedIn: 'root' })
export class ZReportService {
  private printerService = inject(EscPosPrinterService);
  public currentZNumber = signal<number>(1);

  /**
   * Aggregates transactions from a given date into a complete Z-Report model
   */
 public async generateDailyAudit(
  targetDate: Date = new Date(),
  openingFloat = 100.00,
  actualCountedCash = 0.00,
  manualCashIn = 0.00,
  manualCashOut = 0.00,
  cashierName = 'Ταμίας 01'
): Promise<ZReportAudit> {
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // 1. Fetch transactions from Dexie DB
  const allTx: TransactionRecord[] = await marketDb.transactions.toArray();
  
  const dayTx = allTx.filter(tx => {
    const txTime = new Date(tx.timestamp).getTime();
    return txTime >= startOfDay.getTime() && txTime <= endOfDay.getTime();
  });

  let grossTurnover = 0;
  let netTurnover = 0;
  let totalTax = 0;
  let salesCash = 0;
  let salesCard = 0;
  let salesOther = 0;
  let refundCount = 0;
  let refundTotal = 0;

  const vatAnalysis: Record<string, VatSummaryTier> = {
    '24': { rate: 24, net: 0, vat: 0, gross: 0 },
    '13': { rate: 13, net: 0, vat: 0, gross: 0 },
    '6': { rate: 6, net: 0, vat: 0, gross: 0 },
    '0': { rate: 0, net: 0, vat: 0, gross: 0 }
  };

  for (const tx of dayTx) {
    grossTurnover += tx.grandTotal || 0;
    netTurnover += tx.subtotal || 0;
    totalTax += tx.taxAmount || 0;

    // Payment Method Breakdown
    if (tx.paymentMethod === 'Cash') {
      salesCash += tx.grandTotal || 0;
    } else if (tx.paymentMethod === 'Card') {
      salesCard += tx.grandTotal || 0;
    } else {
      salesOther += tx.grandTotal || 0;
    }

    // VAT Breakdown
if (tx.vatBreakdown) {
  for (const [rateKey, data] of Object.entries(tx.vatBreakdown) as [string, { net: number; vat: number; gross: number }][]) {
    if (!vatAnalysis[rateKey]) {
      // Parse numeric rate from key (e.g., "13" -> 13, "24" -> 24)
      const numericRate = parseFloat(rateKey) || 0;

      vatAnalysis[rateKey] = { 
        rate: numericRate, 
        net: 0, 
        vat: 0, 
        gross: 0 
      };
    }
    vatAnalysis[rateKey].net += data.net || 0;
    vatAnalysis[rateKey].vat += data.vat || 0;
    vatAnalysis[rateKey].gross += data.gross || 0;
  }
}

    // Refunds
    for (const item of tx.items) {
      if (item.isRefund) {
        refundCount++;
        refundTotal += ((item.product?.price || 0) * item.quantity);
      }
    }
  }

  // 2. Fetch logged drawer movements from Dexie DB
  const allCashLogs: CashLog[] = await marketDb.cashLogs.toArray();
  const dayCashLogs = allCashLogs.filter(log => {
    const logTime = new Date(log.timestamp).getTime();
    return logTime >= startOfDay.getTime() && logTime <= endOfDay.getTime();
  });

  let totalCashIn = manualCashIn;
  let totalCashOut = manualCashOut;

  for (const log of dayCashLogs) {
    if (log.type === 'IN' || (log.type as string) === 'FLOAT') {
      totalCashIn += log.amount;
    } else {
      totalCashOut += log.amount;
    }
  }

  // 3. Reconcile expected drawer cash & calculate variance
  const expectedDrawerCash = openingFloat + salesCash + totalCashIn - totalCashOut;
  const variance = actualCountedCash - expectedDrawerCash;
  const progressiveGrandTotal = allTx.reduce((acc, curr) => acc + (curr.grandTotal || 0), 0);

  return {
    id: `Z-${Date.now().toString(36).toUpperCase()}`,
    zNumber: this.currentZNumber(),
    date: targetDate.toISOString().split('T')[0],
    openedAt: startOfDay.toISOString(),
    closedAt: new Date().toISOString(),
    cashierName,
    registerId: 'REG-01',
    transactionCount: dayTx.length,
    refundCount,
    refundTotal: Number(refundTotal.toFixed(2)),
    grossTurnover: Number(grossTurnover.toFixed(2)),
    netTurnover: Number(netTurnover.toFixed(2)),
    totalTax: Number(totalTax.toFixed(2)),
    progressiveGrandTotal: Number(progressiveGrandTotal.toFixed(2)),
    salesCash: Number(salesCash.toFixed(2)),
    salesCard: Number(salesCard.toFixed(2)),
    salesOther: Number(salesOther.toFixed(2)),
    openingFloat: Number(openingFloat.toFixed(2)),
    cashIn: Number(totalCashIn.toFixed(2)),
    cashOut: Number(totalCashOut.toFixed(2)),
    expectedDrawerCash: Number(expectedDrawerCash.toFixed(2)),
    actualCountedCash: Number(actualCountedCash.toFixed(2)),
    variance: Number(variance.toFixed(2)),
    vatAnalysis,
    status: 'DRAFT'
  };
}

  /**
   * Generates ESC/POS Binary receipt stream for Z-Report
   */
  public buildEscPosZReport(z: ZReportAudit, company?: Partial<MarketCompanyProfile>): Uint8Array {
    const lineWidth = 42; // 80mm roll standard
    const buffer: number[] = [];

    const push = (...bytes: number[]) => buffer.push(...bytes);
    const pushText = (str: string) => {
      const sanitized = this.printerService.sanitizeGreek(str);
      for (let i = 0; i < sanitized.length; i++) {
        buffer.push(sanitized.charCodeAt(i));
      }
    };
    const pushLine = (str: string) => {
      pushText(str);
      push(0x0A);
    };

    // ESC @ - Initialize
    push(0x1B, 0x40);

    // Header
    push(0x1B, 0x61, 0x01); // Center
    push(0x1B, 0x45, 0x01); // Bold ON
    pushLine(company?.storeName || 'MARANTH MARKET');
    push(0x1B, 0x45, 0x00);
    if (company?.afm) pushLine(`AFM: ${company.afm} - DOY: ${company.doy || 'ATHINON'}`);
    pushLine('='.repeat(lineWidth));
    
    push(0x1B, 0x45, 0x01);
    push(0x1D, 0x21, 0x11); // Double size
    pushLine(`DELTIO "Z" AR. ${z.zNumber}`);
    push(0x1D, 0x21, 0x00);
    push(0x1B, 0x45, 0x00);
    pushLine('='.repeat(lineWidth));

    push(0x1B, 0x61, 0x00); // Left align
    pushLine(`HMEROMHNIA: ${new Date(z.closedAt).toLocaleDateString('el-GR')}`);
    pushLine(`ORA KLEISIMATOS: ${new Date(z.closedAt).toLocaleTimeString('el-GR')}`);
    pushLine(`TAMEIO: ${z.registerId}   XEIRISTIS: ${z.cashierName}`);
    pushLine(`SYNOLO APODEIXEON: ${z.transactionCount}`);
    pushLine('-'.repeat(lineWidth));

    // Turnover Summary
    const formatRow = (label: string, value: number) => {
      const valStr = `EUR ${value.toFixed(2)}`;
      const spaces = Math.max(1, lineWidth - label.length - valStr.length);
      return label + ' '.repeat(spaces) + valStr;
    };

    push(0x1B, 0x45, 0x01);
    pushLine(formatRow('AKATHARISTOS TZIRAS (GROSS):', z.grossTurnover));
    pushLine(formatRow('KATHAROS TZIRAS (NET):', z.netTurnover));
    pushLine(formatRow('SYNOLO F.P.A. (VAT):', z.totalTax));
    push(0x1B, 0x45, 0x00);

    pushLine('-'.repeat(lineWidth));
    pushLine('ANALYSIS PLIROMON');
    pushLine(formatRow('  METRHTA (CASH):', z.salesCash));
    pushLine(formatRow('  KARTES (CARD / POS):', z.salesCard));
    if (z.salesOther > 0) pushLine(formatRow('  LOIPA (OTHER):', z.salesOther));

    pushLine('='.repeat(lineWidth));
    pushLine('ANALYSIS F.P.A.');
    pushLine('SYNT.     KATHARI     F.P.A.      SYNOLO');
    pushLine('-'.repeat(lineWidth));

    for (const [_, v] of Object.entries(z.vatAnalysis)) {
      if (v.gross > 0) {
        const rStr = `${v.rate}%`.padEnd(8, ' ');
        const netStr = v.net.toFixed(2).padStart(8, ' ');
        const vatStr = v.vat.toFixed(2).padStart(8, ' ');
        const grsStr = v.gross.toFixed(2).padStart(10, ' ');
        pushLine(`${rStr}  ${netStr}  ${vatStr}  ${grsStr}`);
      }
    }

    pushLine('='.repeat(lineWidth));
    pushLine('TAMEIAKO ISOLOGIO (CASH RECONCILIATION)');
    pushLine(formatRow('  ARXIKO TAMEIO (FLOAT):', z.openingFloat));
    pushLine(formatRow('  EISPRAXEIS METRITON:', z.salesCash));
    if (z.cashIn > 0) pushLine(formatRow('  EISROES (+):', z.cashIn));
    if (z.cashOut > 0) pushLine(formatRow('  EKROES (-):', z.cashOut));
    pushLine('-'.repeat(lineWidth));
    pushLine(formatRow('  ANAMENOMENO TAMEIO:', z.expectedDrawerCash));
    pushLine(formatRow('  KATAMETRHMENO TAMEIO:', z.actualCountedCash));
    
    push(0x1B, 0x45, 0x01);
    const varLabel = z.variance >= 0 ? '  PLEONASMA (+):' : '  ELLEIMMA (-):';
    pushLine(formatRow(varLabel, Math.abs(z.variance)));
    push(0x1B, 0x45, 0x00);

    pushLine('='.repeat(lineWidth));
    push(0x1B, 0x61, 0x01);
    pushLine(`GENIKO PROODEYTIKO SYNOLO: EUR ${z.progressiveGrandTotal.toFixed(2)}`);
    pushLine('TELOS HMERISIOY DELTIOY "Z"');

    // Feed & Full Cut
    push(0x0A, 0x0A, 0x0A, 0x0A);
    push(0x1D, 0x56, 0x42, 0x00);

    return new Uint8Array(buffer);
  }
}