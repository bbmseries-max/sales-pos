POS Shift Reconciliation, Split Payment & Greek Retail Debt ("Βερεσέ") ArchitectureThis documentation details the architecture, data models, state management, and operational workflows for cash drawer reconciliation, multi-tender split payments, and neighborhood customer credit ("βερεσέ" / τεφτέρι) implemented in the Greek supermarket POS application.1. Domain Overview & Architectural PrinciplesRetail operations in small Greek supermarkets and neighborhood grocery stores carry distinct operational and fiscal patterns:Shift Drawer Reconciliation (Z-Report / myDATA readiness):Physical drawer balances must remain clean and auditable. Cashiers cannot balance a shift if credit ledger debts are conflated with actual cash tender.Split Payments («Μεικτή Πληρωμή»):Customers frequently tender partial cash and charge the remainder to an electronic card terminal (EFT/POS).Store Credit Ledger («Βερεσέ» / Τεφτέρι):Regular local customers often defer payment to a store tab. Goods leave inventory immediately, sales turnover increments, but zero cash enters the till and zero batch totals hit the card terminal.Financial Reconciliation Formula$$\text{Expected Drawer Cash} = \text{Opening Float} + \text{Cash Sales} + \text{Cash In} - \text{Cash Out}$$2. Core Data Models2.1 Cashier Shift & Payment Breakdown (cashier-shift.model.ts)TypeScriptexport type ShiftReportType = 'X-REPORT' | 'Z-REPORT';
export type CashierRole = 'ADMIN' | 'CASHIER' | 'MANAGER';

export type UiPaymentMethod = 'CASH' | 'CARD' | 'SPLIT' | 'DEBIT';
export type DbPaymentMethod = 'Cash' | 'Card' | 'Split' | 'Debit';

export interface ShiftPaymentSummary {
  cash: number;
  card: number;
  split?: number;
  debit?: number;       // Store ledger tab transactions ("Βερεσέ")
  totalSales: number;   // Gross transaction turnover
  total?: number;       // Compatibility alias for template binding
  transactionCount?: number;
}

export interface CashMovement {
  id: string;
  shiftId: string;
  storeId: string;
  type: 'IN' | 'OUT' | 'FLOAT' | 'DROP';
  amount: number;
  reason: string;
  timestamp: string;
}

export interface CashierShift {
  id: string;
  registerId?: string;
  cashierId: string;
  cashierName: string;
  storeId: string;
  startTime: string;
  endTime?: string;
  status: 'OPEN' | 'CLOSED';
  openingFloat: number;
  cashInTotal: number;
  cashOutTotal: number;
  cashMovements: CashMovement[];
  sales: ShiftPaymentSummary;
  expectedCashInDrawer?: number;
  countedCashInDrawer?: number;
  discrepancy?: number;
  notes?: string;
}

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
  countedCash: number;
  discrepancy: number;
  reportType: ShiftReportType;
  generatedAt: string;
}
2.2 Customer & Debt Ledger Model (market.models.ts)TypeScriptexport interface Customer {
  id: string;
  name: string;
  phone?: string;
  loyaltyPoints: number;
  totalSpent: number;
  totalVisits: number;
  lastVisit?: string;
  currentDebt?: number; // Accumulated debt balance ("Βερεσέ")
  createdAt?: string;
}
3. Shift Management Service ImplementationThe CashierShiftService acts as the single source of truth for shift state, ledger auditing, and till calculations.TypeScriptimport { Injectable, signal, computed } from '@angular/core';
import { marketDb } from '../db/market.db';
import { Cashier, Customer } from '../models/market.models';
import { 
  CashierShift, 
  ShiftPaymentSummary, 
  ShiftReportSnapshot, 
  UiPaymentMethod 
} from '../models/cashier-shift.model';
import { TenantConfigService } from './tenant-config.service';

@Injectable({
  providedIn: 'root'
})
export class CashierShiftService {
  public currentCashier = signal<Cashier | null>(null);
  public currentShift = signal<CashierShift | null>(null);
  public activeShiftStart = computed(() => this.currentShift()?.startTime || '');

  constructor(private tenantConfig: TenantConfigService) {}

  public calculateExpectedCash(shift: CashierShift): number {
    const opening = Number(shift.openingFloat) || 0;
    const cashSales = Number(shift.sales?.cash) || 0;
    const cashIn = Number(shift.cashInTotal) || 0;
    const cashOut = Number(shift.cashOutTotal) || 0;
    return Number((opening + cashSales + cashIn - cashOut).toFixed(2));
  }

  public async ensureActiveShiftForCashier(cashier: Cashier, floatAmount?: number): Promise<CashierShift> {
    const activeShop = this.tenantConfig.activeShop();
    const activeShopCode = activeShop?.code || cashier.storeId || 'mar-market';
    const registerId = activeShop?.registerId || 'POS-01';

    const existingShift = await marketDb.shifts
      .where('cashierId').equals(cashier.id)
      .and(s => s.status === 'OPEN' && s.storeId === activeShopCode)
      .first();

    let activeShift: CashierShift;

    if (!existingShift) {
      const resolvedFloat = typeof floatAmount === 'number' 
        ? floatAmount 
        : (activeShop?.defaultFloat ?? 0);

      activeShift = {
        id: `SHIFT-${Date.now().toString(36).toUpperCase()}`,
        registerId,
        cashierId: cashier.id,
        cashierName: cashier.name,
        storeId: activeShopCode,
        startTime: new Date().toISOString(),
        status: 'OPEN',
        openingFloat: resolvedFloat,
        cashInTotal: 0,
        cashOutTotal: 0,
        cashMovements: [],
        sales: { 
          cash: 0, 
          card: 0, 
          split: 0, 
          debit: 0, 
          totalSales: 0, 
          transactionCount: 0 
        }
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

  public async recordSaleToShift(
    amount: number, 
    method: UiPaymentMethod | string, 
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
      const cashPart = splitDetails 
        ? (isRefund ? -Math.abs(splitDetails.cash) : Math.abs(splitDetails.cash)) 
        : signedAmount;
      const cardPart = splitDetails 
        ? (isRefund ? -Math.abs(splitDetails.card) : Math.abs(splitDetails.card)) 
        : 0;

      sales.cash = Number((sales.cash + cashPart).toFixed(2));
      sales.card = Number((sales.card + cardPart).toFixed(2));
      sales.split = Number(((sales.split ?? 0) + signedAmount).toFixed(2));
    } else if (normalized === 'DEBIT' || normalized.includes('DEBIT') || normalized.includes('VERESE')) {
      // "Βερεσέ" does not modify drawer cash or terminal card totals
      sales.debit = Number(((sales.debit ?? 0) + signedAmount).toFixed(2));
    } else if (normalized.includes('CARD') || normalized.includes('POS')) {
      sales.card = Number((sales.card + signedAmount).toFixed(2));
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
      sales: { ...closedShift.sales },
      cashInTotal: closedShift.cashInTotal || 0,
      cashOutTotal: closedShift.cashOutTotal || 0,
      expectedDrawerCash: expected,
      countedCash: Number(countedCash),
      discrepancy,
      reportType: 'Z-REPORT',
      generatedAt: endTime
    };
  }
}
4. POS Component UI & Checkout Logic4.1 Component State & Calculations (pos.component.ts)TypeScriptimport { Component, OnInit, signal, computed } from '@angular/core';
import { marketDb } from '../../core/db/market.db';
import { Customer } from '../../core/models/market.models';
import { UiPaymentMethod, DbPaymentMethod } from '../../core/models/cashier-shift.model';
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { CartService } from '../../core/services/cart.service';

@Component({
  selector: 'app-pos',
  templateUrl: './pos.component.html',
  standalone: true,
  // ...imports
})
export class PosComponent implements OnInit {
  public paymentMethod = signal<UiPaymentMethod>('CASH');
  public cardAmount = signal<number>(0);
  
  // Total derived from gross cart value
  public cartTotal = computed(() => Number(this.cart.grandTotal() || 0));

  // Reactive cash remainder
  public cashAmount = computed(() => {
    const mode = this.paymentMethod();
    const total = this.cartTotal();

    if (mode === 'CASH') return total;
    if (mode === 'CARD') return 0;
    if (mode === 'DEBIT') return 0;

    const card = this.cardAmount();
    return Math.max(0, parseFloat((total - card).toFixed(2)));
  });

  // Customer Debt ("Βερεσέ") state
  public customers = signal<Customer[]>([]);
  public selectedCustomerId = signal<string | null>(null);
  public customerInputName = signal<string>('');
  public isCreatingCustomer = signal<boolean>(false);

  constructor(
    public cart: CartService,
    public shiftService: CashierShiftService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadCustomers();
  }

  public async loadCustomers(): Promise<void> {
    if (!marketDb.customers) return;
    const list = await marketDb.customers.toArray();
    this.customers.set(list || []);
  }

  // Split helpers
  public setSplitExactCard(amount: number): void {
    const total = this.cartTotal();
    const valid = Math.min(Math.max(0, Number(amount) || 0), total);
    this.cardAmount.set(parseFloat(valid.toFixed(2)));
  }

  public setSplitExactCash(amount: number): void {
    const total = this.cartTotal();
    const validCash = Math.min(Math.max(0, Number(amount) || 0), total);
    this.cardAmount.set(parseFloat((total - validCash).toFixed(2)));
  }

  public splitHalf(): void {
    const half = parseFloat((this.cartTotal() / 2).toFixed(2));
    this.cardAmount.set(half);
  }

  // Inline Customer On-The-Fly Creation
  public async createCustomerOnTheFly(): Promise<void> {
    const rawName = this.customerInputName().trim();
    if (!rawName) return;

    this.isCreatingCustomer.set(true);
    try {
      const now = new Date().toISOString();
      const newCustomer: Customer = {
        id: `CUST-${Date.now().toString(36).toUpperCase()}`,
        name: rawName,
        phone: '',
        loyaltyPoints: 0,
        totalSpent: 0,
        totalVisits: 0,
        lastVisit: now,
        currentDebt: 0,
        createdAt: now
      };

      await marketDb.customers.add(newCustomer);
      await this.loadCustomers();
      this.selectedCustomerId.set(newCustomer.id);
    } finally {
      this.isCreatingCustomer.set(false);
    }
  }

  public mapToDbPaymentMethod(uiMethod: UiPaymentMethod): DbPaymentMethod {
    switch (uiMethod) {
      case 'CASH': return 'Cash';
      case 'CARD': return 'Card';
      case 'SPLIT': return 'Split';
      case 'DEBIT': return 'Debit';
    }
  }

  public async finalizeSale(): Promise<void> {
    const method = this.paymentMethod();
    const total = this.cartTotal();

    if (method === 'DEBIT') {
      if (!this.selectedCustomerId() && this.customerInputName().trim()) {
        await this.createCustomerOnTheFly();
      }
      if (!this.selectedCustomerId()) {
        alert('Παρακαλώ επιλέξτε ή καταχωρήστε πελάτη για το βερεσέ.');
        return;
      }
    }

    const isSplit = method === 'SPLIT';
    const splitDetails = isSplit ? { cash: this.cashAmount(), card: this.cardAmount() } : undefined;

    // 1. Audit to Shift
    await this.shiftService.recordSaleToShift(total, method, false, splitDetails);

    // 2. Persist Tab Debt if DEBIT
    if (method === 'DEBIT' && this.selectedCustomerId()) {
      const custId = this.selectedCustomerId()!;
      const customer = await marketDb.customers.get(custId);
      if (customer) {
        const updatedDebt = parseFloat(((customer.currentDebt || 0) + total).toFixed(2));
        await marketDb.customers.update(custId, { currentDebt: updatedDebt });
        await this.loadCustomers();
      }
    }

    // 3. Reset State & Print Receipt
    this.selectedCustomerId.set(null);
    this.customerInputName.set('');
    this.cart.clear();

    setTimeout(() => {
      window.print();
    }, 100);
  }
}
4.2 Template Markup (pos.component.html)HTML<!-- Payment Selector Bar -->
<div class="grid grid-cols-4 gap-2 mb-4 font-mono">
  <button type="button" (click)="paymentMethod.set('CASH')"
    [class.bg-emerald-600]="paymentMethod() === 'CASH'"
    [class.bg-slate-800]="paymentMethod() !== 'CASH'"
    class="py-3 px-2 rounded-xl border border-slate-700 font-bold text-xs flex flex-col items-center gap-1 cursor-pointer">
    <span>💵 Μετρητά</span>
  </button>

  <button type="button" (click)="paymentMethod.set('CARD')"
    [class.bg-blue-600]="paymentMethod() === 'CARD'"
    [class.bg-slate-800]="paymentMethod() !== 'CARD'"
    class="py-3 px-2 rounded-xl border border-slate-700 font-bold text-xs flex flex-col items-center gap-1 cursor-pointer">
    <span>💳 Κάρτα</span>
  </button>

  <button type="button" (click)="paymentMethod.set('SPLIT')"
    [class.bg-amber-600]="paymentMethod() === 'SPLIT'"
    [class.bg-slate-800]="paymentMethod() !== 'SPLIT'"
    class="py-3 px-2 rounded-xl border border-slate-700 font-bold text-xs flex flex-col items-center gap-1 cursor-pointer">
    <span>✂️ Μεικτή</span>
  </button>

  <button type="button" (click)="paymentMethod.set('DEBIT')"
    [class.bg-purple-600]="paymentMethod() === 'DEBIT'"
    [class.bg-slate-800]="paymentMethod() !== 'DEBIT'"
    class="py-3 px-2 rounded-xl border border-slate-700 font-bold text-xs flex flex-col items-center gap-1 cursor-pointer">
    <span>📒 Βερεσέ</span>
  </button>
</div>

<!-- SPLIT PAYMENT CONTROLS -->
@if (paymentMethod() === 'SPLIT') {
  <div class="p-4 bg-slate-950 rounded-2xl border border-amber-500/40 space-y-4 font-mono mb-4">
    <div class="flex justify-between items-center pb-2 border-b border-slate-800 text-xs">
      <span class="text-slate-400">Προς Εξόφληση:</span>
      <span class="text-amber-400 font-bold text-base">€{{ cartTotal().toFixed(2) }}</span>
    </div>

    <div class="flex gap-2">
      <button type="button" (click)="splitHalf()" class="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold">
        ½ 50/50
      </button>
      <button type="button" (click)="setSplitExactCash(5)" class="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold">
        €5 Μετρητά
      </button>
      <button type="button" (click)="setSplitExactCash(10)" class="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold">
        €10 Μετρητά
      </button>
      <button type="button" (click)="setSplitExactCash(20)" class="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold">
        €20 Μετρητά
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="p-3 bg-slate-900 border border-emerald-500/40 rounded-xl">
        <label class="block text-[10px] text-emerald-400 font-bold uppercase mb-1">💵 Μετρητά</label>
        <input type="number" step="0.01" [ngModel]="cashAmount()" (ngModelChange)="setSplitExactCash($event)"
          class="w-full bg-transparent text-emerald-400 font-black text-lg outline-none" />
      </div>

      <div class="p-3 bg-slate-900 border border-blue-500/40 rounded-xl">
        <label class="block text-[10px] text-blue-400 font-bold uppercase mb-1">💳 Κάρτα (POS)</label>
        <input type="number" step="0.01" [ngModel]="cardAmount()" (ngModelChange)="setSplitExactCard($event)"
          class="w-full bg-transparent text-blue-400 font-black text-lg outline-none" />
      </div>
    </div>
  </div>
}

<!-- DEBIT ("ΒΕΡΕΣΕ") CUSTOMER SELECTION -->
@if (paymentMethod() === 'DEBIT') {
  <div class="p-4 bg-purple-950/40 rounded-2xl border border-purple-800 space-y-3 font-mono mb-4">
    <div class="flex items-center justify-between text-xs text-purple-300 font-bold">
      <span>📒 ΕΠΙΛΟΓΗ / ΠΡΟΣΘΗΚΗ ΠΕΛΑΤΗ (ΤΕΦΤΕΡΙ)</span>
      <span class="text-white text-sm">€{{ cartTotal().toFixed(2) }}</span>
    </div>

    @if (customers().length > 0) {
      <div>
        <label class="block text-[11px] text-purple-400 mb-1 font-bold">ΥΠΑΡΧΩΝ ΠΕΛΑΤΗΣ:</label>
        <select [ngModel]="selectedCustomerId()" (ngModelChange)="selectedCustomerId.set($event)"
          class="w-full h-11 bg-slate-900 border border-purple-500/50 rounded-xl px-3 text-sm text-slate-100 font-bold outline-none cursor-pointer">
          <option [ngValue]="null">-- Επιλέξτε Πελάτη --</option>
          @for (cust of customers(); track cust.id) {
            <option [value]="cust.id">
              {{ cust.name }} (Υπόλοιπο: €{{ (cust.currentDebt || 0).toFixed(2) }})
            </option>
          }
        </select>
      </div>
    }

    <div class="space-y-2">
      <label class="block text-[11px] text-purple-400 font-bold">Ή ΠΛΗΚΤΡΟΛΟΓΗΣΤΕ ΝΕΟ ΟΝΟΜΑ:</label>
      <div class="flex gap-2">
        <input type="text" placeholder="π.χ. Κυρία Κατερίνα" [ngModel]="customerInputName()" (ngModelChange)="customerInputName.set($event)"
          (keyup.enter)="createCustomerOnTheFly()"
          class="flex-1 h-11 bg-slate-900 border border-purple-500/50 rounded-xl px-3 text-sm text-white font-bold outline-none" />
        <button type="button" (click)="createCustomerOnTheFly()" [disabled]="!customerInputName().trim() || isCreatingCustomer()"
          class="px-4 h-11 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold cursor-pointer">
          + Προσθήκη
        </button>
      </div>
    </div>

    @if (selectedCustomerId()) {
      <div class="p-2.5 bg-emerald-950/40 border border-emerald-500/60 rounded-xl flex items-center justify-between text-xs">
        <span class="text-emerald-300 font-bold">
          ✔ Επιλέχθηκε: {{ customers().find(c => c.id === selectedCustomerId())?.name }}
        </span>
        <button type="button" (click)="selectedCustomerId.set(null)" class="text-rose-400 hover:underline">
          Αφαίρεση
        </button>
      </div>
    }
  </div>
}
5. Physical ESC/POS vs. Greek Fiscal Device (ΦΗΜ) IntegrationBrowser-native window.print() triggers the operating system's standard print spooler, which is suitable for testing and development. Production deployment in Greece requires interfacing with certified fiscal mechanisms (ΦΗΜ / ΑΔΗΜΕ) or certified cloud e-invoicing providers (Πάροχοι Ηλεκτρονικής Τιμολόγησης).                      ┌────────────────────────────────────────┐
                      │             Angular POS                │
                      │       (IndexedDB / Dexie.js)           │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                               [Tender Validation]
                      ┌──────────────────┴─────────────────────┐
                      │ Method: CASH / CARD / SPLIT / DEBIT    │
                      └──────────────────┬─────────────────────┘
                                         │
             ┌───────────────────────────┴───────────────────────────┐
             │ (Development / Preview)                               │ (Production Fiscal Flow)
             ▼                                                       ▼
      [window.print()]                                      [Local Fiscal Middleware]
      Standard OS Spooler                                  (e.g., localhost:18300 / USB Driver)
                                                                     │
                                                                     ▼
                                                          [Fiscal Signature Generation]
                                                          - myDATA Transmission
                                                          - AADE QR Code & Signature Hash
                                                                     │
                                                                     ▼
                                                          [Direct ESC/POS Raw Print]
                                                          Thermal 80mm Station
Fiscal Payload ConstructionWhen dispatching to the fiscal driver daemon:Payment type codes must map to official AADE classifications (1 for Cash, 2 for POS Card, 5 for Credit/Other).Split payments must be split into separate tender records in the driver buffer before issuing the final total cut command.Βερεσέ transactions register as zero-cash tender on credit, guaranteeing zero discrepancy when reconciling against the physical drawer and POS terminal batch receipts.