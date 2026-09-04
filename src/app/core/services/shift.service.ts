import { Injectable, signal } from '@angular/core';
import { marketDb } from '../db/market-db';

export interface VatBucket {
  net: number;
  vat: number;
}

export interface ZReportSummary {
  reportDate: string;
  storeCode: string;
  cashierName: string;
  openingCash: number;
  totalSales: number;
  cashSales: number;
  cardSales: number;
  receiptCount: number;
  vatTotals: Record<string, VatBucket>;
  expectedDrawerCash: number;
  actualDrawerCash?: number;
  difference?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ShiftService {
  public activeShiftStart = signal<string>(new Date().toISOString());
  public openingCash = signal<number>(50.0);

  /**
   * Generates aggregated Z-Report figures for current shift
   */
  public async generateZReport(actualCountedCash?: number): Promise<ZReportSummary> {
    const shiftStart = this.activeShiftStart();
    const transactions = await marketDb.transactions
      .where('timestamp')
      .aboveOrEqual(shiftStart)
      .toArray();

    let totalSales = 0;
    let cashSales = 0;
    let cardSales = 0;

    const vatTotals: Record<string, VatBucket> = {
      '24': { net: 0, vat: 0 },
      '13': { net: 0, vat: 0 },
      '6': { net: 0, vat: 0 },
      '0': { net: 0, vat: 0 }
    };

    for (const tx of transactions) {
      const amount = Number(tx.grandTotal) || 0;
      totalSales += amount;

      if (tx.paymentMethod === 'Cash') {
        cashSales += amount;
      } else if (tx.paymentMethod === 'Card') {
        cardSales += amount;
      } else if (tx.paymentMethod === 'Split') {
        cashSales += Number(tx.cashTendered || 0) - Number(tx.changeDue || 0);
        cardSales += amount - (Number(tx.cashTendered || 0) - Number(tx.changeDue || 0));
      }

      // Aggregate VAT buckets
      if (tx.vatBreakdown) {
        for (const [rate, val] of Object.entries(tx.vatBreakdown as Record<string, any>)) {
          if (vatTotals[rate]) {
            vatTotals[rate].net += Number(val.net) || 0;
            vatTotals[rate].vat += Number(val.vat) || 0;
          }
        }
      }
    }

    const expectedCash = this.openingCash() + cashSales;
    const diff = actualCountedCash !== undefined ? actualCountedCash - expectedCash : undefined;

    return {
      reportDate: new Date().toISOString(),
      storeCode: transactions[0]?.storeId || 'default',
      cashierName: transactions[0]?.cashierName || 'Cashier 01',
      openingCash: this.openingCash(),
      totalSales,
      cashSales,
      cardSales,
      receiptCount: transactions.length,
      vatTotals,
      expectedDrawerCash: expectedCash,
      actualDrawerCash: actualCountedCash,
      difference: diff
    };
  }
}