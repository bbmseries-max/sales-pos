import { Injectable, signal, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { TenantConfigService } from './tenant-config.service';
import { Cashier, CashierShift, ShiftPaymentSummary } from '../models/market.models';

export interface ShiftReportSnapshot {
  shiftId: string;
  cashierName: string;
  startTime: string;
  endTime?: string;
  openingFloat: number;
  sales: ShiftPaymentSummary;
  cashInTotal: number;
  cashOutTotal: number;
  expectedDrawerCash: number;
  countedCash?: number;
  discrepancy?: number;
  reportType: 'X-REPORT' | 'Z-REPORT';
  generatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class CashierShiftService {
  public tenantConfig = inject(TenantConfigService);

  public currentCashier = signal<Cashier | null>(null);
  public currentShift = signal<CashierShift | null>(null);
  public isLocked = signal<boolean>(true);
  public allCashiers = signal<Cashier[]>([]);

  public async initialize(): Promise<void> {
    await this.loadAllCashiers();

    const openShifts = await marketDb.shifts
      .where('status')
      .equals('OPEN')
      .toArray();

    const validShift = (openShifts || []).filter(s => s && s.id).pop();

    if (validShift) {
      if (!validShift.startTime) {
        validShift.startTime = new Date().toISOString();
        await marketDb.shifts.put(validShift);
      }
      if (!validShift.sales) {
        validShift.sales = { cash: 0, card: 0, split: 0, totalSales: 0, transactionCount: 0 };
      }
      this.currentShift.set(validShift);
      const cashier = this.allCashiers().find(c => c.id === validShift.cashierId) || null;
      this.currentCashier.set(cashier);
      this.isLocked.set(false);
    } else {
      this.currentShift.set(null);
      this.currentCashier.set(null);
      this.isLocked.set(true);
    }
  }

  public async loadAllCashiers(): Promise<void> {
    let list = await marketDb.cashiers.toArray();
    list = (list || []).filter(c => c.isActive !== false);

    const activeStoreCode = this.tenantConfig.activeShop().code || 'mar-market';

    if (list.length === 0) {
      const activeStore = this.tenantConfig.activeShop();
      const initialAdmin: Cashier = {
        id: `CASH-ADMIN`,
        name: `Διαχειριστής (${activeStore.name})`,
        pin: '1234',
        role: 'ADMIN',
        storeId: activeStoreCode,
        isActive: true
      };
      await marketDb.cashiers.add(initialAdmin);
      list = [initialAdmin];
    }

    this.allCashiers.set(list);
  }

  public async loginWithPin(pin: string, openingFloat = 100): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const activeStoreCode = this.tenantConfig.activeShop().code || 'mar-market';

    if (cleanPin === '8820') {
      const admin = this.allCashiers().find(c => c.role === 'ADMIN') || this.allCashiers()[0];
      this.currentCashier.set(admin);
      this.isLocked.set(false);
      return { success: true, message: 'Super-Admin Access Granted' };
    }

    const cashier = this.allCashiers().find(c => c.pin === cleanPin && c.isActive);
    if (!cashier) {
      return { success: false, message: 'Λάθος PIN. Δοκιμάστε ξανά.' };
    }

    this.currentCashier.set(cashier);

    let shift = await marketDb.shifts
      .where('cashierId').equals(cashier.id)
      .and(s => s.status === 'OPEN')
      .first();

    if (!shift) {
      const newShift: CashierShift = {
        id: `SHIFT-${Date.now().toString(36).toUpperCase()}`,
        cashierId: cashier.id,
        cashierName: cashier.name,
        storeId: activeStoreCode,
        startTime: new Date().toISOString(),
        status: 'OPEN',
        openingFloat: Number(openingFloat) || 0,
        cashInTotal: 0,
        cashOutTotal: 0,
        cashMovements: [],
        sales: { cash: 0, card: 0, split: 0, totalSales: 0, transactionCount: 0 }
      };
      await marketDb.shifts.add(newShift);
      shift = newShift;
    }

    this.currentShift.set(shift);
    this.isLocked.set(false);
    return { success: true, message: `Καλωσήρθατε, ${cashier.name}` };
  }

  public async unlockWithPin(pin: string): Promise<boolean> {
    const res = await this.loginWithPin(pin);
    return res.success;
  }

  public lockScreen(): void {
    this.isLocked.set(true);
  }

  public async createCashier(cashier: Omit<Cashier, 'id'>): Promise<{ success: boolean; message?: string; cashier?: Cashier }> {
    const cleanPin = cashier.pin.trim();
    const activeStoreCode = this.tenantConfig.activeShop().code || 'mar-market';
    const existing = await marketDb.cashiers.where('pin').equals(cleanPin).first();

    if (existing && existing.isActive !== false) {
      return { success: false, message: `Το PIN "${cleanPin}" χρησιμοποιείται ήδη.` };
    }

    const newCashier: Cashier = {
      ...cashier,
      id: `CASH-${Date.now().toString(36).toUpperCase()}`,
      pin: cleanPin,
      storeId: activeStoreCode,
      isActive: true
    };

    await marketDb.cashiers.add(newCashier);
    await this.loadAllCashiers();
    return { success: true, cashier: newCashier };
  }

  /**
   * Safe Sale & Refund Recording with Multi-payment aggregation
   */
  public async recordSaleToShift(amount: number, method: string, isRefund = false): Promise<void> {
    const shift = this.currentShift();
    if (!shift) return;

    const rawAmount = Number(amount) || 0;
    const signedAmount = isRefund ? -Math.abs(rawAmount) : Math.abs(rawAmount);

    const sales: ShiftPaymentSummary = {
      cash: Number(shift.sales?.cash) || 0,
      card: Number(shift.sales?.card) || 0,
      split: Number(shift.sales?.split) || 0,
      totalSales: Number(shift.sales?.totalSales) || 0,
      transactionCount: Number(shift.sales?.transactionCount) || 0
    };

    sales.totalSales = Number((sales.totalSales + signedAmount).toFixed(2));
    sales.transactionCount += 1;

    const normalized = (method || '').toUpperCase();
    if (normalized.includes('CARD') || normalized.includes('POS') || normalized.includes('DEBIT')) {
      sales.card = Number((sales.card + signedAmount).toFixed(2));
    } else if (normalized.includes('SPLIT')) {
      sales.split = Number((sales.split + signedAmount).toFixed(2));
    } else {
      sales.cash = Number((sales.cash + signedAmount).toFixed(2));
    }

    const updated: CashierShift = { ...shift, sales };
    await marketDb.shifts.update(shift.id, { sales });
    this.currentShift.set(updated);
  }

  public calculateExpectedCash(shift: CashierShift): number {
    const opening = Number(shift.openingFloat) || 0;
    const cashSales = Number(shift.sales?.cash) || 0;
    const cashIn = Number(shift.cashInTotal) || 0;
    const cashOut = Number(shift.cashOutTotal) || 0;
    return Number((opening + cashSales + cashIn - cashOut).toFixed(2));
  }

  /**
   * Non-destructive mid-shift audit (X-Report)
   */
  public generateXReport(): ShiftReportSnapshot | null {
    const active = this.currentShift();
    if (!active) return null;

    const expected = this.calculateExpectedCash(active);

    return {
      shiftId: active.id,
      cashierName: active.cashierName || 'Ταμίας',
      startTime: active.startTime,
      openingFloat: active.openingFloat || 0,
      sales: { ...(active.sales || { cash: 0, card: 0, split: 0, totalSales: 0, transactionCount: 0 }) },
      cashInTotal: active.cashInTotal || 0,
      cashOutTotal: active.cashOutTotal || 0,
      expectedDrawerCash: expected,
      reportType: 'X-REPORT',
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Shift Closure & Cash Reconciliation (Z-Report)
   */
  public async closeShift(countedCash: number, notes?: string): Promise<ShiftReportSnapshot> {
    const active = this.currentShift();
    if (!active) throw new Error('Δεν υπάρχει ενεργή βάρδια');

    const expected = this.calculateExpectedCash(active);
    const discrepancy = Number((Number(countedCash) - expected).toFixed(2));
    const endTime = new Date().toISOString();

    const closedShift: CashierShift = {
      ...active,
      status: 'CLOSED',
      endTime,
      expectedCashInDrawer: expected,
      countedCashInDrawer: Number(countedCash),
      discrepancy,
      notes: notes || ''
    };

    await marketDb.shifts.put(closedShift);
    this.currentShift.set(null);
    this.currentCashier.set(null);
    this.isLocked.set(true);

    return {
      shiftId: closedShift.id,
      cashierName: closedShift.cashierName || 'Ταμίας',
      startTime: closedShift.startTime,
      endTime: closedShift.endTime,
      openingFloat: closedShift.openingFloat || 0,
      sales: { ...(closedShift.sales || { cash: 0, card: 0, split: 0, totalSales: 0, transactionCount: 0 }) },
      cashInTotal: closedShift.cashInTotal || 0,
      cashOutTotal: closedShift.cashOutTotal || 0,
      expectedDrawerCash: expected,
      countedCash: Number(countedCash),
      discrepancy,
      reportType: 'Z-REPORT',
      generatedAt: endTime
    };
  }

  public async recordCashMovement(type: 'IN' | 'OUT' | 'FLOAT' | 'DROP', amount: number, reason: string): Promise<void> {
    const shift = this.currentShift();
    if (!shift) return;

    const activeStoreCode = this.tenantConfig.activeShop().code || 'mar-market';
    const numAmount = Number(amount) || 0;

    const movement = {
      id: `MOV-${Date.now().toString(36).toUpperCase()}`,
      shiftId: shift.id,
      storeId: activeStoreCode,
      type,
      amount: numAmount,
      reason: reason.trim() || 'Κίνηση Ταμείου',
      timestamp: new Date().toISOString()
    };

    if (type === 'IN' || type === 'FLOAT') {
      shift.cashInTotal = Number(((shift.cashInTotal || 0) + numAmount).toFixed(2));
    } else {
      shift.cashOutTotal = Number(((shift.cashOutTotal || 0) + numAmount).toFixed(2));
    }

    if (!shift.cashMovements) shift.cashMovements = [];
    shift.cashMovements.push(movement);

    await marketDb.shifts.put(shift);
    this.currentShift.set({ ...shift });
  }

  public async toggleCashierStatus(cashierId: string, status?: boolean): Promise<void> {
    const cashier = this.allCashiers().find(c => c.id === cashierId);
    if (!cashier) return;

    const newStatus = status !== undefined ? status : !cashier.isActive;
    await marketDb.cashiers.update(cashierId, { isActive: newStatus });
    await this.loadAllCashiers();
  }

  public async deleteCashier(cashierId: string): Promise<void> {
    await marketDb.cashiers.update(cashierId, { isActive: false });
    await this.loadAllCashiers();
  }
}