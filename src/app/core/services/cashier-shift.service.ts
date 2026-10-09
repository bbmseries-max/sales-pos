import { Injectable, signal, inject, computed } from '@angular/core';
import { marketDb } from '../db/market-db';
import { ZReportAudit } from '../models/z-report.model';
import { sha256Pin } from '../utils/crypto.utils';
import { MarketCompanyProfile } from '../models';
import { TenantConfigService } from './tenant-config.service';
import { Cashier, CashierShift, ShiftPaymentSummary } from '../models/market.models';
import {
  calculateExpectedShiftCash,
  computeUpdatedShiftSales,
  aggregateShiftTransactions,
  LiveShiftAuditResult
} from '../utils/shift-calculator.util';
import { renderAndPrintXReport } from '../utils/shift-report-formatter.util';

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

export type PosTerminalState = 'LOCKED' | 'SHIFT_REQUIRED' | 'ACTIVE';

@Injectable({ providedIn: 'root' })
export class CashierShiftService {
  public tenantConfig = inject(TenantConfigService);

  public isLocked = signal<boolean>(this.checkInitialLock());
  public currentCashier = signal<Cashier | null>(this.getInitialCashier());
  public currentShift = signal<CashierShift | null>(null);
  public allCashiers = signal<Cashier[]>([]);

  public isAdmin = computed(() => this.currentCashier()?.role === 'ADMIN');
  public isSimpleCashier = computed(() => {
    const c = this.currentCashier();
    return c !== null && c.role !== 'ADMIN';
  });

  public terminalState = computed<PosTerminalState>(() => {
    if (!this.currentCashier() || this.isLocked()) return 'LOCKED';
    if (!this.currentShift() || this.currentShift()?.status !== 'OPEN') return 'SHIFT_REQUIRED';
    return 'ACTIVE';
  });

  public get activeShift() {
    return this.currentShift;
  }

  private checkInitialLock(): boolean {
    return sessionStorage.getItem('pos_is_locked') !== 'false';
  }

  private getInitialCashier(): Cashier | null {
    const raw = sessionStorage.getItem('active_cashier_data');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Cashier;
      const currentStore = this.tenantConfig.activeShop()?.code;
      if (parsed.storeId && currentStore && parsed.storeId !== currentStore) {
        sessionStorage.removeItem('active_cashier_data');
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  public async initialize(): Promise<void> {
    await this.loadAllCashiers();
    const activeStore = this.tenantConfig.activeShop()?.code || 'mar-market';
    const cashier = this.getInitialCashier();
    const isUnlocked = sessionStorage.getItem('pos_is_locked') === 'false';

    if (cashier && isUnlocked && cashier.storeId === activeStore) {
      this.currentCashier.set(cashier);
      this.isLocked.set(false);
      await this.ensureActiveShiftForCashier(cashier);
      return;
    }
    this.lockTerminal();
  }

  public async loadAllCashiers(): Promise<void> {
    const activeShopCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    const all = await marketDb.cashiers.toArray();
    this.allCashiers.set((all || []).filter(c => c.isActive !== false && c.storeId === activeShopCode));
  }

  public async ensureActiveShiftForCashier(cashier: Cashier, floatAmount?: number): Promise<CashierShift> {
    const activeShopCode = this.tenantConfig.activeShop()?.code || cashier.storeId || 'mar-market';

    const existingShift = await marketDb.shifts
      .where('cashierId').equals(cashier.id)
      .and(s => s.status === 'OPEN' && s.storeId === activeShopCode)
      .first();

    let activeShift: CashierShift;

    if (!existingShift) {
      const resolvedFloat = typeof floatAmount === 'number'
        ? floatAmount
        : (this.tenantConfig.activeShop()?.defaultFloat ?? 0);

      activeShift = {
        id: `SHIFT-${Date.now().toString(36).toUpperCase()}`,
        registerId: this.tenantConfig.activeShop()?.registerId || 'POS-01',
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

      await marketDb.shifts.put(activeShift);
    } else {
      activeShift = existingShift;
      if (typeof floatAmount === 'number' && activeShift.openingFloat !== floatAmount) {
        activeShift.openingFloat = floatAmount;
        await marketDb.shifts.put(activeShift);
      }
    }

    this.currentShift.set(activeShift);
    return activeShift;
  }

  public async loginWithPin(pin: string, openingFloat?: number): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || 'mar-market';

    if (!activeShop || activeShop.isActive === false) {
      this.lockTerminal();
      return { success: false, message: 'Το κατάστημα έχει απενεργοποιηθεί. Επικοινωνήστε με τη Maranth Market.' };
    }
    if (!cleanPin) return { success: false, message: 'Παρακαλώ εισάγετε PIN.' };

    await this.loadAllCashiers();
    let cashier = this.allCashiers().find(c => c.pin === cleanPin && c.isActive !== false && c.storeId === activeShopCode);

    const inputHash = await sha256Pin(cleanPin, activeShop.adminPinSalt || activeShopCode);
    const isAdminPinMatch = Boolean(activeShop.adminPinHash && inputHash === activeShop.adminPinHash);

    if (isAdminPinMatch) {
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

    if (!cashier) return { success: false, message: 'Λάθος PIN. Δοκιμάστε ξανά.' };

    await this.setAuthenticatedCashier(cashier, openingFloat);
    return { success: true, message: `Καλωσήρθατε, ${cashier.name}` };
  }

  public async loginCashierById(cashierId: string, pin: string, openingFloat = 0): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || 'mar-market';

    await this.loadAllCashiers();
    const cashier = this.allCashiers().find(c => c.id === cashierId && c.storeId === activeShopCode);
    if (!cashier) return { success: false, message: 'Ο επιλεγμένος ταμίας δεν βρέθηκε στο κατάστημα.' };

    const isPinMatch = cashier.pin === cleanPin;
    const inputHash = await sha256Pin(cleanPin, activeShop?.adminPinSalt || activeShopCode);
    const isAdminOverride = Boolean(activeShop?.adminPinHash && inputHash === activeShop.adminPinHash);

    if (!isPinMatch && !isAdminOverride) {
      return { success: false, message: 'Λανθασμένο PIN για τον συγκεκριμένο ταμία.' };
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
    return calculateExpectedShiftCash(shift);
  }

  public async recordSaleToShift(
    amount: number,
    method: string,
    isRefund = false,
    splitDetails?: { cash: number; card: number }
  ): Promise<void> {
    let shift = this.currentShift();
    if (!shift && this.currentCashier()) {
      shift = await this.ensureActiveShiftForCashier(this.currentCashier()!);
    }
    if (!shift) return;

    const sales = computeUpdatedShiftSales(shift.sales, amount, method, isRefund, splitDetails);
    const updated: CashierShift = { ...shift, sales };
    await marketDb.shifts.put(updated);
    this.currentShift.set(updated);
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

  public async closeShift(countedCash: number, notes?: string, zNumber = 1): Promise<ZReportAudit> {
    const active = this.currentShift();
    if (!active) throw new Error('Δεν υπάρχει ενεργή βάρδια.');

    const freshShift = (await marketDb.shifts.get(active.id)) || active;
    const expected = this.calculateExpectedCash(freshShift);
    const counted = Number(countedCash) || 0;
    const variance = Number((counted - expected).toFixed(2));
    const endTime = new Date().toISOString();

    const closedShift: CashierShift = {
      ...freshShift,
      status: 'CLOSED',
      endTime,
      expectedCash: expected,
      expectedCashInDrawer: expected,
      countedCash: counted,
      countedCashInDrawer: counted,
      actualCountedCash: counted,
      discrepancy: variance,
      closedBy: 'SYSTEM_Z',
      notes: notes || ''
    };

    await marketDb.shifts.put(closedShift);
    this.currentShift.set(null);
    this.lockTerminal();

    const sales = freshShift.sales || { cash: 0, card: 0, split: 0, debit: 0, totalSales: 0, transactionCount: 0 };
    const gross = Number(sales.totalSales) || 0;
    const net = parseFloat((gross / 1.13).toFixed(2));
    const tax = parseFloat((gross - net).toFixed(2));

    return {
      id: `Z-${Date.now().toString(36).toUpperCase()}`,
      zNumber,
      date: endTime.split('T')[0],
      openedAt: freshShift.startTime,
      closedAt: endTime,
      cashierName: freshShift.cashierName || 'Ταμίας',
      registerId: freshShift.registerId || 'POS-01',
      transactionCount: sales.transactionCount || 0,
      refundCount: 0,
      refundTotal: 0,
      grossTurnover: gross,
      netTurnover: net,
      totalTax: tax,
      progressiveGrandTotal: gross,
      salesCash: Number(sales.cash) || 0,
      salesCard: Number(sales.card) || 0,
      salesOther: Number(sales.debit || 0),
      openingFloat: Number(freshShift.openingFloat) || 0,
      cashIn: Number(freshShift.cashInTotal) || 0,
      cashOut: Number(freshShift.cashOutTotal) || 0,
      expectedDrawerCash: expected,
      actualCountedCash: counted,
      variance,
      vatAnalysis: { '13%': { rate: 13, net, vat: tax, gross } },
      status: 'CLOSED'
    };
  }

  public async getActiveStoreShifts(): Promise<CashierShift[]> {
    const storeCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    return await marketDb.shifts
      .where('storeId')
      .equals(storeCode)
      .and(s => s.status === 'OPEN')
      .toArray();
  }

  public getShiftDurationFormatted(startTimeIso: string, endTimeIso?: string): string {
    const start = new Date(startTimeIso).getTime();
    const end = endTimeIso ? new Date(endTimeIso).getTime() : Date.now();
    const totalMinutes = Math.floor(Math.max(0, end - start) / 60000);
    return `${Math.floor(totalMinutes / 60)}ω ${totalMinutes % 60}λ`;
  }

  public async forceCloseShift(shiftId: number | string, managerReason = 'Βίαιο κλείσιμο από Διαχειριστή'): Promise<void> {
    if (!this.isAdmin()) throw new Error('Μόνο ο διαχειριστής έχει δικαίωμα εξαναγκαστικού κλεισίματος.');
    const shift = await marketDb.shifts.get(shiftId as any);
    if (!shift) throw new Error('Η βάρδια δεν βρέθηκε.');

    const now = new Date().toISOString();
    const start = new Date(shift.startTime).getTime();
    const durationMinutes = Math.floor((new Date(now).getTime() - start) / 60000);
    const expected = (shift.openingFloat || 0) + (shift.sales?.cash || 0);

    await marketDb.shifts.update(shiftId as any, {
      status: 'CLOSED',
      endTime: now,
      durationMinutes,
      expectedCash: expected,
      actualCountedCash: expected,
      discrepancy: 0,
      closedBy: 'MANAGER_FORCE',
      notes: managerReason
    });

    if (this.currentShift()?.id === shiftId) {
      this.currentShift.set(null);
      this.lockTerminal();
    }
  }

  public async createCashier(data: Omit<Cashier, 'id'>): Promise<{ success: boolean; message: string; cashier?: Cashier }> {
    const cleanPin = data.pin.trim();
    const activeShopCode = this.tenantConfig.activeShop()?.code || 'mar-market';

    await this.loadAllCashiers();
    const duplicate = this.allCashiers().find(c => c.pin === cleanPin && c.storeId === activeShopCode);
    if (duplicate) {
      return { success: false, message: `Το PIN "${cleanPin}" χρησιμοποιείται ήδη από "${duplicate.name}".` };
    }

    const newCashier: Cashier = { id: `cashier_${Date.now()}`, ...data, storeId: activeShopCode, pin: cleanPin };
    await marketDb.cashiers.put(newCashier);
    await this.loadAllCashiers();
    return { success: true, message: 'Ο χρήστης δημιουργήθηκε επιτυχώς.', cashier: newCashier };
  }

  public async toggleCashierStatus(cashierId: string, status?: boolean): Promise<void> {
    const cashier = this.allCashiers().find(c => c.id === cashierId);
    if (!cashier) return;
    await marketDb.cashiers.update(cashierId, { isActive: status !== undefined ? status : !cashier.isActive });
    await this.loadAllCashiers();
  }

  public async deleteCashier(cashierId: string): Promise<void> {
    await marketDb.cashiers.update(cashierId, { isActive: false });
    await this.loadAllCashiers();
  }

  public async calculateLiveShiftAudit(): Promise<LiveShiftAuditResult> {
    const shift = this.currentShift();
    if (!shift) throw new Error('Δεν υπάρχει ενεργή βάρδια.');

    const allTx = await marketDb.transactions.toArray();
    return aggregateShiftTransactions(
      shift,
      allTx,
      this.currentCashier()?.name || 'Ταμίας',
      this.currentCashier()?.role || 'CASHIER'
    );
  }

  public openBrowserXReportPreview(data: any, company: MarketCompanyProfile): void {
    renderAndPrintXReport(data, company);
  }
}