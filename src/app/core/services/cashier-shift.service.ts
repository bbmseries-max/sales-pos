import { Injectable, signal, inject, computed } from '@angular/core';
import { marketDb } from '../db/market-db';
import { ZReportAudit } from '../models/z-report.model';
import { sha256Pin } from '../utils/crypto.utils';
import { MarketCompanyProfile, TransactionRecord } from '../models';
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

export type PosTerminalState = 'LOCKED' | 'SHIFT_REQUIRED' | 'ACTIVE';

@Injectable({ providedIn: 'root' })
export class CashierShiftService {
  public tenantConfig = inject(TenantConfigService);

  public isLocked = signal<boolean>(this.checkInitialLock());
  public currentCashier = signal<Cashier | null>(this.getInitialCashier());
  public currentShift = signal<CashierShift | null>(null);
  public allCashiers = signal<Cashier[]>([]);
  

  // Role verification signals
  public isAdmin = computed(() => {
    const cashier = this.currentCashier();
    return cashier?.role === 'ADMIN';
  });

  public async closeShift(countedCash: number, notes?: string, zNumber = 1): Promise<ZReportAudit> {
  const active = this.currentShift();
  if (!active) throw new Error('Δεν υπάρχει ενεργή βάρδια.');

  // Fetch latest persistent state from Dexie
  const freshShift = await marketDb.shifts.get(active.id) || active;

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

  const sales = freshShift.sales || {
    cash: 0,
    card: 0,
    split: 0,
    debit: 0,
    totalSales: 0,
    transactionCount: 0
  };

  const gross = Number(sales.totalSales) || 0;
  const net = parseFloat((gross / 1.13).toFixed(2));
  const tax = parseFloat((gross - net).toFixed(2));

  // Construct direct ZReportAudit matching your model
  const auditRecord: ZReportAudit = {
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
    variance: variance,

    vatAnalysis: {
      '13%': {
        rate: 13,
        net: net,
        vat: tax,
        gross: gross
      }
    },
    status: 'CLOSED'
  };

  return auditRecord;
}

  // 1. Get all active shifts in the active store
  public async getActiveStoreShifts(): Promise<CashierShift[]> {
    const storeCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    return await marketDb.shifts
      .where('storeId')
      .equals(storeCode)
      .and(s => s.status === 'OPEN')
      .toArray();
  }

  // 2. Calculate duration in minutes or readable format
  public getShiftDurationFormatted(startTimeIso: string, endTimeIso?: string): string {
    const start = new Date(startTimeIso).getTime();
    const end = endTimeIso ? new Date(endTimeIso).getTime() : Date.now();
    const diffMs = Math.max(0, end - start);
    
    const totalMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    return `${hours}ω ${minutes}λ`;
  }

  // 3. Manager Force Close Shift
  public async forceCloseShift(shiftId: number | string, managerReason: string = 'Βίαιο κλείσιμο από Διαχειριστή'): Promise<void> {
    if (!this.isAdmin()) {
      throw new Error('Μόνο ο διαχειριστής έχει δικαίωμα εξαναγκαστικού κλεισίματος.');
    }

    const shift = await marketDb.shifts.get(shiftId as any);
    if (!shift) {
      throw new Error('Η βάρδια δεν βρέθηκε.');
    }

    const now = new Date().toISOString();
    const start = new Date(shift.startTime).getTime();
    const durationMinutes = Math.floor((new Date(now).getTime() - start) / 60000);

    // Expected cash = openingFloat + cash sales
    const expected = (shift.openingFloat || 0) + (shift.sales?.cash || 0);

    await marketDb.shifts.update(shiftId as any, {
      status: 'CLOSED',
      endTime: now,
      durationMinutes,
      expectedCash: expected,
      actualCountedCash: expected, // Marked as expected on forced closure
      discrepancy: 0,
      closedBy: 'MANAGER_FORCE',
      notes: managerReason
    });

    // If the force-closed shift was currently active on this terminal, clear it
    if (this.currentShift()?.id === shiftId) {
      this.currentShift.set(null);
      this.lockTerminal();
    }
  }

  public isSimpleCashier = computed(() => {
    const cashier = this.currentCashier();
    return cashier !== null && cashier.role !== 'ADMIN';
  });

  public terminalState = computed<PosTerminalState>(() => {
  const cashier = this.currentCashier();
  const shift = this.currentShift();

  

  if (!cashier || this.isLocked()) {
    return 'LOCKED';
  }
  if (!shift || shift.status !== 'OPEN') {
    return 'SHIFT_REQUIRED';
  }
  return 'ACTIVE';
});
 
  public get activeShift() {
    return this.currentShift;
  }

  private checkInitialLock(): boolean {
    return sessionStorage.getItem('pos_is_locked') !== 'false';
  }

  public async loginCashierById(cashierId: string, pin: string, openingFloat: number = 0): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || 'mar-market';

    await this.loadAllCashiers();

    // 1. Find the target cashier specifically
    const cashier = this.allCashiers().find(c => c.id === cashierId && c.storeId === activeShopCode);
    if (!cashier) {
      return { success: false, message: 'Ο επιλεγμένος ταμίας δεν βρέθηκε στο κατάστημα.' };
    }

    // 2. Validate PIN (direct match or admin fallback)
    const isPinMatch = cashier.pin === cleanPin;
    const inputHash = await sha256Pin(cleanPin, activeShop?.adminPinSalt || activeShopCode);
    const isAdminOverride = Boolean(activeShop?.adminPinHash && inputHash === activeShop.adminPinHash);

    if (!isPinMatch && !isAdminOverride) {
      return { success: false, message: 'Λανθασμένο PIN για τον συγκεκριμένο ταμία.' };
    }

    // 3. Set authenticated session with the explicit float
    await this.setAuthenticatedCashier(cashier, openingFloat);
    return { success: true, message: `Καλωσήρθατε, ${cashier.name}` };
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

    const activeStore = this.tenantConfig.activeShop()?.code || 'mar-market';
    const cashier = this.getInitialCashier();
    const isUnlocked = sessionStorage.getItem('pos_is_locked') === 'false';

    // ONLY stay unlocked if WE HAVE a valid cashier belonging to THIS store
    if (cashier && isUnlocked && cashier.storeId === activeStore) {
      this.currentCashier.set(cashier);
      this.isLocked.set(false);
      await this.ensureActiveShiftForCashier(cashier);
      return;
    }

    // Otherwise, FORCE lock down immediately
    this.lockTerminal();
  }

  /**
   * Loads cashiers strictly scoped to activeShop (no orphan cross-store leaks)
   */
  public async loadAllCashiers(): Promise<void> {
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || 'mar-market';

    const all = await marketDb.cashiers.toArray();
    // Strict isolation: ONLY include records where storeId explicitly matches
    const scopedList = (all || []).filter(c => 
      c.isActive !== false && c.storeId === activeShopCode
    );

    this.allCashiers.set(scopedList);
  }

  /**
   * Retrieves or creates an active shift for the cashier without hardcoded float overwrites
   */
  public async ensureActiveShiftForCashier(cashier: Cashier, floatAmount?: number): Promise<CashierShift> {
  const activeShopCode = this.tenantConfig.activeShop()?.code || cashier.storeId || 'mar-market';

  // Look for an existing OPEN shift
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
      registerId: this.tenantConfig.activeShop()?.registerId || 'POS-01', // <--- Add this line
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

  /**
   * Direct login validation strictly scoped to active store with SHA-256 Admin verification
   */
  public async loginWithPin(pin: string, openingFloat?: number): Promise<{ success: boolean; message: string }> {
    const cleanPin = pin.trim();
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || 'mar-market';

    // 1. REMOTE KILL-SWITCH ENFORCEMENT
    if (!activeShop || activeShop.isActive === false) {
      this.lockTerminal();
      return { 
        success: false, 
        message: 'Το κατάστημα έχει απενεργοποιηθεί. Επικοινωνήστε με τη Maranth Market.' 
      };
    }

    if (!cleanPin) {
      return { success: false, message: 'Παρακαλώ εισάγετε PIN.' };
    }

    await this.loadAllCashiers();

    // 2. Match local cashier in Dexie strictly scoped to activeShopCode
    let cashier = this.allCashiers().find(c => 
      c.pin === cleanPin && 
      c.isActive !== false && 
      c.storeId === activeShopCode
    );

    // 3. Check Admin PIN using SHA-256 Hash
    const inputHash = await sha256Pin(cleanPin, activeShop.adminPinSalt || activeShopCode);
    const isAdminPinMatch = Boolean(activeShop.adminPinHash && inputHash === activeShop.adminPinHash);

    // LOG UNCONDITIONALLY:
    const salt = activeShop?.adminPinSalt || activeShopCode;
    //const inputHash = await sha256Pin(cleanPin, salt);
    const targetHash = activeShop?.adminPinHash; // <--- MUST DECLARE VARIABLE HERE
 

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

  const rawAmount = Number(amount) || 0;
  const signedAmount = isRefund ? -Math.abs(rawAmount) : Math.abs(rawAmount);

  const sales: ShiftPaymentSummary = {
    cash: Number(shift.sales?.cash) || 0,
    card: Number(shift.sales?.card) || 0,
    split: Number(shift.sales?.split) || 0,
    debit: Number(shift.sales?.debit) || 0,
    totalSales: Number(shift.sales?.totalSales) || 0,
    transactionCount: Number(shift.sales?.transactionCount) || 0
  };

  sales.totalSales = Number((sales.totalSales + signedAmount).toFixed(2));
  sales.transactionCount += 1;

  const normalized = (method || '').toUpperCase();

  if (normalized === 'SPLIT' || normalized.includes('SPLIT')) {
    // 1. SPLIT: distribute the real cash into cash drawer and card into terminal card total
    const cashPart = splitDetails ? (isRefund ? -Math.abs(splitDetails.cash) : Math.abs(splitDetails.cash)) : signedAmount;
    const cardPart = splitDetails ? (isRefund ? -Math.abs(splitDetails.card) : Math.abs(splitDetails.card)) : 0;

    sales.cash = Number((sales.cash + cashPart).toFixed(2));
    sales.card = Number((sales.card + cardPart).toFixed(2));
    sales.split = Number(((sales.split ?? 0) + signedAmount).toFixed(2));
  } else if (normalized === 'DEBIT' || normalized.includes('DEBIT') || normalized.includes('VERESE')) {
    // 2. DEBIT (Βερεσέ): neither cash drawer nor bank POS card receives funds
    sales.debit = Number(((sales.debit ?? 0) + signedAmount).toFixed(2));
  } else if (normalized.includes('CARD') || normalized.includes('POS')) {
    // 3. CARD: physical POS settlement
    sales.card = Number((sales.card + signedAmount).toFixed(2));
  } else {
    // 4. CASH: physical drawer
    sales.cash = Number((sales.cash + signedAmount).toFixed(2));
  }

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

  public async createCashier(data: Omit<Cashier, 'id'>): Promise<{ success: boolean; message: string; cashier?: Cashier }> {
    const cleanPin = data.pin.trim();
    const activeShopCode = this.tenantConfig.activeShop()?.code || 'mar-market';

    await this.loadAllCashiers();
    const duplicate = this.allCashiers().find(c => c.pin === cleanPin && c.storeId === activeShopCode);
    if (duplicate) {
      return { success: false, message: `Το PIN "${cleanPin}" χρησιμοποιείται ήδη από "${duplicate.name}".` };
    }

    const newCashier: Cashier = {
      id: `cashier_${Date.now()}`,
      ...data,
      storeId: activeShopCode,
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

  /**
   * Computes dynamic live audit figures for the active shift without closing it (for X-Report).
   */
  public async calculateLiveShiftAudit(): Promise<{
    shiftId: string;
    openedAt: string;
    cashierName: string;
    cashierRole?: string;
    transactionCount: number;
    totalSales: number;
    netSales: number;
    vatTotal: number;
    cashSales: number;
    cardSales: number;
    debitSales: number;
    openingFloat: number;
    expectedCashInDrawer: number;
    vatBreakdown: { rate: number; net: number; vat: number; gross: number }[];
  }> {
    const shift = this.currentShift();
    if (!shift) {
      throw new Error('Δεν υπάρχει ενεργή βάρδια.');
    }

    const shiftStartTime = new Date(shift.startTime).getTime();
    
    // 1. Fetch transactions completed within the current shift timeframe
    const allTx = await marketDb.transactions.toArray();
    const shiftTxs = allTx.filter(tx => {
  const txTime = new Date(tx.timestamp || 0).getTime();
  const matchStore = !shift.storeId || tx.storeId === shift.storeId;
  const isCancelled = Boolean((tx as any).isCancelled || (tx as any).status === 'cancelled');
  return txTime >= shiftStartTime && matchStore && !isCancelled;
});

    let totalSales = 0;
    let cashSales = 0;
    let cardSales = 0;
    let debitSales = 0;
    let netSales = 0;
    let vatTotal = 0;

    const vatMap = new Map<number, { net: number; vat: number; gross: number }>();

    for (const tx of shiftTxs) {
      const gross = Number(tx.grandTotal || 0);
      totalSales += gross;

      // Payment analysis
      const method = (tx.paymentMethod || 'Cash').toLowerCase();
      if (method === 'cash') {
        cashSales += gross;
      } else if (method === 'card') {
        cardSales += gross;
      } else if (method === 'debit') {
        debitSales += gross;
      } else if (method === 'split') {
        const splitCash = Number((tx as any).splitCash || (tx as any).splitDetails?.cash || 0);
        const splitCard = Number((tx as any).splitCard || (tx as any).splitDetails?.card || 0);
        cashSales += splitCash;
        cardSales += splitCard;
      }

      // VAT and Line Item breakdown
      const items = tx.items || [];
      for (const item of items) {
        const itemRate = Number(item.product?.vatRate ?? 13);
        const lineGross = Number(item.lineTotal ?? (item.unitPrice ?? 0 * item.quantity));
        const lineNet = lineGross / (1 + itemRate / 100);
        const lineVat = lineGross - lineNet;

        netSales += lineNet;
        vatTotal += lineVat;

        const currentBucket = vatMap.get(itemRate) || { net: 0, vat: 0, gross: 0 };
        currentBucket.net += lineNet;
        currentBucket.vat += lineVat;
        currentBucket.gross += lineGross;
        vatMap.set(itemRate, currentBucket);
      }
    }

    // Cash movement adjustments (Cash In / Out during shift)
    const float = Number(shift.openingFloat || 0);
    const expectedCashInDrawer = float + cashSales;

    const vatBreakdown = Array.from(vatMap.entries()).map(([rate, vals]) => ({
      rate,
      net: parseFloat(vals.net.toFixed(2)),
      vat: parseFloat(vals.vat.toFixed(2)),
      gross: parseFloat(vals.gross.toFixed(2))
    }));

    return {
      shiftId: shift.id,
      openedAt: shift.startTime,
      cashierName: this.currentCashier()?.name || 'Ταμίας',
      cashierRole: this.currentCashier()?.role || 'CASHIER',
      transactionCount: shiftTxs.length,
      totalSales: parseFloat(totalSales.toFixed(2)),
      netSales: parseFloat(netSales.toFixed(2)),
      vatTotal: parseFloat(vatTotal.toFixed(2)),
      cashSales: parseFloat(cashSales.toFixed(2)),
      cardSales: parseFloat(cardSales.toFixed(2)),
      debitSales: parseFloat(debitSales.toFixed(2)),
      openingFloat: parseFloat(float.toFixed(2)),
      expectedCashInDrawer: parseFloat(expectedCashInDrawer.toFixed(2)),
      vatBreakdown
    };
  }

  public openBrowserXReportPreview(data: any, company: MarketCompanyProfile): void {
    const printWin = window.open('', '_blank', 'width=440,height=750,menubar=no,toolbar=no,location=no');
    if (!printWin) {
      alert('Το πρόγραμμα περιήγησης μπλόκαρε το παράθυρο εκτύπωσης. Επιτρέψτε τα popups.');
      return;
    }

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('el-GR');
    const timeFormatted = now.toLocaleTimeString('el-GR');

    const vatRows = (data.vatBreakdown || []).map((v: any) => `
      <tr>
        <td style="text-align: left;">${v.rate}%</td>
        <td style="text-align: right;">€${v.net.toFixed(2)}</td>
        <td style="text-align: right;">€${v.vat.toFixed(2)}</td>
        <td style="text-align: right; font-weight: bold;">€${v.gross.toFixed(2)}</td>
      </tr>
    `).join('');

    printWin.document.open();
    printWin.document.write(`
      <!DOCTYPE html>
      <html lang="el">
      <head>
        <meta charset="utf-8" />
        <title>Ενδιάμεσο Δελτίο "Χ"</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            color: #000;
            width: 72mm;
            margin: 0 auto;
            padding: 8px 4px;
            line-height: 1.25;
          }
          .center { text-align: center; }
          .bold { font-weight: 900; }
          .flex { display: flex; justify-content: space-between; }
          .divider { border-top: 1px dashed #000; margin: 5px 0; }
          .double-divider { border-top: 2px solid #000; margin: 6px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 13px;">${company.storeName || 'SUPER MARKET'}</div>
        <div class="center">${company.address || ''}</div>
        <div class="center">ΑΦΜ: ${company.afm || '-'} • ΔΟΥ: ${company.doy || '-'}</div>

        <div class="double-divider"></div>
        <div class="center bold" style="font-size: 13px; letter-spacing: 1px;">ΕΝΔΙΑΜΕΣΟ ΔΕΛΤΙΟ "Χ"</div>
        <div class="center" style="font-size: 9px;">(ΔΟΚΙΜΑΣΤΙΚΟ / ΠΛΗΡΟΦΟΡΙΑΚΟ - ΔΕΝ ΚΛΕΙΝΕΙ ΤΗ ΒΑΡΔΙΑ)</div>
        <div class="divider"></div>

        <div class="flex">
          <span>ΗΜ/ΝΙΑ: ${dateFormatted}</span>
          <span>ΩΡΑ: ${timeFormatted}</span>
        </div>
        <div class="flex">
          <span>ΤΑΜΕΙΟ: ${data.registerId || 'POS-01'}</span>
          <span>ΧΕΙΡΙΣΤΗΣ: ${data.cashierName || 'Ταμίας'}</span>
        </div>
        <div class="flex">
          <span>ΕΝΑΡΞΗ ΒΑΡΔΙΑΣ:</span>
          <span>${new Date(data.openedAt).toLocaleTimeString('el-GR')}</span>
        </div>
        <div class="flex bold">
          <span>ΑΠΟΔΕΙΞΕΙΣ:</span>
          <span>${data.transactionCount}</span>
        </div>

        <div class="double-divider"></div>
        <div class="flex bold" style="font-size: 13px;">
          <span>ΑΚΑΘΑΡΙΣΤΟΣ ΤΖΙΡΟΣ:</span>
          <span>€${Number(data.totalSales).toFixed(2)}</span>
        </div>
        <div class="flex">
          <span>ΚΑΘΑΡΗ ΑΞΙΑ:</span>
          <span>€${Number(data.netSales).toFixed(2)}</span>
        </div>
        <div class="flex">
          <span>ΣΥΝΟΛΟ Φ.Π.Α.:</span>
          <span>€${Number(data.vatTotal).toFixed(2)}</span>
        </div>

        <div class="divider"></div>
        <div class="bold" style="margin-bottom: 2px;">ΑΝΑΛΥΣΗ ΠΛΗΡΩΜΩΝ:</div>
        <div class="flex">
          <span>ΜΕΤΡΗΤΑ:</span>
          <span>€${Number(data.cashSales).toFixed(2)}</span>
        </div>
        <div class="flex">
          <span>ΚΑΡΤΕΣ / POS:</span>
          <span>€${Number(data.cardSales).toFixed(2)}</span>
        </div>
        <div class="flex">
          <span>ΒΕΡΕΣΕ (ΤΕΦΤΕΡΙ):</span>
          <span>€${Number(data.debitSales).toFixed(2)}</span>
        </div>

        ${vatRows ? `
          <div class="divider"></div>
          <div class="bold" style="margin-bottom: 2px;">ΑΝΑΛΥΣΗ Φ.Π.Α.:</div>
          <table>
            <thead>
              <tr style="border-bottom: 1px dashed #000;">
                <th style="text-align: left;">ΣΥΝΤ</th>
                <th style="text-align: right;">ΚΑΘΑΡΟ</th>
                <th style="text-align: right;">ΦΠΑ</th>
                <th style="text-align: right;">ΣΥΝΟΛΟ</th>
              </tr>
            </thead>
            <tbody>
              ${vatRows}
            </tbody>
          </table>
        ` : ''}

        <div class="double-divider"></div>
        <div class="bold" style="margin-bottom: 2px;">ΤΑΜΕΙΑΚΟ ΙΣΟΖΥΓΙΟ ΣΥΡΤΑΡΙΟΥ:</div>
        <div class="flex">
          <span>Αρχικό Ταμείο (Float):</span>
          <span>€${Number(data.openingFloat).toFixed(2)}</span>
        </div>
        <div class="flex">
          <span>Εισπράξεις Μετρητών:</span>
          <span>€${Number(data.cashSales).toFixed(2)}</span>
        </div>
        <div class="flex bold" style="font-size: 12px; margin-top: 2px;">
          <span>ΑΝΑΜΕΝΟΜΕΝΟ ΤΑΜΕΙΟ:</span>
          <span>€${Number(data.expectedCashInDrawer).toFixed(2)}</span>
        </div>

        <div class="double-divider"></div>
        <div class="center bold" style="font-size: 10px;">ΤΕΛΟΣ ΕΝΔΙΑΜΕΣΟΥ ΔΕΛΤΙΟΥ "Χ"</div>

        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 250);
          };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  }
}