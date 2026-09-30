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
import { StorageQuotaService } from '../../core/services/storage-quota.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NewStoreModalComponent } from '../../shared/new-store-modal.component';
import { SuperAdminModalComponent } from '../../shared/super-admin-modal.component';

// Standalone Modals
import { PosLockScreenComponent } from './components/pos-lock-screen.component';
import { PosDenominationModalComponent } from './components/pos-denomination-modal.component';
import { PosShiftHandoverModalComponent } from './components/pos-shift-handover-modal.component';
import { PosCustomerModalComponent } from './components/pos-customer-modal.component';
import { PosCashDrawerModalComponent, CashLogEvent } from './components/pos-cash-drawer-modal.component';
import { 
  PosQuickRegisterModalComponent, 
  QuickRegisterConfirmEvent 
} from './components/quick-register-modal.component';
import { PosPriceCheckModalComponent } from './components/pos-price-check-modal.component';
import { PosStoreSwitcherModalComponent } from './components/pos-store-switcher-modal.component';

// Services
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { MarketCatalogService, ExternalProductMatch } from '../../core/services/market-catalog.service';
import { CartService } from '../../core/services/cart.service';
import { SyncService } from '../../core/services/sync.service';
import { ScaleBarcodeService } from '../../core/services/scale-barcode.service';
// import { EscPosPrinterService, ReceiptPrintData } from '../../core/services/esc-pos-printer.service';
import { MyDataService } from '../../core/services/mydata.service';
import { CustomerLoyaltyService } from '../../core/services/customer-loyalty.service';
import { BarcodeScannerService } from '../../core/services/barcode-scanner.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { marketDb } from '../../core/db/market-db';
import { ReceiptPrinterService } from '../../core/services/receipt-printer.service';
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

export type UiPaymentMethod = 'CASH' | 'CARD' | 'SPLIT';
export type DbPaymentMethod = 'Cash' | 'Card' | 'Debit' | 'Split';

@Component({
  selector: 'app-pos',
  standalone: true,
  host: {
    'class': 'block w-full h-full min-h-0 min-w-0 overflow-hidden'
  },
  imports: [
    CommonModule, 
    FormsModule,
    PosQuickRegisterModalComponent,
    PosPriceCheckModalComponent,
    PosCashDrawerModalComponent,
    PosCustomerModalComponent,
    PosLockScreenComponent,
    PosShiftHandoverModalComponent,
    PosStoreSwitcherModalComponent,
    SuperAdminModalComponent,
    NewStoreModalComponent,
    PosDenominationModalComponent,
    RouterLink
  ],
  templateUrl: './pos.component.html'
})
export class PosComponent implements OnInit, AfterViewInit {
  @ViewChild('barcodeInput') barcodeInputRef!: ElementRef<HTMLInputElement>;

  public showNewShiftModal = signal<boolean>(false);
  public nextShiftCashierPin = signal<string>('');
  public nextShiftFloat = signal<number>(100);
  public nextShiftError = signal<string>(''); 
  private storageQuotaService = inject(StorageQuotaService);

  public isCompletingSale = signal<boolean>(false);
  public pinInput = signal<string>('');
  public pinError = signal<string>('');
  public openingFloatInput = signal<number>(100);
  public selectedShiftCashierId = signal<string>('');

  public bridge = inject(BridgeService);
  public appendPin(digit: string): void {
    if (this.pinInput().length < 6) {
      this.pinInput.update(p => p + digit);
      this.pinError.set('');
    }
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
      this.feedbackTimer = null;
    }
    if (this.secretClickTimer) {
      clearTimeout(this.secretClickTimer);
      this.secretClickTimer = null;
    }
  }

  public clearPin(): void {
    this.pinInput.set('');
    this.pinError.set('');
  }

  public async submitPin(): Promise<void> {
    const pin = this.pinInput();
    if (!pin) return;

    const res = await this.shiftService.loginWithPin(pin);
    if (res.success) {
      this.clearPin();
      this.flashFeedback(res.message, 'success');
    } else {
      this.pinError.set(res.message);
      this.pinInput.set('');
    }
  }

  public selectCashierForShift(cashier: Cashier): void {
  this.selectedShiftCashierId.set(cashier.id);
  this.nextShiftCashierPin.set('');
  this.nextShiftError.set('');
}

  public async submitPinWithFloat(): Promise<void> {
    const pin = this.pinInput();
    const floatAmt = this.openingFloatInput();

    if (!pin) return;

    const res = await this.shiftService.loginWithPin(pin, floatAmt);
    if (res.success) {
      this.clearPin();
      this.flashFeedback(res.message, 'success');
    } else {
      this.pinError.set(res.message);
    }
  }

  // Core Services
  public cashMovementAmount = signal<number>(0);
  public cashMovementReason = signal<string>('Προσθήκη Μαγιάς / Εισαγωγή');
  public catalogService = inject(MarketCatalogService);
  public cart = inject(CartService);
  public isNewStoreModalOpen = signal<boolean>(false);
  public scanner = inject(BarcodeScannerService);
  public scaleService = inject(ScaleBarcodeService);
  // public printerService = inject(EscPosPrinterService);
  public myDataService = inject(MyDataService);
  private receiptPrinter = inject(ReceiptPrinterService);
  public loyaltyService = inject(CustomerLoyaltyService);
  public shiftService = inject(CashierShiftService);
  public tenantConfig = inject(TenantConfigService);
  private router = inject(Router);
  public syncService = inject(SyncService);
  public showDenominationModal = signal<boolean>(false);

  public get currentCashier() {
    return this.shiftService.currentCashier();
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
  }

  public showEmployeeModal = signal<boolean>(false);
  public isSavingEmployee = signal<boolean>(false);

  // Search & Hardware Barcode State
  public searchQuery = signal<string>('');
  public searchResults = signal<Product[]>([]);
  public pinnedProducts = signal<Product[]>([]);
  public isBarcodeProcessing = signal<boolean>(false);
  public scanFeedback = signal<string | null>(null);

  // Modals Visibility
  public showStoreModal = signal<boolean>(false);
  public showCashDrawerModal = signal<boolean>(false);
  public showCustomerModal = signal<boolean>(false);
  public showPaymentModal = signal<boolean>(false);
  public showPriceCheckModal = signal<boolean>(false);
  public showShiftHandoverModal = signal<boolean>(false);
  public showQuickRegisterModal = signal<boolean>(false);
  public showWeightModal = signal<boolean>(false);
  public showMyDataConfig = signal<boolean>(false);

  // Payloads & Transient States
  public discoveredExternalProduct = signal<ExternalProductMatch | null>(null);
  public priceCheckInput = signal<string>('');
  public priceCheckResult = signal<Product | null>(null);
  public customerSearchResults = signal<Customer[]>([]);
  public activeWeightedProduct = signal<Product | null>(null);
  public inputWeightKg = signal<number>(1.0);
  public countedClosingCash = signal<number>(0);

  // Drawer Fallback Signals
  public cashLogType = signal<'IN' | 'OUT' | 'FLOAT' | 'DROP'>('IN');
  public cashLogAmount = signal<number>(50.0);
  public cashLogReason = signal<string>('');

  // Payment State
  public paymentMethod = signal<UiPaymentMethod>('CASH');
  public cardAmount = signal<number>(0);
  public cashTendered = signal<number>(0);
  public isCardProcessing = signal<boolean>(false);
  public cardTxSuccess = signal<boolean>(false);
  public pointsToRedeem = signal<number>(0);
  public showOutOfStockModal = signal<boolean>(false);
  public outOfStockProduct = signal<Product | null>(null);

  // Discount
  public showDiscountModal = signal<boolean>(false);
  public selectedDiscountItem = signal<CartItem | null>(null);
  public discountScope = signal<'ITEM' | 'CART'>('CART');
  public customDiscountInput = signal<number>(10);

  // Feedback Notifications
  public feedbackMessage = signal<string>('');
  public feedbackType = signal<'success' | 'error' | 'info'>('success');
  private feedbackTimer: any = null;

  // Debounce & Re-entry Lock
  private isProcessingScan = false;
  private lastScannedCode = '';
  private lastScannedTimestamp = 0;

  public isUnlockModalOpen = signal<boolean>(false);
  private secretClickCount = 0;
  private secretClickTimer: any = null;

  public onSecretLogoClick(): void {
    this.secretClickCount++;
    clearTimeout(this.secretClickTimer);

    if (this.secretClickCount >= 5) {
      this.secretClickCount = 0;
      this.isUnlockModalOpen.set(true);
    } else {
      this.secretClickTimer = setTimeout(() => {
        this.secretClickCount = 0;
      }, 1500);
    }
  }

  public async triggerManualSync(): Promise<void> {
    if (!this.syncService.isOnline() || this.syncService.isSyncing()) {
      return;
    }
    await this.syncService.syncAll();
  }

  // Employee Form State
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

  public switchCashier(): void {
    const confirmSwitch = confirm('Θέλετε να κλειδώσετε το ταμείο ή να αλλάξετε ταμία;');
    if (confirmSwitch) {
      this.shiftService.currentCashier.set(null);
      this.shiftService.currentShift.set(null);
      this.shiftService.lockScreen();
    }
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

  async ngOnInit(): Promise<void> {
    await this.catalogService.loadInitialCatalog();
    await this.shiftService.initialize();
    await this.refreshPinnedProducts();
    await this.storageQuotaService.initPersistence();
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

  ngAfterViewInit(): void {
    this.focusBarcodeInput();
  }

  public focusBarcodeInput(): void {
    setTimeout(() => {
      const isAnyModalOpen = this.showQuickRegisterModal() || this.showPaymentModal() || 
                             this.showPriceCheckModal() || this.showCashDrawerModal() || 
                             this.showCustomerModal() || this.showShiftHandoverModal() || 
                             this.showStoreModal() || this.showWeightModal() || 
                             this.showMyDataConfig() || this.showOutOfStockModal() || 
                             this.showEmployeeModal() || this.showDiscountModal() || 
                             this.isUnlockModalOpen() || this.isNewStoreModalOpen() || 
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
                        this.isUnlockModalOpen() || this.isNewStoreModalOpen() || 
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
    if (!data.pin.trim() || data.pin.trim().length < 4) {
      alert('Το PIN πρέπει να είναι τουλάχιστον 4 ψηφία.');
      return;
    }
    

    const reservedPins = this.tenantConfig.registeredShops().map(s => s.adminPin);
    if (cleanPin === '8820' || reservedPins.includes(cleanPin)) {
      alert(`Το PIN "${cleanPin}" είναι δεσμευμένο για την εναλλαγή καταστημάτων.`);
      return;
    }

    this.isSavingEmployee.set(true);

    try {
      const res = await this.shiftService.createCashier({
        name: data.name.trim(),
        pin: data.pin.trim(),
        role: data.role,
        storeId: data.storeId || this.tenantConfig.activeShop().code || 'mar-market',
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

  public async handleCashLogSubmit(evt: CashLogEvent): Promise<void> {
    await this.shiftService.recordCashMovement(evt.type, evt.amount, evt.reason);
    this.showCashDrawerModal.set(false);
    this.flashFeedback('✔ Καταχωρήθηκε ' + evt.type + ': €' + evt.amount.toFixed(2), 'success');
    this.focusBarcodeInput();
  }

  public handleDenominationConfirm(totalAmount: number): void {
    if (this.shiftService?.activeShift()) {
      const shift = this.shiftService.activeShift();
      if (shift) {
        shift.countedCashInDrawer = totalAmount;
      }
    }
    this.showDenominationModal.set(false);
  }

  public async handleStoreSwitch(newStoreCode: string): Promise<void> {
    const prev = this.tenantConfig.activeShop().code;
    if (prev === newStoreCode) {
      this.showStoreModal.set(false);
      return;
    }

    this.cart.clear();
    this.tenantConfig.switchShop(newStoreCode);
    this.showStoreModal.set(false);
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

public async handlePinSubmit(pin: string): Promise<void> {
    const cleanPin = pin.trim();
    if (!cleanPin) return;

    // 1. Delegate directly to shiftService.unlockWithPin
    const success = await this.shiftService.unlockWithPin(cleanPin);

    if (success) {
      this.pinError.set('');
      this.focusBarcodeInput();
    } else {
      this.pinError.set('Λανθασμένο PIN!');
    }
  }

 public async handleShiftClose(countedCash: number): Promise<void> {
    try {
      const active = this.shiftService.currentShift();
      if (active) {
        await this.bridge.printShiftReport(active, 'Z');
      }

      const closedShift = await this.shiftService.closeShift(countedCash);
      this.showShiftHandoverModal.set(false);

      this.shiftService.isLocked.set(false);
      this.nextShiftCashierPin.set('');
      this.nextShiftFloat.set(100);
      this.nextShiftError.set('');
      this.showNewShiftModal.set(true);

      this.flashFeedback('✔ Η βάρδια έκλεισε. Διαφορά: €' + (closedShift.discrepancy || 0).toFixed(2), 'success');
    } catch (err: any) {
      this.flashFeedback('⛔ Σφάλμα: ' + (err?.message || 'Αποτυχία κλεισίματος'), 'error');
    }
  }

  public async printXReportSlip(): Promise<void> {
    const shift = this.shiftService.currentShift();
    if (!shift) return;
    await this.bridge.printShiftReport(shift, 'X');
    this.flashFeedback('✔ Το Δελτίο "Χ" στάλθηκε στον εκτυπωτή!', 'success');
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
    }
  }

  public setTender(amount: number): void {
    this.cashTendered.set(amount);
  }

  public async processCardPayment(): Promise<void> {
    this.isCardProcessing.set(true);
    try {
      const cashierName = this.shiftService.currentCashier()?.name || 'Cashier 01';
      const tx = await this.cart.checkout('Card', cashierName, this.cardAmount(), 0);
      
      await this.shiftService.recordSaleToShift(tx.grandTotal, 'Card');

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
    const mappedMethod: DbPaymentMethod = uiMethod === 'CARD' ? 'Card' : uiMethod === 'SPLIT' ? 'Split' : 'Cash';
    const activeCust = this.loyaltyService?.activeCustomer ? this.loyaltyService.activeCustomer() : null;
    const redeemed = this.pointsToRedeem ? this.pointsToRedeem() : 0;
    const cashierName = this.shiftService?.currentCashier?.()?.name || 'Cashier 01';

    try {
      const tx = await this.cart.checkout(
        mappedMethod,
        cashierName,
        this.cashTendered ? this.cashTendered() : 0,
        this.changeDue ? this.changeDue() : 0
      );

      // Record sale to shift
      await this.shiftService.recordSaleToShift(tx.grandTotal, mappedMethod);

      this.pointsToRedeem?.set?.(0);
      this.showPaymentModal.set(false);

      if (activeCust && this.loyaltyService?.processPostSale) {
        try {
          const { pointsEarned } = await this.loyaltyService.processPostSale(activeCust, tx.grandTotal, redeemed);
          tx.pointsEarned = pointsEarned;
        } catch (loyaltyErr) {
          console.warn('[Loyalty]', loyaltyErr);
        }
      }

      // Fiscal processing & Bridge Printing
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

  private async handleFiscalPostProcessing(tx: TransactionRecord): Promise<void> {
    const activeShop = this.tenantConfig.activeShop?.() || {};
    const companyProfile: MarketCompanyProfile = {
      storeName: activeShop.name || 'MARANTH MARKET',
      address: activeShop.address || 'Leof. Pentelis 45, Vrilissia',
      afm: activeShop.afm || this.myDataService?.credentials?.()?.issuerAfm || '123456789',
      doy: activeShop.doy || 'XALANDRIOU',
      phone: activeShop.phone || '210-6800000'
    };

    // 1. AADE myDATA transmission
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
      console.warn('[Fiscal/myDATA] Transmission skipped or offline, queued locally:', msg);
      tx._syncStatus = 'dirty';
    }

    // 2. Persist updated transaction record with myDATA info
    try {
      await marketDb.transactions.put(tx);
    } catch (dbErr) {
      console.error('[DB] Failed updating tx with fiscal data:', dbErr);
    }

    // 3. Print thermal slip via bridge
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

  public async onPrintXReport(): Promise<void> {
    const active = this.shiftService.currentShift();
    if (active) {
      await this.bridge.printShiftReport(active, 'X');
      this.flashFeedback('✔ Το Δελτίο "Χ" εκτυπώθηκε!', 'success');
    }
  }

  public async onCloseZReport(countedCash: number = 0): Promise<void> {
    const active = this.shiftService.currentShift();
    if (active) {
      await this.bridge.printShiftReport(active, 'Z');
      await this.shiftService.closeShift(countedCash);
      
      this.shiftService.isLocked.set(false);
      this.nextShiftCashierPin.set('');
      this.nextShiftFloat.set(100);
      this.nextShiftError.set('');
      this.showNewShiftModal.set(true);
    }
  }

  public async confirmStartNewShift(): Promise<void> {
  const pin = this.nextShiftCashierPin().trim();
  const floatAmt = Number(this.nextShiftFloat()) || 0;

  if (!this.selectedShiftCashierId()) {
    this.nextShiftError.set('Παρακαλώ επιλέξτε ταμία.');
    return;
  }

  if (!pin || pin.length < 4) {
    this.nextShiftError.set('Εισάγετε το 4-ψήφιο PIN σας.');
    return;
  }

  // Validate the entered PIN against the selected cashier
  const selectedCashier = this.shiftService.allCashiers()
    .find(c => c.id === this.selectedShiftCashierId());

  if (!selectedCashier || selectedCashier.pin !== pin) {
    this.nextShiftError.set('Λανθασμένο PIN για τον επιλεγμένο ταμία.');
    this.nextShiftCashierPin.set('');
    return;
  }

  const res = await this.shiftService.loginWithPin(pin, floatAmt);
  if (res.success) {
    this.showNewShiftModal.set(false);
    this.selectedShiftCashierId.set('');
    this.nextShiftCashierPin.set('');
    this.flashFeedback(`✔ Η βάρδια άνοιξε με μαγιά €${floatAmt.toFixed(2)}`, 'success');
    this.focusBarcodeInput();
  } else {
    this.nextShiftError.set(res.message);
  }
}
}