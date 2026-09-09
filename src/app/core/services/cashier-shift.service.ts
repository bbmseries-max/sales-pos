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
  public isLocked = signal<boolean>(this.checkInitialLock());
  public tenantConfig = inject(TenantConfigService);

  public currentCashier = signal<Cashier | null>(null);
  public currentShift = signal<CashierShift | null>(null);
  public allCashiers = signal<Cashier[]>([]);

  public activeShift = signal<CashierShift | null>(null);
  
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
    } else {
      this.currentShift.set(null);
    }

    // Always enforce the lock screen on initial startup/refresh
    this.currentCashier.set(null);
    this.isLocked.set(true);
  }

  private checkInitialLock(): boolean {
    const locked = sessionStorage.getItem('pos_is_locked');
    return locked !== 'false'; // Defaults to locked on cold start / refresh
  }

  public setCountedCash(amount: number): void {
    const current = this.activeShift();
    if (current) {
      this.activeShift.set({
        ...current,
        countedCashInDrawer: amount,
        countedCash: amount
      });
    }
  }


  public async loadAllCashiers(): Promise<void> {
  let list = await marketDb.cashiers.toArray();
  list = (list || []).filter(c => c.isActive !== false);

  const activeStore = this.tenantConfig.activeStore();
  const activeStoreCode = activeStore.code || 'mar-market';

  if (list.length === 0) {
    // Dynamically assign the store-specific PIN
    const storePin = (activeStore as any).adminPin || (
      activeStoreCode === 'ftest' ? '1111' :
      activeStoreCode === 'parnasos' ? '3333' : '2222'
    );

    const initialAdmin: Cashier = {
      id: `CASH-ADMIN-${activeStoreCode.toUpperCase()}`,
      name: `Διαχειριστής (${activeStore.name})`,
      pin: storePin,
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
    const activeStoreCode = this.tenantConfig.activeStore().code || 'mar-market';

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
    const cleanPin = pin.trim();

    // 1. Super-Admin PIN (8820) Override
    if (cleanPin === '8820') {
      const superAdminCashier: Cashier = {
        id: 'SUPER-ADMIN',
        name: 'Super Admin',
        pin: '8820',
        role: 'ADMIN',
        storeId: this.tenantConfig.activeStore()?.code || 'ftest',
        isActive: true
      };
      this.setAuthenticatedCashier(superAdminCashier);
      return true;
    }

    // 2. Tenant Store Routing / Admin PIN
    const storeAuth = this.tenantConfig.resolveAndSwitchByPin(cleanPin);
    if (storeAuth.success) {
      // If store changed, resolveAndSwitchByPin reloaded the page.
      // If store was already active, authenticate as store admin:
      await this.loadAllCashiers();
      const admin = this.allCashiers().find(c => c.pin === cleanPin || c.role === 'ADMIN') || {
        id: `ADMIN-${cleanPin}`,
        name: `Διαχειριστής (${this.tenantConfig.activeStore().name})`,
        pin: cleanPin,
        role: 'ADMIN',
        storeId: this.tenantConfig.activeStore().code,
        isActive: true
      };
      this.setAuthenticatedCashier(admin as Cashier);
      return true;
    }

    // 3. Regular Cashier PIN lookup in active Dexie database
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

  public lockScreen(): void {
    this.isLocked.set(true);
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

  public async createCashier(cashier: Omit<Cashier, 'id'>): Promise<{ success: boolean; message?: string; cashier?: Cashier }> {
    const cleanPin = cashier.pin.trim();
    const activeStoreCode = this.tenantConfig.activeStore().code || 'mar-market';
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

    const activeStoreCode = this.tenantConfig.activeStore().code || 'mar-market';
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