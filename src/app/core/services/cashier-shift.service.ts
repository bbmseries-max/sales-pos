import { Injectable, signal, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { TenantConfigService } from './tenant-config.service';
import { Cashier, CashierShift, ShiftPaymentSummary } from '../models/market.models';

@Injectable({ providedIn: 'root' })
export class CashierShiftService {
  public currentCashier = signal<Cashier | null>(null);
  public currentShift = signal<CashierShift | null>(null);
  public isLocked = signal<boolean>(true);
  public allCashiers = signal<Cashier[]>([]);
  public tenantConfig = inject(TenantConfigService);

  /**
   * Initializes cashiers from Dexie, seeds defaults if empty, and restores active shift
   */
  public async initialize(): Promise<void> {
    let list = await marketDb.cashiers.toArray();

    if (list.length === 0) {
      const defaultCashiers: Cashier[] = [
        { id: 'CASH-01', name: 'Διαχειριστής (Admin)', pin: '1234', role: 'ADMIN', isActive: true, avatarColor: 'emerald' },
        { id: 'CASH-02', name: 'Ταμίας 1 (Μαρία)', pin: '1111', role: 'CASHIER', isActive: true, avatarColor: 'sky' },
        { id: 'CASH-03', name: 'Ταμίας 2 (Νίκος)', pin: '2222', role: 'CASHIER', isActive: true, avatarColor: 'amber' }
      ];
      await marketDb.cashiers.bulkPut(defaultCashiers);
      list = defaultCashiers;
    }

    this.allCashiers.set(list);

    // Restore last open shift if exists
    const openShift = await marketDb.shifts.where('status').equals('OPEN').last();
    if (openShift) {
      this.currentShift.set(openShift);
      const cashier = list.find(c => c.id === openShift.cashierId) || null;
      this.currentCashier.set(cashier);
      this.isLocked.set(false);
    }
  }

  // Inside CashierShiftService:

public async loadAllCashiers(): Promise<void> {
  const currentStoreId = this.tenantConfig.activeShop().id || this.tenantConfig.activeShop().code || 'SHOP-01';
  
  // 1. Fetch only employees assigned to THIS specific store
  let list = await marketDb.table('cashiers')
    .where('storeId')
    .equals(currentStoreId)
    .toArray();
  
  // 2. If this is a brand-new store with zero employees, create an Admin PIN specifically for this store
  if (!list || list.length === 0) {
    const defaultAdmin: Cashier = {
      id: `CASH-${Date.now().toString().slice(-4)}`,
      name: 'Υπεύθυνος Καταστήματος (Admin)',
      pin: '1234',
      role: 'ADMIN',
      storeId: currentStoreId,
      isActive: true
    };
    await marketDb.table('cashiers').add(defaultAdmin);
    list = [defaultAdmin];
  }
  
  this.allCashiers.set(list);
}

public async createCashier(cashier: Omit<Cashier, 'id'>): Promise<Cashier> {
  const newCashier: Cashier = {
    ...cashier,
    id: `CASH-${Date.now().toString().slice(-4)}`,
    isActive: true
  };
  
  await marketDb.table('cashiers').add(newCashier);
  await this.loadAllCashiers();
  return newCashier;
}

public async toggleCashierStatus(id: string, isActive: boolean): Promise<void> {
  await marketDb.table('cashiers').update(id, { isActive });
  await this.loadAllCashiers();
}

  /**
   * Validates PIN and opens a brand-new shift with clean 0 metrics
   */
  public async loginWithPin(pin: string, openingFloat = 100): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const cashier = this.allCashiers().find(c => c.pin === cleanPin && c.isActive);

    if (!cashier) {
      return { success: false, message: 'Λάθος PIN. Δοκιμάστε ξανά.' };
    }

    this.currentCashier.set(cashier);

    // Look ONLY for an OPEN shift belonging to this cashier
    let shift = await marketDb.shifts
      .where('cashierId').equals(cashier.id)
      .and(s => s.status === 'OPEN')
      .first();

    if (!shift) {
      // Create a FRESH shift with 0 metrics
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
        notes: '',
        sales: {
          cash: 0,
          card: 0,
          split: 0,
          totalSales: 0,
          transactionCount: 0
        }
      };

      await marketDb.shifts.add(newShift);
      shift = newShift;
    }

    this.currentShift.set(shift);
    this.isLocked.set(false);
    return { success: true, message: `Καλωσήρθατε, ${cashier.name}` };
  }

  /**
   * Records a Cash In, Cash Out, Float or Drop movement and updates the database
   */
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

    // Update totals
    if (type === 'IN' || type === 'FLOAT') {
      shift.cashInTotal = (shift.cashInTotal || 0) + Number(amount);
    } else {
      shift.cashOutTotal = (shift.cashOutTotal || 0) + Number(amount);
    }

    if (!shift.cashMovements) {
      shift.cashMovements = [];
    }
    shift.cashMovements.push(movement);

    // Save update to Dexie DB and update reactive signal
    await marketDb.shifts.put(shift);
    this.currentShift.set({ ...shift });
  }

  /**
   * Fast PIN unlock helper
   */
  public async unlockWithPin(pin: string): Promise<boolean> {
    const res = await this.loginWithPin(pin);
    return res.success;
  }

  /**
   * Locks register screen without closing the cashier's shift
   */
  public lockScreen(): void {
    this.isLocked.set(true);
  }

  /**
   * Records a sale into the active shift's metrics
   */
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

  /**
   * Calculates live expected cash in drawer
   */
  public calculateExpectedCash(shift: CashierShift): number {
    return Number((shift.openingFloat + shift.sales.cash + shift.cashInTotal - shift.cashOutTotal).toFixed(2));
  }

  /**
   * Closes the shift, checks drawer cash discrepancies, and archives
   */
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

    // 1. Update in Dexie DB
    await marketDb.shifts.put(closedShift);

    // 2. Force-clear all reactive session signals
    this.currentShift.set(null);
    this.currentCashier.set(null);
    this.isLocked.set(true);

    return closedShift;
  }
}