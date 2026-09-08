import { Injectable, signal, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { Cashier } from '../models';
import { TenantConfigService } from './tenant-config.service';

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
  public tenantConfig = inject(TenantConfigService);
  public activeShiftStart = signal<string>(new Date().toISOString());
  public openingCash = signal<number>(50.0);
  public allCashiers = signal<Cashier[]>([]);
  public currentCashier = signal<Cashier | null>(null);
  public isLocked = signal<boolean>(this.checkInitialLock());

  constructor() {
    this.loadAllCashiers();
  }

  /**
   * Loads cashiers from Dexie for the active store, seeding an admin cashier if empty
   */
  public async loadAllCashiers(): Promise<void> {
    let list = await marketDb.cashiers.toArray();
    list = (list || []).filter(c => c.isActive !== false);

    const activeStore = this.tenantConfig.activeShop();
    const activeStoreCode = activeStore?.code || 'mar-market';

    if (list.length === 0) {
      const storePin = (activeStore as any)?.adminPin || (
        activeStoreCode === 'ftest' ? '1111' :
        activeStoreCode === 'parnasos' ? '3333' : '2222'
      );

      const initialAdmin: Cashier = {
        id: `CASH-ADMIN-${activeStoreCode.toUpperCase()}`,
        name: `Διαχειριστής (${activeStore?.name || activeStoreCode})`,
        pin: storePin,
        role: 'ADMIN',
        storeId: activeStoreCode,
        isActive: true
      };

      await marketDb.cashiers.add(initialAdmin);
      list = [initialAdmin];
    }

    this.allCashiers.set(list);

    // If session was authenticated, restore active cashier reference
    const savedCashierId = sessionStorage.getItem('active_cashier_id');
    if (savedCashierId && !this.isLocked()) {
      const match = list.find(c => c.id === savedCashierId);
      if (match) {
        this.currentCashier.set(match);
      }
    }
  }

  

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

  private checkInitialLock(): boolean {
    // If explicitly locked or no cashier is saved, force the lock screen
    const locked = sessionStorage.getItem('pos_is_locked');
    return locked !== 'false'; // defaults to locked on refresh/new tab
  }

  public async unlockWithPin(pin: string): Promise<boolean> {
    const cleanPin = pin.trim();

    // 1. Check tenant admin PINs
    const storeAuth = this.tenantConfig.resolveAndSwitchByPin(cleanPin);
    if (storeAuth.success) {
      await this.loadAllCashiers();
      const admin = this.allCashiers().find(c => c.pin === cleanPin || c.role === 'ADMIN');
      if (admin) {
        this.setAuthenticatedCashier(admin);
      }
      return true;
    }

    // 2. Check regular cashier PINs
    await this.loadAllCashiers();
    const matched = this.allCashiers().find(c => c.pin === cleanPin);
    if (matched) {
      this.setAuthenticatedCashier(matched);
      return true;
    }

    return false;
  }

  private setAuthenticatedCashier(cashier: Cashier): void {
    this.currentCashier.set(cashier);
    this.isLocked.set(false);
    sessionStorage.setItem('pos_is_locked', 'false');
    sessionStorage.setItem('active_cashier_id', cashier.id);
  }

  public lockTerminal(): void {
    this.currentCashier.set(null);
    this.isLocked.set(true);
    sessionStorage.setItem('pos_is_locked', 'true');
    sessionStorage.removeItem('active_cashier_id');
  }

  public logout(): void {
    this.lockTerminal();
  }
}