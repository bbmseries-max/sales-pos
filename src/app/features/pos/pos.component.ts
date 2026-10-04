import { 
  Component, 
  inject, 
  signal, 
  computed, 
  OnInit, 
  OnDestroy,
  AfterViewInit, 
  ViewChild, 
  ElementRef, 
  HostListener 
} from '@angular/core';
import { PosOutOfStockModalComponent } from './components/pos-out-of-stock-modal/pos-out-of-stock-modal.component';
import { PosMydataModalComponent } from './components/pos-mydata-modal/pos-mydata-modal.component';
import { PosWeightModalComponent } from './components/pos-weight-modal/pos-weight-modal.component';
import { PosDiscountModalComponent } from './components/pos-discount-modal/pos-discount-modal.component';
import { PosPaymentModalComponent, PaymentCompletionEvent } from './components/pos-payment-modal/pos-payment-modal/pos-payment-modal.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

// Standalone Modals
import { PosLockScreenComponent } from './components/pos-lock-screen.component';
import { PosDenominationModalComponent } from './components/pos-denomination-modal.component';
import { PosShiftHandoverModalComponent } from './components/pos-shift-handover-modal.component';
import { PosCustomerModalComponent } from './components/pos-customer-modal.component';
import { CashLogEvent } from './components/pos-cash-drawer-modal.component';
import { 
  PosQuickRegisterModalComponent, 
  QuickRegisterConfirmEvent 
} from './components/quick-register-modal.component';
import { PosPriceCheckModalComponent } from './components/pos-price-check-modal.component';
import { PosStoreSwitcherModalComponent } from './components/pos-store-switcher-modal.component';
import { NewStoreModalComponent } from '../../shared/new-store-modal.component';

// Services
import { StorageQuotaService } from '../../core/services/storage-quota.service';
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { MarketCatalogService, ExternalProductMatch } from '../../core/services/market-catalog.service';
import { CartService } from '../../core/services/cart.service';
import { SyncService } from '../../core/services/sync.service';
import { PosEmployeeModalComponent } from './components/pos-employee-modal/pos-employee-modal.component';
import { PosNewShiftModalComponent, StartShiftPayload } from './components/pos-new-shift-modal/pos-new-shift-modal.component';
import { ScaleBarcodeService } from '../../core/services/scale-barcode.service';
import { MyDataService } from '../../core/services/mydata.service';
import { CustomerLoyaltyService } from '../../core/services/customer-loyalty.service';
import { BarcodeScannerService } from '../../core/services/barcode-scanner.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { marketDb } from '../../core/db/market-db';
import { BridgeService } from '../../core/services/bridge.service';

import { 
  Product, 
  TransactionRecord, 
  MarketCompanyProfile, 
  Customer,
  Cashier,
  CartItem,
  CashierRole
} from '../../core/models';

export type UiPaymentMethod = 'CASH' | 'CARD' | 'DEBIT' | 'SPLIT';
export type DbPaymentMethod = 'Cash' | 'Card' | 'Debit' | 'Split';

export interface ShiftPaymentSummary {
  cash: number;
  card: number;
  split?: number;
  debit?: number;       // Total amount written to customer tab ("βερεσέ")
  totalSales: number;   // Gross total turnover (Cash + Card + Debit)
  transactionCount?: number;
}

@Component({
  selector: 'app-pos',
  standalone: true,
  host: {
    'class': 'block w-full h-full min-h-0 min-w-0 overflow-hidden'
  },
  imports: [
    CommonModule, 
    PosPaymentModalComponent,
    FormsModule,
    PosEmployeeModalComponent,
    PosNewShiftModalComponent,
    PosOutOfStockModalComponent,
    PosMydataModalComponent,
    PosQuickRegisterModalComponent,
    PosPriceCheckModalComponent,
    PosCustomerModalComponent,
    PosLockScreenComponent,
    PosShiftHandoverModalComponent,
    PosStoreSwitcherModalComponent,
    NewStoreModalComponent,
    PosDenominationModalComponent,
    PosWeightModalComponent,
    PosDiscountModalComponent,
    RouterLink
  ],
  templateUrl: './pos.component.html'
})
export class PosComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('barcodeInput') barcodeInputRef!: ElementRef<HTMLInputElement>;

  // 1. Dependency Injections (Hoisted to top for safe signal initialization)
  public tenantConfig = inject(TenantConfigService);
  public shiftService = inject(CashierShiftService);
  public bridge = inject(BridgeService);
  public catalogService = inject(MarketCatalogService);
  public cart = inject(CartService);
  public scanner = inject(BarcodeScannerService);
  public scaleService = inject(ScaleBarcodeService);
  public myDataService = inject(MyDataService);
  public loyaltyService = inject(CustomerLoyaltyService);
  public syncService = inject(SyncService);
  private storageQuotaService = inject(StorageQuotaService);
  private router = inject(Router);

  // 2. Dynamic Shift & Initialization Signals
  public showNewShiftModal = signal<boolean>(false);
  public nextShiftCashierPin = signal<string>('');
  public nextShiftFloat = signal<number>(this.tenantConfig.activeShop()?.defaultFloat ?? 50);
  public openingFloatInput = signal<number>(this.tenantConfig.activeShop()?.defaultFloat ?? 50);
  public nextShiftError = signal<string>(''); 
  public selectedShiftCashierId = signal<string>('');

  // 3. UI Keypad & Lock State
  public pinInput = signal<string>('');
  public pinError = signal<string>('');
  public isCompletingSale = signal<boolean>(false);

  // 4. Drawer & Cash Management
  public cashMovementAmount = signal<number>(0);
  public cashMovementReason = signal<string>('Προσθήκη Μαγιάς / Εισαγωγή');
  public isNewStoreModalOpen = signal<boolean>(false);
  public showDenominationModal = signal<boolean>(false);
  public cashLogType = signal<'IN' | 'OUT' | 'FLOAT' | 'DROP'>('IN');
  public cashLogAmount = signal<number>(50.0);
  public cashLogReason = signal<string>('');
  public countedClosingCash = signal<number>(0);

  // 5. Employee Management Form
  public showEmployeeModal = signal<boolean>(false);
  public isSavingEmployee = signal<boolean>(false);
  public employeeForm: {
    name: string;
    pin: string;
    role: CashierRole;
    storeId: string;
  } = {
    name: '',
    pin: '',
    role: 'CASHIER',
    storeId: ''
  };

  // 6. Search & Hardware Barcode State
  public searchQuery = signal<string>('');
  public searchResults = signal<Product[]>([]);
  public pinnedProducts = signal<Product[]>([]);
  public isBarcodeProcessing = signal<boolean>(false);
  public scanFeedback = signal<string | null>(null);

  // 7. Modals Visibility
  public showStoreModal = signal<boolean>(false);
  public showCashDrawerModal = signal<boolean>(false);
  public showCustomerModal = signal<boolean>(false);
  public showPaymentModal = signal<boolean>(false);
  public showPriceCheckModal = signal<boolean>(false);
  public showShiftHandoverModal = signal<boolean>(false);
  public showQuickRegisterModal = signal<boolean>(false);
  public showWeightModal = signal<boolean>(false);
  public showMyDataConfig = signal<boolean>(false);
  public showOutOfStockModal = signal<boolean>(false);
  public showDiscountModal = signal<boolean>(false);

  // 8. Transient Action States
  public discoveredExternalProduct = signal<ExternalProductMatch | null>(null);
  public priceCheckInput = signal<string>('');
  public priceCheckResult = signal<Product | null>(null);
  public customerSearchResults = signal<Customer[]>([]);
  public activeWeightedProduct = signal<Product | null>(null);
  public inputWeightKg = signal<number>(1.0);
  public outOfStockProduct = signal<Product | null>(null);
  public selectedDiscountItem = signal<CartItem | null>(null);
  public discountScope = signal<'ITEM' | 'CART'>('CART');
  public customDiscountInput = signal<number>(10);

  // 9. Payment State
  public paymentMethod = signal<UiPaymentMethod>('CASH');
  public cardAmount = signal<number>(0);
  public cashTendered = signal<number>(0);
  public isCardProcessing = signal<boolean>(false);
  public cardTxSuccess = signal<boolean>(false);
  public pointsToRedeem = signal<number>(0);
  public splitCardAmount = signal<number>(0);
  public cartTotal = computed(() => Number(this.cart.grandTotal() || 0));

  // Payment Mode & Selected Customer for "Βερεσέ"
  public selectedCustomerId = signal<string | null>(null);
  public customers = signal<Customer[]>([]);

  // Mapping to DB
  public mapToDbPaymentMethod(uiMethod: UiPaymentMethod): DbPaymentMethod {
  switch (uiMethod) {
    case 'CASH': return 'Cash';
    case 'CARD': return 'Card';
    case 'SPLIT': return 'Split';
    case 'DEBIT': return 'Debit';
   }
  }

  public async handleStartShiftModalSubmit(payload: StartShiftPayload): Promise<void> {
  this.selectedShiftCashierId.set(payload.cashierId);
  this.nextShiftCashierPin.set(payload.pin);
  this.nextShiftFloat.set(payload.openingFloat);
  await this.confirmStartNewShift();
}
  
// public selectedCustomerId = signal<string | null>(null);
public customerInputName = signal<string>('');
public isCreatingCustomer = signal<boolean>(false);

// Load existing customers from Dexie
public async loadCustomers(): Promise<void> {
  if (!marketDb.customers) return;
  const list = await marketDb.customers.toArray();
  this.customers.set(list || []);
}

// Quick Inline Create Customer
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

public async handlePaymentComplete(event: PaymentCompletionEvent): Promise<void> {
  if (this.isCompletingSale()) return;
  this.isCompletingSale.set(true);

  const mappedMethod: DbPaymentMethod = 
    event.method === 'CARD' ? 'Card' : 
    event.method === 'SPLIT' ? 'Split' : 
    event.method === 'DEBIT' ? 'Debit' : 'Cash';

  const cashierName = this.shiftService.currentCashier()?.name || 
    `Ταμίας [${this.tenantConfig.activeShop()?.code || 'REG'}]`;

  try {
    // If a new customer name was entered on-the-fly for debit:
    let targetCustomerId = event.customerId;
    if (event.method === 'DEBIT' && !targetCustomerId && event.newCustomerName) {
      const now = new Date().toISOString();
      const newCust: Customer = {
        id: `CUST-${Date.now().toString(36).toUpperCase()}`,
        name: event.newCustomerName,
        phone: '',
        loyaltyPoints: 0,
        totalSpent: 0,
        totalVisits: 0,
        lastVisit: now,
        currentDebt: 0,
        createdAt: now
      };
      await marketDb.customers.add(newCust);
      await this.loadCustomers();
      targetCustomerId = newCust.id;
    }

    // 1. Checkout Cart
    const tx = await this.cart.checkout(
      mappedMethod,
      cashierName,
      event.cashTendered,
      event.changeDue
    );

    // 2. Record to Shift
    const total = Number(tx.grandTotal) || 0;
    await this.shiftService.recordSaleToShift(
      total,
      mappedMethod,
      false,
      event.splitDetails
    );

    // 3. Update Debit balance if DEBIT
    if (event.method === 'DEBIT' && targetCustomerId) {
      const customer = await marketDb.customers.get(targetCustomerId);
      if (customer) {
        const newDebt = parseFloat(((Number(customer.currentDebt) || 0) + total).toFixed(2));
        await marketDb.customers.update(targetCustomerId, { currentDebt: newDebt });
        await this.loadCustomers();
      }
    }

    this.showPaymentModal.set(false);
    await this.handleFiscalPostProcessing(tx);
    this.flashFeedback('✔ Η πώληση ολοκληρώθηκε!', 'success');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Sale Error]', msg);
    this.flashFeedback('⛔ Σφάλμα: ' + msg, 'error');
  } finally {
    this.isCompletingSale.set(false);
    this.focusBarcodeInput?.();
  }
}

// OLD Code Cash remainder is automatically computed from the total
public splitCashAmount = computed(() => {
  const total = Number(this.cartTotal() || 0);
  const card = Number(this.splitCardAmount() || 0);
  const diff = total - card;
  return diff > 0 ? parseFloat(diff.toFixed(2)) : 0;
});

// Helper for cashier entering card amount
public onCardSplitInput(val: any): void {
  const total = Number(this.cartTotal() || 0);
  const entered = parseFloat(val) || 0;
  // Prevent card portion from exceeding grand total
  this.splitCardAmount.set(Math.min(Math.max(0, entered), total));
}

// --- Split Payment Calculation Helpers ---
  public setSplitExactCard(amount: number): void {
    const total = this.cartTotal();
    const valid = Math.min(Math.max(0, Number(amount) || 0), total);
    this.cardAmount.set(parseFloat(valid.toFixed(2)));
  }

  public setSplitExactCash(amount: number): void {
    const total = this.cartTotal();
    const validCash = Math.min(Math.max(0, Number(amount) || 0), total);
    // Whatever is paid in cash, the card receives the exact remainder:
    this.cardAmount.set(parseFloat((total - validCash).toFixed(2)));
  }

  public splitHalf(): void {
    const half = parseFloat((this.cartTotal() / 2).toFixed(2));
    this.cardAmount.set(half);
  }

// Quick 50/50 split helper button
public splitFiftyFifty(): void {
  const total = Number(this.cartTotal() || 0);
  const half = parseFloat((total / 2).toFixed(2));
  this.splitCardAmount.set(half);
}

// Execute Split Sale
public async finalizeSplitPayment(): Promise<void> {
  const total = Number(this.cartTotal() || 0);
  const card = Number(this.splitCardAmount() || 0);
  const cash = Number(this.splitCashAmount() || 0);

  if (parseFloat((cash + card).toFixed(2)) !== parseFloat(total.toFixed(2))) {
    this.flashFeedback('⚠️ Το άθροισμα Μετρητών + Κάρτας δεν ισούται με το σύνολο!', 'error');
    return;
  }

  try {
    const cashierName = this.shiftService.currentCashier()?.name || 'Ταμίας';
    
    // Checkout on cart (records Split in transaction DB)
    const tx = await this.cart.checkout('Split' as any, cashierName, total, 0);

    // Record with explicit breakdown into drawer & card batches
    await this.shiftService.recordSaleToShift(total, 'SPLIT', false, { cash, card });

    this.showPaymentModal.set(false);
    this.splitCardAmount.set(0);

    await this.handleFiscalPostProcessing(tx);
    this.flashFeedback(`✔ Ολοκληρώθηκε: €${cash.toFixed(2)} Μετρητά / €${card.toFixed(2)} Κάρτα`, 'success');
  } catch (err: any) {
    this.flashFeedback('⛔ Σφάλμα μεικτής πληρωμής: ' + (err.message || ''), 'error');
  }
}

  // 10. Notifications & Debounce Locks
  public feedbackMessage = signal<string>('');
  public feedbackType = signal<'success' | 'error' | 'info'>('success');
  private feedbackTimer: any = null;
  private isProcessingScan = false;
  private lastScannedCode = '';
  private lastScannedTimestamp = 0;

  // Computed Values
  public pointsDiscountAmount = computed(() => {
    return Number((this.pointsToRedeem() * this.loyaltyService.pointDiscountValue).toFixed(2));
  });

  public finalPayableAmount = computed(() => {
    const total = this.cart.grandTotal() - this.pointsDiscountAmount();
    return Math.max(0, Number(total.toFixed(2)));
  });

  public changeDue = computed(() => {
    if (this.paymentMethod() !== 'CASH' && this.paymentMethod() !== 'SPLIT') return 0;
    const tendered = this.cashTendered();
    const payable = this.finalPayableAmount();
    return tendered >= payable ? Number((tendered - payable).toFixed(2)) : 0;
  });

  public get currentCashier() {
    return this.shiftService.currentCashier();
  }

  // Lifecycle
  async ngOnInit(): Promise<void> {
    this.loadCustomers();
    await this.catalogService.loadInitialCatalog();
    await this.shiftService.initialize();
    await this.refreshPinnedProducts();
    await this.storageQuotaService.initPersistence();
  }

  ngAfterViewInit(): void {
    this.focusBarcodeInput();
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
  }

  public getActiveCompanyProfile(): MarketCompanyProfile {
    const activeShop = this.tenantConfig.activeShop();
    return {
      storeName: activeShop?.name || 'MARANTH SUPERMARKET',
      address: activeShop?.address || '',
      afm: activeShop?.afm || this.myDataService?.credentials?.()?.issuerAfm || '',
      doy: activeShop?.doy || '',
      phone: activeShop?.phone || ''
    };
  }

  public appendPin(digit: string): void {
    if (this.pinInput().length < 6) {
      this.pinInput.update(p => p + digit);
      this.pinError.set('');
    }
  }

  public clearPin(): void {
    this.pinInput.set('');
    this.pinError.set('');
  }

 public async handlePinSubmit(pin: string): Promise<void> {
    const cleanPin = pin ? pin.trim() : '';
    console.log('[handlePinSubmit TRIGGERED WITH PIN]', cleanPin);

    if (!cleanPin) return;

    const res = await this.shiftService.loginWithPin(cleanPin);
    console.log('[LOGIN WITH PIN RESULT]', res);

    if (res.success) {
      this.pinError.set('');
      this.pinInput.set('');
      this.flashFeedback(res.message, 'success');
      this.focusBarcodeInput();
    } else {
      this.pinError.set(res.message || 'Λάθος PIN. Δοκιμάστε ξανά.');
      this.pinInput.set('');
    }
  }

  public lockTerminal(): void {
    this.showNewShiftModal.set(false);
    this.showShiftHandoverModal.set(false);
    this.shiftService.lockTerminal();
  }

  // Alias in case any template button or modal still calls submitPin directly
  public submitPin(pinFromPad?: string): Promise<void> {
    return this.handlePinSubmit(pinFromPad || this.pinInput());
  }

  public selectCashierForShift(cashier: Cashier): void {
    this.selectedShiftCashierId.set(cashier.id);
    this.nextShiftCashierPin.set('');
    this.nextShiftError.set('');
  }

  public onNextShiftFloatChange(val: any): void {
    const parsed = parseFloat(val);
    this.nextShiftFloat.set(isNaN(parsed) ? 0 : parsed);
  }

  public async confirmStartNewShift(): Promise<void> {
    const pin = this.nextShiftCashierPin().trim();
    const floatAmt = Number(this.nextShiftFloat()) || 0;
    const selectedId = this.selectedShiftCashierId();

    if (!selectedId) {
      this.nextShiftError.set('Παρακαλώ επιλέξτε ταμία.');
      return;
    }

    if (!pin || pin.length < 4) {
      this.nextShiftError.set('Εισάγετε το 4-ψήφιο PIN σας.');
      return;
    }

    // Pass the selected cashier ID explicitly so it logs in the chosen user
    const res = await this.shiftService.loginCashierById(selectedId, pin, floatAmt);

    if (res.success) {
      this.showNewShiftModal.set(false);
      this.selectedShiftCashierId.set('');
      this.nextShiftCashierPin.set('');
      this.nextShiftError.set('');
      this.flashFeedback(`✔ Η βάρδια άνοιξε με μαγιά €${floatAmt.toFixed(2)}`, 'success');
      this.focusBarcodeInput();
    } else {
      this.nextShiftError.set(res.message || 'Λανθασμένο PIN.');
      this.nextShiftCashierPin.set('');
    }
  }

  public switchCashier(): void {
    const confirmSwitch = confirm('Θέλετε να κλειδώσετε το ταμείο για αλλαγή ταμία;');
    if (confirmSwitch) {
      this.shiftService.lockTerminal();
    }
  }

  public confirmSwitch(targetShopCode: string, inputPin: string): boolean {
    const targetShop = this.tenantConfig.registeredShops().find(s => s.code === targetShopCode);
    if (!targetShop) return false;
    return Boolean(targetShop.adminPinHash && inputPin.trim() === targetShop.adminPinHash.trim());
  }

  public async handleStoreSwitch(newStoreCode: string): Promise<void> {
    const prev = this.tenantConfig.activeShop().code;
    if (prev === newStoreCode) {
      this.showStoreModal.set(false);
      return;
    }

    this.shiftService.lockTerminal();
    this.cart.clear();

    this.tenantConfig.switchShop(newStoreCode);
    this.showStoreModal.set(false);

    await this.shiftService.initialize();
    await this.refreshPinnedProducts();

    this.flashFeedback(`Εναλλαγή στο κατάστημα: ${this.tenantConfig.activeShop().name}`, 'info');
  }

  public async handlePrintXReport(): Promise<void> {
    const shift = this.shiftService.currentShift();
    if (!shift) {
      this.flashFeedback('⚠️ Δεν υπάρχει ενεργή βάρδια για έκδοση "Χ".', 'error');
      return;
    }

    try {
      const company = this.getActiveCompanyProfile();
      await this.bridge.printShiftReport({
        ...shift,
        company,
        registerId: this.tenantConfig.activeShop()?.defaultRegister || 'REG-01'
      } as any, 'X');

      this.flashFeedback('✔ Το Ενδιάμεσο Δελτίο "Χ" εκτυπώθηκε!', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[X-Report Bridge Error]', msg);
      this.flashFeedback('⛔ Σφάλμα εκτύπωσης "Χ": ' + msg, 'error');
    } finally {
      this.focusBarcodeInput();
    }
  }

  public printXReportSlip(): Promise<void> {
    return this.handlePrintXReport();
  }

  public onPrintXReport(): Promise<void> {
    return this.handlePrintXReport();
  }

  public async handleShiftClose(countedCash: number = 0): Promise<void> {
    const active = this.shiftService.currentShift();
    if (!active) {
      this.flashFeedback('⚠️ Δεν υπάρχει ενεργή βάρδια προς κλείσιμο.', 'error');
      return;
    }

    try {
      const company = this.getActiveCompanyProfile();
      
      try {
        await this.bridge.printShiftReport({
          ...active,
          company,
          registerId: this.tenantConfig.activeShop()?.defaultRegister || 'REG-01'
        } as any, 'Z');
      } catch (printErr) {
        console.warn('[Z-Report Print Failed, proceeding to close shift]:', printErr);
      }

      const reportSnapshot = await this.shiftService.closeShift(countedCash);
      this.showShiftHandoverModal.set(false);

      const defaultFloat = this.tenantConfig.activeShop()?.defaultFloat ?? 50;
      this.nextShiftFloat.set(defaultFloat);
      this.nextShiftCashierPin.set('');
      this.selectedShiftCashierId.set('');
      this.nextShiftError.set('');
      
      this.shiftService.lockTerminal();
      this.showNewShiftModal.set(true);

      const sign = (reportSnapshot.variance || 0) >= 0 ? '+' : '';
      this.flashFeedback(`✔ Η βάρδια έκλεισε. Διαφορά: ${sign}€${(reportSnapshot.variance || 0).toFixed(2)}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.flashFeedback('⛔ Σφάλμα: ' + msg, 'error');
    }
  }

  public onCloseZReport(countedCash: number = 0): Promise<void> {
    return this.handleShiftClose(countedCash);
  }

  public async executeCashIn(): Promise<void> {
    const amount = this.cashMovementAmount();
    const reason = this.cashMovementReason();

    if (amount <= 0) {
      this.flashFeedback('Εισάγετε έγκυρο ποσό', 'error');
      return;
    }

    await this.shiftService.recordCashMovement('IN', amount, reason);
    this.flashFeedback(`✔ Προστέθηκαν €${amount.toFixed(2)} στο ταμείο`, 'success');
    this.showCashDrawerModal.set(false);
    this.cashMovementAmount.set(0);
    this.focusBarcodeInput();
  }

  public async handleCashLogSubmit(evt: CashLogEvent): Promise<void> {
    await this.shiftService.recordCashMovement(evt.type, evt.amount, evt.reason);
    this.showCashDrawerModal.set(false);
    this.flashFeedback('✔ Καταχωρήθηκε ' + evt.type + ': €' + evt.amount.toFixed(2), 'success');
    this.focusBarcodeInput();
  }

  public handleDenominationConfirm(totalAmount: number): void {
    const shift = this.shiftService.currentShift();
    if (shift) {
      shift.countedCashInDrawer = totalAmount;
    }
    this.showDenominationModal.set(false);
  }

  public openPayment(): void {
    if (this.cart.items().length === 0) return;
    const payable = this.finalPayableAmount();
    this.paymentMethod.set('CASH');
    this.cashTendered.set(Math.ceil(payable) || payable);
    this.cardAmount.set(payable);
    this.isCardProcessing.set(false);
    this.isCompletingSale.set(false);
    this.showPaymentModal.set(true);
  }

  public selectPaymentMethod(method: UiPaymentMethod): void {
    this.paymentMethod.set(method);
    if (method === 'CARD') {
      this.cardAmount.set(this.finalPayableAmount());
      this.cashTendered.set(0);
    } else if (method === 'CASH') {
      this.cashTendered.set(Math.ceil(this.finalPayableAmount()));
      this.cardAmount.set(0);
    } else if (method === 'SPLIT') {
      const half = Number((this.finalPayableAmount() / 2).toFixed(2));
      this.cashTendered.set(half);
      this.cardAmount.set(Number((this.finalPayableAmount() - half).toFixed(2)));
    } else if (this.paymentMethod() === 'DEBIT') {
  // If user typed a name but forgot to hit "+ Προσθήκη", auto-create it now:
  if (!this.selectedCustomerId() && this.customerInputName().trim()) {
    this.createCustomerOnTheFly();
  }

  if (!this.selectedCustomerId()) {
    this.flashFeedback('⚠️ Επιλέξτε ή πληκτρολογήστε όνομα πελάτη για το βερεσέ.', 'error');
    return;
  }
}
  }

  public setTender(amount: number): void {
    this.cashTendered.set(amount);
  }

  public async processCardPayment(): Promise<void> {
    this.isCardProcessing.set(true);
    try {
      const cashierName = this.shiftService.currentCashier()?.name || 
        `Ταμίας [${this.tenantConfig.activeShop()?.code || 'REG'}]`;
      const tx = await this.cart.checkout('Card', cashierName, this.cardAmount(), 0);
      const isSplit = this.paymentMethod() === 'SPLIT';

      await this.shiftService.recordSaleToShift(
  this.cart.grandTotal(),
  this.paymentMethod(), // 'CASH' | 'CARD' | 'SPLIT' | 'DEBIT'
  false,
  isSplit ? { cash: this.cashLogAmount(), card: this.cardAmount() } : undefined
);

      this.isCardProcessing.set(false);
      this.cardTxSuccess.set(true);
      this.showPaymentModal.set(false);

      await this.handleFiscalPostProcessing(tx);
      this.flashFeedback('✔ Card Payment Approved & Recorded', 'success');
    } catch (err: any) {
      this.isCardProcessing.set(false);
      this.flashFeedback('⛔ ' + (err.message || 'Card Payment Failed'), 'error');
    } finally {
      this.focusBarcodeInput();
    }
  }

  public async completeSale(): Promise<void> {
  if (this.isCompletingSale()) return;
  this.isCompletingSale.set(true);

  const uiMethod = this.paymentMethod();
  
  // 1. Properly map all 4 payment types
  const mappedMethod: DbPaymentMethod = 
    uiMethod === 'CARD' ? 'Card' : 
    uiMethod === 'SPLIT' ? 'Split' : 
    uiMethod === 'DEBIT' ? 'Debit' : 'Cash';

  const activeCust = this.loyaltyService?.activeCustomer ? this.loyaltyService.activeCustomer() : null;
  const redeemed = this.pointsToRedeem ? this.pointsToRedeem() : 0;
  
  const cashierName = this.shiftService.currentCashier()?.name || 
    `Ταμίας [${this.tenantConfig.activeShop()?.code || 'REG'}]`;

  // 2. Validate DEBIT customer selection
  if (uiMethod === 'DEBIT') {
    if (!this.selectedCustomerId() && this.customerInputName().trim()) {
      await this.createCustomerOnTheFly();
    }
    if (!this.selectedCustomerId()) {
      this.flashFeedback('⛔ Επιλέξτε ή καταχωρήστε πελάτη για το βερεσέ.', 'error');
      this.isCompletingSale.set(false);
      return;
    }
  }

  try {
    const tx = await this.cart.checkout(
      mappedMethod,
      cashierName,
      this.cashTendered ? this.cashTendered() : 0,
      this.changeDue ? this.changeDue() : 0
    );

    // 3. Compute explicit cash and card breakdown for the shift ledger
    const totalAmount = Number(tx.grandTotal) || 0;
    const isSplit = uiMethod === 'SPLIT';
    const splitDetails = {
      cash: isSplit ? Number(this.cashTendered() || 0) : (uiMethod === 'CASH' ? totalAmount : 0),
      card: isSplit ? Number(this.cardAmount() || 0) : (uiMethod === 'CARD' ? totalAmount : 0)
    };

    // 4. Record to shift with splitDetails
    await this.shiftService.recordSaleToShift(
      totalAmount, 
      mappedMethod, 
      false, 
      splitDetails
    );

    // 5. Update Customer Ledger if DEBIT ("Βερεσέ")
    if (uiMethod === 'DEBIT' && this.selectedCustomerId()) {
      const custId = this.selectedCustomerId()!;
      const customer = await marketDb.customers.get(custId);
      if (customer) {
        const newDebt = parseFloat(((Number(customer.currentDebt) || 0) + totalAmount).toFixed(2));
        await marketDb.customers.update(custId, { currentDebt: newDebt });
        await this.loadCustomers();
      }
    }

    // 6. Reset Form & UI Signals
    this.pointsToRedeem?.set?.(0);
    this.showPaymentModal.set(false);
    this.selectedCustomerId?.set(null);
    this.customerInputName?.set('');
    this.cardAmount?.set(0);
    this.paymentMethod?.set('CASH');

    if (activeCust && this.loyaltyService?.processPostSale) {
      try {
        const { pointsEarned } = await this.loyaltyService.processPostSale(activeCust, tx.grandTotal, redeemed);
        tx.pointsEarned = pointsEarned;
      } catch (loyaltyErr) {
        console.warn('[Loyalty]', loyaltyErr);
      }
    }

    await this.handleFiscalPostProcessing(tx);
    this.flashFeedback('✔ Η πώληση ολοκληρώθηκε!', 'success');
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Sale Error]', errorMsg);
    this.flashFeedback('⛔ Σφάλμα: ' + errorMsg, 'error');
  } finally {
    this.isCompletingSale.set(false);
    this.focusBarcodeInput?.();
  }
}

public combinedPaymentTotal = computed(() => {
  return Number(this.cashLogAmount() || 0) + Number(this.cardAmount() || 0);
});

  private async handleFiscalPostProcessing(tx: TransactionRecord): Promise<void> {
    const companyProfile = this.getActiveCompanyProfile();

    try {
      if (this.myDataService?.transmitReceipt && navigator.onLine) {
        const myDataRes = await this.myDataService.transmitReceipt(tx, companyProfile);
        if (myDataRes?.success && myDataRes?.mark) {
          tx.mydataMark = myDataRes.mark;
          tx.mydataUid = myDataRes.uid;
          tx.mydataQrUrl = myDataRes.qrUrl;
        }
      } else {
        tx._syncStatus = 'dirty';
      }
    } catch (fiscalErr: unknown) {
      const msg = fiscalErr instanceof Error ? fiscalErr.message : String(fiscalErr);
      console.warn('[Fiscal/myDATA] Queued locally:', msg);
      tx._syncStatus = 'dirty';
    }

    try {
      await marketDb.transactions.put(tx);
    } catch (dbErr) {
      console.error('[DB] Failed updating tx with fiscal data:', dbErr);
    }

    try {
      await this.bridge.printReceipt({
        tx,
        company: companyProfile
      });
    } catch (printErr: unknown) {
      const msg = printErr instanceof Error ? printErr.message : String(printErr);
      console.warn('[Printer] Receipt print bypassed:', msg);
    }
  }

  public openEmployeeModal(): void {
    this.employeeForm = {
      name: '',
      pin: '',
      role: 'CASHIER',
      storeId: this.tenantConfig.activeShop().code || 'mar-market'
    };
    this.showEmployeeModal.set(true);
  }

  public async handleSaveEmployee(): Promise<void> {
    if (this.isSavingEmployee()) return;

    const data = this.employeeForm;
    const cleanPin = data.pin.trim();
    if (!data.name.trim()) {
      alert('Συμπληρώστε όνομα υπαλλήλου.');
      return;
    }
    if (!cleanPin || cleanPin.length < 4) {
      alert('Το PIN πρέπει να είναι τουλάχιστον 4 ψηφία.');
      return;
    }

    const currentShopAdminPin = this.tenantConfig.activeShop()?.adminPinHash;
    if (currentShopAdminPin && cleanPin === currentShopAdminPin.trim()) {
      alert('Το PIN αυτό είναι δεσμευμένο ως διαχειριστικό PIN του καταστήματος.');
      return;
    }

    this.isSavingEmployee.set(true);

    try {
      const res = await this.shiftService.createCashier({
        name: data.name.trim(),
        pin: cleanPin,
        role: data.role,
        storeId: this.tenantConfig.activeShop().code || 'mar-market',
        isActive: true
      });

      if (!res.success) {
        alert(res.message);
        return;
      }

      this.employeeForm = {
        name: '',
        pin: '',
        role: 'CASHIER',
        storeId: this.tenantConfig.activeShop().code || 'mar-market'
      };
      this.showEmployeeModal.set(false);
      this.flashFeedback(`✔ Ο χρήστης "${data.name}" αποθηκεύτηκε!`, 'success');
    } catch (err) {
      console.error('Save employee error:', err);
      alert('Σφάλμα κατά την αποθήκευση.');
    } finally {
      this.isSavingEmployee.set(false);
      this.focusBarcodeInput();
    }
  }

  public async refreshPinnedProducts(): Promise<void> {
    const activeShopCode = this.tenantConfig.activeShop().code || 'mar-market';
    const all = await marketDb.products.toArray();

    const storeProducts = all.filter(p => {
      const itemStore = p.storeId || 'mar-market';
      return itemStore === activeShopCode && p.isActive !== false;
    });

    const pinned = storeProducts.filter(p => p.isPinned === true || (p.isPinned as any) === 1 || (p.isPinned as any) === 'true');
    this.pinnedProducts.set(pinned.length > 0 ? pinned : storeProducts.slice(0, 24));
  }

  public focusBarcodeInput(): void {
    setTimeout(() => {
      const isAnyModalOpen = this.showQuickRegisterModal() || this.showPaymentModal() || 
                             this.showPriceCheckModal() || this.showCashDrawerModal() || 
                             this.showCustomerModal() || this.showShiftHandoverModal() || 
                             this.showStoreModal() || this.showWeightModal() || 
                             this.showMyDataConfig() || this.showOutOfStockModal() || 
                             this.showEmployeeModal() || this.showDiscountModal() || 
                             this.isNewStoreModalOpen() || 
                             this.shiftService.isLocked();

      if (this.barcodeInputRef?.nativeElement && !isAnyModalOpen) {
        this.barcodeInputRef.nativeElement.focus();
      }
    }, 50);
  }

  public flashFeedback(msg: string, type: 'success' | 'error' | 'info' = 'success'): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackMessage.set(msg);
    this.feedbackType.set(type);
    this.scanFeedback.set(msg);

    this.feedbackTimer = setTimeout(() => {
      this.feedbackMessage.set('');
      this.scanFeedback.set(null);
    }, 2500);
  }

  @HostListener('window:keydown', ['$event'])
  onGlobalKey(event: KeyboardEvent): void {
    const isModalOpen = this.showQuickRegisterModal() || this.showPaymentModal() || 
                        this.showPriceCheckModal() || this.showCashDrawerModal() || 
                        this.showCustomerModal() || this.showShiftHandoverModal() || 
                        this.showStoreModal() || this.showWeightModal() || 
                        this.showMyDataConfig() || this.showOutOfStockModal() || 
                        this.showEmployeeModal() || this.showDiscountModal() || 
                        this.isNewStoreModalOpen() || 
                        this.shiftService.isLocked();

    if (this.showOutOfStockModal() && (event.key === 'Enter' || event.key === 'Escape')) {
      event.preventDefault();
      this.closeOutOfStockModal();
      return;
    }

    this.scanner.handleGlobalKey(event, isModalOpen, (code) => this.onBarcodeScanned(code));

    if (event.code === 'Space' && !this.showPaymentModal() && this.cart.items().length > 0) {
      const target = event.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'SELECT' && target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        this.openPayment();
      }
    } else if (event.key === 'F2') {
      event.preventDefault();
      this.openPriceCheck();
    } else if (event.key === 'F4') {
      event.preventDefault();
      this.toggleHoldTicket();
    } else if (event.key === 'F12') {
      event.preventDefault();
      this.shiftService.lockScreen();
    }
  }

  public async onBarcodeScanned(explicitCode?: string): Promise<void> {
    const raw = explicitCode || this.searchQuery() || this.barcodeInputRef?.nativeElement?.value || '';
    const code = raw.trim();

    this.searchQuery.set('');
    this.searchResults.set([]);
    if (this.barcodeInputRef?.nativeElement) {
      this.barcodeInputRef.nativeElement.value = '';
    }

    if (!code) {
      this.focusBarcodeInput();
      return;
    }

    const now = Date.now();
    if (this.isProcessingScan || (code === this.lastScannedCode && (now - this.lastScannedTimestamp) < 600)) {
      return;
    }

    this.isProcessingScan = true;
    this.lastScannedCode = code;
    this.lastScannedTimestamp = now;
    this.isBarcodeProcessing.set(true);

    try {
      const res = await this.scanner.resolveBarcode(code);

      if (res.type === 'added') {
        this.flashFeedback(res.message, 'success');
      } else if (res.type === 'blocked') {
        this.flashFeedback(res.message, 'error');
      } else if (res.type === 'weighted_prompt' && res.product) {
        this.promptWeight(res.product);
      } else if (res.type === 'discovered' && res.externalMatch) {
        this.discoveredExternalProduct.set(res.externalMatch);
        this.showQuickRegisterModal.set(true);
      }
    } catch (err) {
      console.error('Barcode resolution error:', err);
    } finally {
      this.isBarcodeProcessing.set(false);
      this.isProcessingScan = false;
      this.focusBarcodeInput();
    }
  }

  public checkExpiryStatus(expireDate?: string): 'VALID' | 'WARNING' | 'EXPIRED' {
    if (!expireDate) return 'VALID';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expireDate);
    exp.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'EXPIRED';
    if (diffDays <= 3) return 'WARNING';
    return 'VALID';
  }

  public onSearchEnter(): void {
    const query = this.searchQuery().trim();
    if (!query) return;
    this.onBarcodeScanned(query);
  }

  public async onSearch(query: string): Promise<void> {
    this.searchQuery.set(query);
    const term = query.trim().toLowerCase();
    
    if (term.length >= 2) {
      const all = this.catalogService.products();
      const matches = all.filter(p =>
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.sku && p.sku.toLowerCase().includes(term)) ||
        (p.id && String(p.id).toLowerCase() === term)
      ).slice(0, 12);
      this.searchResults.set(matches);
    } else {
      this.searchResults.set([]);
    }
  }

  public selectProduct(product: Product): void {
    const currentStock = product.stockQuantity ?? 0;

    if (currentStock <= 0) {
      this.outOfStockProduct.set(product);
      this.showOutOfStockModal.set(true);
      this.searchQuery.set('');
      this.searchResults.set([]);
      return;
    }

    const currentInCart = this.cart.items().find(i => (i.product.id || i.product.barcode) === (product.id || product.barcode))?.quantity || 0;
    if (!product.isWeighted && (currentInCart + 1) > currentStock) {
      this.outOfStockProduct.set(product);
      this.showOutOfStockModal.set(true);
      this.searchQuery.set('');
      this.searchResults.set([]);
      return;
    }

    if (product.isWeighted) {
      this.promptWeight(product);
    } else {
      this.cart.addItem(product, 1);
    }

    this.searchQuery.set('');
    this.searchResults.set([]);
    this.focusBarcodeInput();
  }

  public openCartDiscountModal(): void {
    this.discountScope.set('CART');
    this.selectedDiscountItem.set(null);
    this.customDiscountInput.set(this.cart.cartDiscountPercent() || 10);
    this.showDiscountModal.set(true);
  }

  public openItemDiscountModal(item: CartItem): void {
    this.discountScope.set('ITEM');
    this.selectedDiscountItem.set(item);
    this.customDiscountInput.set(item.discountPercent || 10);
    this.showDiscountModal.set(true);
  }

  public applyDiscount(percent: number): void {
    if (this.discountScope() === 'CART') {
      this.cart.setCartDiscount(percent);
      this.flashFeedback(percent > 0 ? `✔ Έκπτωση Καλαθιού: ${percent}%` : 'Καθαρισμός Έκπτωσης', 'success');
    } else if (this.selectedDiscountItem()) {
      const prod = this.selectedDiscountItem()!.product;
      this.cart.setItemDiscount(prod.id || prod.barcode, percent);
      this.flashFeedback(percent > 0 ? `✔ Έκπτωση ${percent}% στο "${prod.name}"` : 'Καθαρισμός Έκπτωσης', 'success');
    }
    this.showDiscountModal.set(false);
    this.focusBarcodeInput();
  }

  public closeOutOfStockModal(): void {
    this.showOutOfStockModal.set(false);
    this.outOfStockProduct.set(null);
    this.focusBarcodeInput();
  }

  public promptWeight(product: Product): void {
    this.activeWeightedProduct.set(product);
    this.inputWeightKg.set(1.0);
    this.showWeightModal.set(true);
  }

  public confirmWeight(): void {
    const product = this.activeWeightedProduct();
    if (product && this.inputWeightKg() > 0) {
      const stock = product.stockQuantity ?? 0;
      if (this.inputWeightKg() > stock) {
        this.flashFeedback(`⚠️ Μη επαρκές απόθεμα (${stock.toFixed(3)} kg διαθέσιμα)`, 'error');
        return;
      }

      this.cart.addProduct(product, this.inputWeightKg());
      this.showWeightModal.set(false);
      this.activeWeightedProduct.set(null);
      this.flashFeedback('✔ ' + product.name + ' (' + this.inputWeightKg() + ' kg)', 'success');
      this.focusBarcodeInput();
    }
  }

  public async handleQuickRegisterConfirmed(evt: QuickRegisterConfirmEvent): Promise<void> {
    const registered = await this.catalogService.autoRegisterProduct(evt);
    this.showQuickRegisterModal.set(false);
    this.discoveredExternalProduct.set(null);
    this.cart.addProduct(registered);
    await this.refreshPinnedProducts();
    this.flashFeedback('✔ Προστέθηκε: ' + registered.name + ' (€' + registered.price.toFixed(2) + ')', 'success');
    this.focusBarcodeInput();
  }

  public handleQuickRegisterCancelled(): void {
    this.showQuickRegisterModal.set(false);
    this.discoveredExternalProduct.set(null);
    this.focusBarcodeInput();
  }

  public handlePriceCheckAddToCart(product: Product): void {
    if (product.isWeighted) {
      this.promptWeight(product);
    } else {
      this.cart.addProduct(product);
      this.flashFeedback('✔ ' + product.name, 'success');
    }
    this.showPriceCheckModal.set(false);
    this.focusBarcodeInput();
  }

  public handlePriceCheckClose(): void {
    this.showPriceCheckModal.set(false);
    this.priceCheckInput.set('');
    this.focusBarcodeInput();
  }

  public async onCustomerSearch(phone: string): Promise<void> {
    if (phone.trim().length >= 3) {
      const results = await this.loyaltyService.searchByPhone(phone);
      this.customerSearchResults.set(results);
    } else {
      this.customerSearchResults.set([]);
    }
  }

  public async handleCustomerQuickAdd(evt: { phone: string; name: string }): Promise<void> {
    const cust = await this.loyaltyService.quickRegisterCustomer(evt.phone, evt.name);
    this.loyaltyService.activeCustomer.set(cust);
    this.showCustomerModal.set(false);
    this.flashFeedback('✔ Νέος Πελάτης: ' + cust.name, 'success');
    this.focusBarcodeInput();
  }

  public selectCustomer(cust: Customer): void {
    this.loyaltyService.activeCustomer.set(cust);
    this.showCustomerModal.set(false);
    this.flashFeedback('✔ Επιλέχθηκε: ' + cust.name + ' (' + cust.loyaltyPoints + ' πόντοι)', 'success');
    this.focusBarcodeInput();
  }

  public toggleHoldTicket(): void {
    if (this.cart.items().length > 0) {
      this.cart.holdCurrentTicket();
      this.flashFeedback('Ticket Held (Parked)', 'success');
    } else if (this.cart.heldTickets().length > 0) {
      this.cart.recallLastTicket();
      this.flashFeedback('Held Ticket Recalled', 'success');
    }
    this.focusBarcodeInput();
  }

  public openPriceCheck(): void {
    this.priceCheckInput.set('');
    this.showPriceCheckModal.set(true);
  }

  public openCustomerModal(): void {
    this.customerSearchResults.set([]);
    this.showCustomerModal.set(true);
  }

  public openCashDrawerModal(type: 'IN' | 'OUT' | 'FLOAT' | 'DROP' = 'IN'): void {
    this.cashLogType.set(type);
    this.showCashDrawerModal.set(true);
  }

  public async openShiftHandover(): Promise<void> {
    const current = this.shiftService.currentCashier();
    if (!this.shiftService.currentShift() && current) {
      await this.shiftService.ensureActiveShiftForCashier(current);
    }
    this.showShiftHandoverModal.set(true);
  }

  public navigateToSpoilage(): void {
    this.router.navigate(['/spoilage']);
  }

  public navigateToZReport(): void {
    this.router.navigate(['/z-report']);
  }

  public navigateToInventory(): void {
    this.router.navigate(['/inventory']);
  }

  public navigateToLabels(): void {
    this.router.navigate(['/labels']);
  }

  public onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.onerror = null;
      img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%2364748b" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2" stroke="%2310b981"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
    }
  }

  public async triggerManualSync(): Promise<void> {
    if (!this.syncService.isOnline() || this.syncService.isSyncing()) {
      return;
    }
    await this.syncService.syncAll();
  }

  public async handleForceCatalogPull(): Promise<void> {
    try {
      const total = await this.syncService.forcePullCatalog();
      alert(`Ο κατάλογος ενημερώθηκε επιτυχώς! Λήφθηκαν ${total} προϊόντα.`);
    } catch (error) {
      alert('Σφάλμα κατά την πλήρη λήψη του καταλόγου.');
      console.error(error);
    }
  }
}