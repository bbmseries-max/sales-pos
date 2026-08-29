import { Injectable, signal, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { TenantConfigService } from './tenant-config.service';
import { Cashier, CashierShift, ShiftPaymentSummary } from '../models/market.models';

@Injectable({ providedIn: 'root' })
export class CashierShiftService {
  public tenantConfig = inject(TenantConfigService);

  public currentCashier = signal<Cashier | null>(null);
  public currentShift = signal<CashierShift | null>(null);
  public isLocked = signal<boolean>(true);
  public allCashiers = signal<Cashier[]>([]);

  public async initialize(): Promise<void> {
    await this.loadAllCashiers();

    // Check for active open shift in this store's DB
    const openShift = await marketDb.shifts
      .where('status')
      .equals('OPEN')
      .last();

    if (openShift) {
      if (!openShift.startTime) {
        openShift.startTime = new Date().toISOString();
        await marketDb.shifts.put(openShift);
      }
      this.currentShift.set(openShift);
      const cashier = this.allCashiers().find(c => c.id === openShift.cashierId) || null;
      this.currentCashier.set(cashier);
      this.isLocked.set(false);
    }
  }

  public async loadAllCashiers(): Promise<void> {
    let list = await marketDb.cashiers.toArray();
    list = (list || []).filter(c => c.isActive !== false);

    // Bootstrap default admin if store DB is fresh
    if (list.length === 0) {
      const activeStore = this.tenantConfig.activeShop();
      const initialAdmin: Cashier = {
        id: `CASH-ADMIN`,
        name: `Διαχειριστής (${activeStore.name})`,
        pin: '1234',
        role: 'ADMIN',
        isActive: true
      };
      await marketDb.cashiers.add(initialAdmin);
      list = [initialAdmin];
    }

    this.allCashiers.set(list);
  }

  public async loginWithPin(pin: string, openingFloat = 100): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();

    // Emergency Master Key 8820
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
        id: `SHIFT-${Date.now().toString().slice(-6)}`,
        cashierId: cashier.id,
        cashierName: cashier.name,
        startTime: new Date().toISOString(),
        status: 'OPEN',
        openingFloat: Number(openingFloat),
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
    const existing = await marketDb.cashiers.where('pin').equals(cleanPin).first();

    if (existing && existing.isActive !== false) {
      return { success: false, message: `Το PIN "${cleanPin}" χρησιμοποιείται ήδη.` };
    }

    const newCashier: Cashier = {
      ...cashier,
      id: `CASH-${Date.now().toString().slice(-4)}`,
      pin: cleanPin,
      isActive: true
    };

    await marketDb.cashiers.add(newCashier);
    await this.loadAllCashiers();
    return { success: true, cashier: newCashier };
  }

  public async recordSaleToShift(amount: number, method: 'Cash' | 'Card' | 'Split'): Promise<void> {
    const shift = this.currentShift();
    if (!shift) return;

    const sales: ShiftPaymentSummary = { ...shift.sales };
    sales.totalSales = Number((sales.totalSales + amount).toFixed(2));
    sales.transactionCount += 1;

    if (method === 'Cash') sales.cash = Number((sales.cash + amount).toFixed(2));
    else if (method === 'Card') sales.card = Number((sales.card + amount).toFixed(2));
    else if (method === 'Split') sales.split = Number((sales.split + amount).toFixed(2));

    const updated = { ...shift, sales };
    await marketDb.shifts.update(shift.id, { sales });
    this.currentShift.set(updated);
  }

  public calculateExpectedCash(shift: CashierShift): number {
    return Number((shift.openingFloat + shift.sales.cash + shift.cashInTotal - shift.cashOutTotal).toFixed(2));
  }

  public async closeShift(countedCash: number, notes?: string): Promise<CashierShift> {
    const active = this.currentShift();
    if (!active) throw new Error('Δεν υπάρχει ενεργή βάρδια');

    const expected = this.calculateExpectedCash(active);
    const discrepancy = Number((Number(countedCash) - expected).toFixed(2));

    const closedShift: CashierShift = {
      ...active,
      status: 'CLOSED',
      endTime: new Date().toISOString(),
      expectedCashInDrawer: expected,
      countedCashInDrawer: Number(countedCash),
      discrepancy,
      notes: notes || ''
    };

    await marketDb.shifts.put(closedShift);
    this.currentShift.set(null);
    this.currentCashier.set(null);
    this.isLocked.set(true);

    return closedShift;
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

  public async recordCashMovement(type: 'IN' | 'OUT' | 'FLOAT' | 'DROP', amount: number, reason: string): Promise<void> {
    const shift = this.currentShift();
    if (!shift) return;

    const movement = {
      id: `MOV-${Date.now().toString().slice(-6)}`,
      shiftId: shift.id,
      type,
      amount: Number(amount),
      reason: reason.trim() || 'Κίνηση Ταμείου',
      timestamp: new Date().toISOString()
    };

    if (type === 'IN' || type === 'FLOAT') {
      shift.cashInTotal = (shift.cashInTotal || 0) + Number(amount);
    } else {
      shift.cashOutTotal = (shift.cashOutTotal || 0) + Number(amount);
    }

    if (!shift.cashMovements) shift.cashMovements = [];
    shift.cashMovements.push(movement);

    await marketDb.shifts.put(shift);
    this.currentShift.set({ ...shift });
  }
}