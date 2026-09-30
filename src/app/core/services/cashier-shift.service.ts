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

  public isLocked = signal<boolean>(this.checkInitialLock());
  public currentCashier = signal<Cashier | null>(this.getInitialCashier());
  public currentShift = signal<CashierShift | null>(null);
  public allCashiers = signal<Cashier[]>([]);

  public get activeShift() {
    return this.currentShift;
  }

  private checkInitialLock(): boolean {
    return sessionStorage.getItem('pos_is_locked') !== 'false';
  }

  private getInitialCashier(): Cashier | null {
    const raw = sessionStorage.getItem('active_cashier_data');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Cashier;
        const currentStore = this.tenantConfig.activeShop()?.code;
        // Invalidate cached cashier if store was switched
        if (parsed.storeId && currentStore && parsed.storeId !== currentStore) {
          sessionStorage.removeItem('active_cashier_data');
          return null;
        }
        return parsed;
      } catch (e) {
        console.error('[CashierShiftService] Failed parsing cached cashier', e);
      }
    }
    return null;
  }

  public async initialize(): Promise<void> {
    await this.loadAllCashiers();

    const cashier = this.currentCashier() || this.getInitialCashier();
    const isUnlocked = !this.checkInitialLock();

    if (cashier && isUnlocked && cashier.storeId === this.tenantConfig.activeShop().code) {
      this.currentCashier.set(cashier);
      this.isLocked.set(false);
      await this.ensureActiveShiftForCashier(cashier);
      return;
    }

    this.lockTerminal();
  }

  /**
   * Loads cashiers strictly scoped to activeShop
   */
  public async loadAllCashiers(): Promise<void> {
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || 'mar-market';

    const all = await marketDb.cashiers.toArray();
    let scopedList = (all || []).filter(c => 
      c.isActive !== false && (c.storeId === activeShopCode || !c.storeId)
    );

    // Auto-seed initial store admin only if no cashiers exist for THIS store
    if (scopedList.length === 0) {
      const initialAdminPin = activeShop.adminPin || '1234';

      const initialAdmin: Cashier = {
        id: `CASH-${activeShopCode.toUpperCase()}-01`,
        name: `Υπεύθυνος (${activeShop.name})`,
        pin: initialAdminPin,
        role: 'ADMIN',
        storeId: activeShopCode,
        isActive: true
      };

      await marketDb.cashiers.put(initialAdmin);
      scopedList = [initialAdmin];
    }

    this.allCashiers.set(scopedList);
  }

  /**
   * Retrieves or creates an active shift for the cashier without hardcoded float overwrites
   */
  public async ensureActiveShiftForCashier(cashier: Cashier, floatAmount?: number): Promise<CashierShift> {
    const activeShopCode = this.tenantConfig.activeShop()?.code || cashier.storeId || 'mar-market';

    let shift = await marketDb.shifts
      .where('cashierId').equals(cashier.id)
      .and(s => s.status === 'OPEN' && s.storeId === activeShopCode)
      .first();

    if (!shift) {
      const resolvedFloat = typeof floatAmount === 'number' ? floatAmount : 0;

      shift = {
        id: `SHIFT-${Date.now().toString(36).toUpperCase()}`,
        cashierId: cashier.id,
        cashierName: cashier.name,
        storeId: activeShopCode,
        startTime: new Date().toISOString(),
        status: 'OPEN',
        openingFloat: resolvedFloat,
        cashInTotal: 0,
        cashOutTotal: 0,
        cashMovements: [],
        sales: { cash: 0, card: 0, split: 0, totalSales: 0, transactionCount: 0 }
      };
      await marketDb.shifts.add(shift);
    }

    this.currentShift.set(shift);
    return shift;
  }

  /**
   * Direct login validation scoped to active store
   */
  /**
   * Direct login validation scoped to active store
   */
  public async loginWithPin(pin: string, openingFloat?: number): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || 'mar-market';

    // 1. Super-Admin Check (8820)
    if (cleanPin === '8820') {
      const superAdminCashier: Cashier = {
        id: 'SUPER-ADMIN',
        name: 'Super Admin',
        pin: '8820',
        role: 'ADMIN',
        storeId: activeShopCode,
        isActive: true
      };
      await this.setAuthenticatedCashier(superAdminCashier, openingFloat);
      return { success: true, message: 'Super-Admin Access Granted' };
    }

    await this.loadAllCashiers();

    // 2. First look for an existing cashier in Dexie with this PIN
    let cashier = this.allCashiers().find(c => 
      c.pin === cleanPin && 
      c.isActive !== false &&
      (c.storeId === activeShopCode || !c.storeId)
    );

    // 3. Fallback: If cleanPin matches the store's configured adminPin (e.g. 2435)
    // but isn't yet saved in Dexie, automatically generate/sync the Admin cashier!
    if (!cashier && activeShop.adminPin && cleanPin === activeShop.adminPin.trim()) {
      cashier = {
        id: `CASH-${activeShopCode.toUpperCase()}-ADMIN`,
        name: `Υπεύθυνος (${activeShop.name})`,
        pin: cleanPin,
        role: 'ADMIN',
        storeId: activeShopCode,
        isActive: true
      };

      await marketDb.cashiers.put(cashier);
      await this.loadAllCashiers();
    }

    if (!cashier) {
      return { success: false, message: 'Λάθος PIN. Δοκιμάστε ξανά.' };
    }

    await this.setAuthenticatedCashier(cashier, openingFloat);
    return { success: true, message: `Καλωσήρθατε, ${cashier.name}` };
  }

  public async unlockWithPin(pin: string): Promise<boolean> {
    const res = await this.loginWithPin(pin);
    return res.success;
  }

  public async setAuthenticatedCashier(cashier: Cashier, floatAmount?: number): Promise<void> {
    this.currentCashier.set(cashier);
    this.isLocked.set(false);
    sessionStorage.setItem('pos_is_locked', 'false');
    sessionStorage.setItem('active_cashier_data', JSON.stringify(cashier));
    await this.ensureActiveShiftForCashier(cashier, floatAmount);
  }

  public lockScreen(): void {
    this.isLocked.set(true);
    sessionStorage.setItem('pos_is_locked', 'true');
  }

  public lockTerminal(): void {
    this.currentCashier.set(null);
    this.currentShift.set(null);
    this.isLocked.set(true);
    sessionStorage.setItem('pos_is_locked', 'true');
    sessionStorage.removeItem('active_cashier_data');
  }

  public logout(): void {
    this.lockTerminal();
  }

  public calculateExpectedCash(shift: CashierShift): number {
    const opening = Number(shift.openingFloat) || 0;
    const cashSales = Number(shift.sales?.cash) || 0;
    const cashIn = Number(shift.cashInTotal) || 0;
    const cashOut = Number(shift.cashOutTotal) || 0;
    return Number((opening + cashSales + cashIn - cashOut).toFixed(2));
  }

  public async recordSaleToShift(amount: number, method: string, isRefund = false): Promise<void> {
    let shift = this.currentShift();
    if (!shift && this.currentCashier()) {
      shift = await this.ensureActiveShiftForCashier(this.currentCashier()!);
    }
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
    await marketDb.shifts.put(updated);
    this.currentShift.set(updated);
  }

  public async closeShift(countedCash: number, notes?: string): Promise<ShiftReportSnapshot> {
    const active = this.currentShift();
    if (!active) throw new Error('Δεν υπάρχει ενεργή βάρδια.');

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
    let shift = this.currentShift();
    if (!shift && this.currentCashier()) {
      shift = await this.ensureActiveShiftForCashier(this.currentCashier()!);
    }
    if (!shift) return;

    const activeShopCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    const numAmount = Number(amount) || 0;

    const movement = {
      id: `MOV-${Date.now().toString(36).toUpperCase()}`,
      shiftId: shift.id,
      storeId: activeShopCode,
      type,
      amount: numAmount,
      reason: reason.trim() || 'Κίνηση Ταμείου',
      timestamp: new Date().toISOString()
    };

    const updated: CashierShift = { ...shift };
    if (type === 'IN' || type === 'FLOAT') {
      updated.cashInTotal = Number(((updated.cashInTotal || 0) + numAmount).toFixed(2));
    } else {
      updated.cashOutTotal = Number(((updated.cashOutTotal || 0) + numAmount).toFixed(2));
    }

    updated.cashMovements = [...(updated.cashMovements || []), movement];

    await marketDb.shifts.put(updated);
    this.currentShift.set(updated);
  }

  public async createCashier(data: Omit<Cashier, 'id'>): Promise<{ success: boolean; message: string; cashier?: Cashier }> {
    const cleanPin = data.pin.trim();
    const activeShopCode = this.tenantConfig.activeShop()?.code || 'mar-market';

    if (cleanPin === '8820') {
      return { success: false, message: 'Το PIN 8820 είναι δεσμευμένο για τον Super Admin.' };
    }

    await this.loadAllCashiers();
    const duplicate = this.allCashiers().find(c => c.pin === cleanPin);
    if (duplicate) {
      return { success: false, message: `Το PIN "${cleanPin}" χρησιμοποιείται ήδη από "${duplicate.name}".` };
    }

    const newCashier: Cashier = {
      id: `cashier_${Date.now()}`,
      ...data,
      storeId: data.storeId || activeShopCode,
      pin: cleanPin
    };

    await marketDb.cashiers.put(newCashier);
    await this.loadAllCashiers();
    return { success: true, message: 'Ο χρήστης δημιουργήθηκε επιτυχώς.', cashier: newCashier };
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