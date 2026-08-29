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

  /**
   * Initializes store-scoped cashiers and restores open shift strictly for the active store
   */
  // Inside initialize()
public async initialize(): Promise<void> {
  const currentStore = this.tenantConfig.activeShop();
  const currentStoreId = currentStore.code || 'mar-market';

  await this.loadAllCashiers();

  this.currentCashier.set(null);
  this.currentShift.set(null);
  this.isLocked.set(true);

  try {
    const openShifts = await marketDb.shifts
      .where('status')
      .equals('OPEN')
      .toArray();

    // Guard against corrupted/undefined shift records
    const validShifts = (openShifts || []).filter(s => !!s && typeof s === 'object');

    const openShift = validShifts.find(s => {
      const shiftStore = (s as any).storeId || (s.notes?.includes('Store: ') ? s.notes.split('Store: ')[1]?.trim() : 'mar-market');
      return shiftStore === currentStoreId;
    });

    if (openShift) {
      // Ensure startTime exists to prevent Dexie Observable crashes
      if (!openShift.startTime) {
        openShift.startTime = new Date().toISOString();
        await marketDb.shifts.put(openShift);
      }

      const cashier = this.allCashiers().find(c => c.id === openShift.cashierId) || null;
      if (cashier) {
        this.currentShift.set(openShift);
        this.currentCashier.set(cashier);
        this.isLocked.set(false);
      }
    }
  } catch (err) {
    console.warn('[CashierShiftService] Error restoring open shift:', err);
  }
}

  /**
   * Loads cashiers strictly belonging to the active store and bootstraps Admin if empty
   */
  public async loadAllCashiers(): Promise<void> {
    const currentStore = this.tenantConfig.activeShop();
    const currentStoreId = currentStore.code || 'mar-market';

    let list = await marketDb.table('cashiers')
      .where('storeId')
      .equals(currentStoreId)
      .toArray();

    // Filter only active records
    list = (list || []).filter((c: Cashier) => c.isActive !== false);

    // If a new store has 0 users, create its initial isolated admin
    if (list.length === 0) {
      const initialStoreAdmin: Cashier = {
        id: `CASH-${currentStoreId}-ADMIN`,
        name: `Διαχειριστής (${currentStore.name})`,
        pin: '1234',
        role: 'ADMIN',
        storeId: currentStoreId,
        isActive: true
      };

      await marketDb.table('cashiers').add(initialStoreAdmin);
      list = [initialStoreAdmin];
    }

    this.allCashiers.set(list);
  }

  public async createCashier(cashier: Omit<Cashier, 'id'>): Promise<{ success: boolean; message?: string; cashier?: Cashier }> {
    const targetStore = cashier.storeId || this.tenantConfig.activeShop().code || 'mar-market';
    const cleanPin = cashier.pin.trim();

    // 1. Check if PIN is already taken in THIS store
    const existing = await marketDb.table('cashiers')
      .where('storeId')
      .equals(targetStore)
      .and((c: Cashier) => c.pin === cleanPin && c.isActive !== false)
      .first();

    if (existing) {
      return { 
        success: false, 
        message: `Το PIN "${cleanPin}" χρησιμοποιείται ήδη από τον χρήστη "${existing.name}". Επιλέξτε άλλο PIN.` 
      };
    }

    // 2. Insert new record
    const newCashier: Cashier = {
      ...cashier,
      id: `CASH-${Date.now().toString().slice(-4)}`,
      pin: cleanPin,
      storeId: targetStore,
      isActive: true
    };

    await marketDb.table('cashiers').add(newCashier);
    await this.loadAllCashiers();
    
    return { success: true, cashier: newCashier };
  }

  public async toggleCashierStatus(id: string, isActive: boolean): Promise<void> {
    await marketDb.table('cashiers').update(id, { isActive });
    await this.loadAllCashiers();
  }

  /**
   * Validates PIN and opens or resumes a shift for this cashier & store
   */
  public async loginWithPin(pin: string, openingFloat = 100): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const currentStoreId = this.tenantConfig.activeShop().code || 'mar-market';

    // Must match PIN AND belong to THIS active store
    const cashier = this.allCashiers().find(c => c.pin === cleanPin && c.isActive && c.storeId === currentStoreId);

    if (!cashier) {
      return { success: false, message: 'Λάθος PIN για αυτό το κατάστημα. Δοκιμάστε ξανά.' };
    }

    this.currentCashier.set(cashier);

    // Look ONLY for an OPEN shift belonging to this cashier
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
        notes: `Store: ${currentStoreId}`,
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

    if (!shift.cashMovements) {
      shift.cashMovements = [];
    }
    shift.cashMovements.push(movement);

    await marketDb.shifts.put(shift);
    this.currentShift.set({ ...shift });
  }

  public async unlockWithPin(pin: string): Promise<boolean> {
    const res = await this.loginWithPin(pin);
    return res.success;
  }

  public lockScreen(): void {
    this.isLocked.set(true);
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
}