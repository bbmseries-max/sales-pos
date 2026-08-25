import { 
  Component, 
  inject, 
  signal, 
  computed, 
  OnInit, 
  AfterViewInit, 
  ViewChild, 
  ElementRef, 
  HostListener 
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// Standalone Modals
import { PosLockScreenComponent } from './components/pos-lock-screen.component';
import { PosShiftHandoverModalComponent } from './components/pos-shift-handover-modal.component';
import { PosCustomerModalComponent } from './components/pos-customer-modal.component';
import { PosCashDrawerModalComponent, CashLogEvent } from './components/pos-cash-drawer-modal.component';
import { 
  PosQuickRegisterModalComponent, 
  QuickRegisterConfirmEvent 
} from './components/quick-register-modal.component';
import { PosPriceCheckModalComponent } from './components/pos-price-check-modal.component';
import { PosStoreSwitcherModalComponent } from './components/pos-store-switcher-modal.component';

// Directives & Services
import { BarcodeScannerDirective } from '../../core/directives/barcode-scanner.directive';
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { MarketCatalogService, ExternalProductMatch } from '../../core/services/market-catalog.service';
import { CartService } from '../../core/services/cart.service';
import { ScaleBarcodeService } from '../../core/services/scale-barcode.service';
import { EscPosPrinterService } from '../../core/services/esc-pos-printer.service';
import { MyDataService } from '../../core/services/mydata.service';
import { CustomerLoyaltyService } from '../../core/services/customer-loyalty.service';
import { BarcodeScannerService } from '../../core/services/barcode-scanner.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { marketDb } from '../../core/db/market-db';
import { 
  Product, 
  TransactionRecord, 
  MarketCompanyProfile, 
  Customer
} from '../../core/models';

export type UiPaymentMethod = 'CASH' | 'CARD' | 'SPLIT';
export type DbPaymentMethod = 'Cash' | 'Card' | 'Debit' | 'Split';



@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    BarcodeScannerDirective,
    PosQuickRegisterModalComponent,
    PosPriceCheckModalComponent,
    PosCashDrawerModalComponent,
    PosCustomerModalComponent,
    PosLockScreenComponent,
    PosShiftHandoverModalComponent,
    PosStoreSwitcherModalComponent
  ],
  templateUrl: './pos.component.html'
})
export class PosComponent implements OnInit, AfterViewInit {
  @ViewChild('barcodeInput') barcodeInputRef!: ElementRef<HTMLInputElement>;

  // Core Services
  public catalogService = inject(MarketCatalogService);
  public cart = inject(CartService);
  public scanner = inject(BarcodeScannerService);
  public scaleService = inject(ScaleBarcodeService);
  public printerService = inject(EscPosPrinterService);
  public myDataService = inject(MyDataService);
  public loyaltyService = inject(CustomerLoyaltyService);
  public shiftService = inject(CashierShiftService);
  public tenantConfig = inject(TenantConfigService);
  private router = inject(Router);

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
  public pinError = signal<string>('');
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

  // Feedback Notifications
  public feedbackMessage = signal<string>('');
  public feedbackType = signal<'success' | 'error' | 'info'>('success');
  private feedbackTimer: any = null;

  // Debounce & Re-entry Lock
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

  async ngOnInit(): Promise<void> {
    await this.catalogService.loadInitialCatalog();
    await this.shiftService.initialize();

    const all = await marketDb.products.toArray();
    const pinned = all.filter(p => p.isPinned === true || (p.isPinned as any) === 1 || (p.isPinned as any) === 'true');
    this.pinnedProducts.set(pinned.length > 0 ? pinned : all.slice(0, 24));
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
                             this.showMyDataConfig() || this.shiftService.isLocked();

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
                        this.showMyDataConfig() || this.shiftService.isLocked();

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
    const code = (explicitCode || this.searchQuery() || this.barcodeInputRef?.nativeElement?.value || '').trim();

    this.searchQuery.set('');
    if (this.barcodeInputRef?.nativeElement) {
      this.barcodeInputRef.nativeElement.value = '';
    }

    if (!code) {
      this.focusBarcodeInput();
      return;
    }

    const now = Date.now();
    if (this.isProcessingScan || (code === this.lastScannedCode && (now - this.lastScannedTimestamp) < 400)) {
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

  public onSearchEnter(): void {
    const query = this.searchQuery().trim();
    if (!query) return;

    const exact = this.catalogService.getByBarcode(query) || this.catalogService.getProductByAnyIdentifier(query);
    if (exact) {
      this.selectProduct(exact);
      return;
    }

    const results = this.searchResults();
    if (results.length > 0) {
      this.selectProduct(results[0]);
    } else {
      this.onBarcodeScanned(query);
    }
  }

  public selectProduct(product: Product): void {
    if (product.isWeighted) {
      this.promptWeight(product);
    } else {
      this.cart.addItem(product, 1);
    }
    
    this.searchQuery.set('');
    this.searchResults.set([]);
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

  public async handleStoreSwitch(newStoreCode: string): Promise<void> {
    const prev = this.tenantConfig.activeShop().code;
    if (prev === newStoreCode) {
      this.showStoreModal.set(false);
      return;
    }

    this.cart.clear();
    this.tenantConfig.switchShop(newStoreCode);
    this.showStoreModal.set(false);
    await this.catalogService.loadInitialCatalog();

    const active = this.tenantConfig.activeShop();
    this.flashFeedback(`✔ Ενεργό Κατάστημα: ${active.name} [${active.code}]`, 'success');
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

  public async handlePinSubmit(pin: string): Promise<void> {
    const success = await this.shiftService.unlockWithPin(pin);
    if (!success) {
      this.pinError.set('Λανθασμένο PIN!');
    } else {
      this.pinError.set('');
      this.focusBarcodeInput();
    }
  }

  public async handleShiftClose(countedCash: number): Promise<void> {
    try {
      const closedShift = await this.shiftService.closeShift(countedCash);
      const bytes = this.printerService.buildEscPosXReport(closedShift);
      await this.printerService.printViaSerial(bytes);
      this.showShiftHandoverModal.set(false);
      this.flashFeedback('✔ Η βάρδια έκλεισε. Διαφορά: €' + (closedShift.discrepancy || 0).toFixed(2), 'success');
    } catch (err: any) {
      this.flashFeedback('⛔ Σφάλμα: ' + err.message, 'error');
    }
  }

  public async printXReportSlip(): Promise<void> {
    const shift = this.shiftService.currentShift();
    if (!shift) return;
    const bytes = this.printerService.buildEscPosXReport(shift);
    await this.printerService.printViaSerial(bytes);
    this.flashFeedback('✔ Το Δελτίο "Χ" εκτυπώθηκε!', 'success');
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
    this.paymentMethod.set('CASH');
    this.cashTendered.set(Math.ceil(this.finalPayableAmount()));
    this.cardAmount.set(this.finalPayableAmount());
    this.isCardProcessing.set(false);
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
      this.isCardProcessing.set(false);
      this.cardTxSuccess.set(true);
      this.showPaymentModal.set(false);

      await this.handleFiscalPostProcessing(tx);
      this.flashFeedback('✔ Card Payment Approved', 'success');
    } catch (err: any) {
      this.isCardProcessing.set(false);
      this.flashFeedback('⛔ ' + (err.message || 'Card Payment Failed'), 'error');
    } finally {
      this.focusBarcodeInput();
    }
  }

  public async completeSale(): Promise<void> {
    const uiMethod = this.paymentMethod();
    const mappedMethod: DbPaymentMethod = uiMethod === 'CARD' ? 'Card' : uiMethod === 'SPLIT' ? 'Split' : 'Cash';
    const activeCust = this.loyaltyService.activeCustomer();
    const redeemed = this.pointsToRedeem();
    const cashierName = this.shiftService.currentCashier()?.name || 'Cashier 01';

    try {
      const tx = await this.cart.checkout(
        mappedMethod,
        cashierName,
        this.cashTendered(),
        this.changeDue()
      );

      if (activeCust) {
        tx.customerId = activeCust.id;
        tx.customerPhone = activeCust.phone;
        tx.customerName = activeCust.name;
        tx.pointsRedeemed = redeemed;
        tx.discountApplied = this.pointsDiscountAmount();
        const { pointsEarned } = await this.loyaltyService.processPostSale(activeCust, tx.grandTotal, redeemed);
        tx.pointsEarned = pointsEarned;
      }

      await this.shiftService.recordSaleToShift(tx.grandTotal, mappedMethod as any);
      this.pointsToRedeem.set(0);
      this.showPaymentModal.set(false);

      await this.handleFiscalPostProcessing(tx);
      this.flashFeedback('✔ Η πώληση ολοκληρώθηκε!', 'success');
    } catch (err: any) {
      this.flashFeedback('⛔ Error: ' + err.message, 'error');
    } finally {
      this.focusBarcodeInput();
    }
  }

  private async handleFiscalPostProcessing(tx: TransactionRecord): Promise<void> {
    const companyProfile: MarketCompanyProfile = {
      storeName: 'MARANTH MARKET',
      address: 'Leof. Pentelis 45, Vrilissia',
      afm: this.myDataService.credentials().issuerAfm || '123456789',
      doy: 'XALANDRIOU',
      phone: '210-6800000'
    };

    const myDataRes = await this.myDataService.transmitReceipt(tx, companyProfile);
    if (myDataRes.success && myDataRes.mark) {
      tx.mydataMark = myDataRes.mark;
      tx.mydataUid = myDataRes.uid;
      tx.mydataQrUrl = myDataRes.qrUrl;
      await marketDb.transactions.put(tx);
    }

    const rawBuffer = this.printerService.buildEscPosReceipt(tx);
    await this.printerService.printViaSerial(rawBuffer);
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

  public openShiftHandover(): void {
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
    // Avoid infinite loop if placeholder fails
    img.onerror = null;
    img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%2364748b" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
  }
}
}