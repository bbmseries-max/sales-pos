import { Component, Input, Output, EventEmitter, signal, computed, inject, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { marketDb } from '../../../../core/db/market-db';
import { Customer, MarketCompanyProfile, TransactionRecord } from '../../../../core/models/market.models';
import { CashierShiftService } from '../../../../core/services/cashier-shift.service';

export interface DebitRepaymentEvent {
  customer: Customer;
  amountPaid: number;
  paymentMethod: 'Cash' | 'Card';
  remainingDebt: number;
}

@Component({
  selector: 'app-pos-customer-hub-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-customer-hub-modal.component.html'
})
export class PosCustomerHubModalComponent implements OnChanges {
  @Input({ required: true }) isOpen = false;
  @Input() companyProfile: MarketCompanyProfile | null = null;
  @Input() mode: 'POS' | 'INVENTORY' = 'POS';

  @Output() close = new EventEmitter<void>();
  @Output() selectForCart = new EventEmitter<Customer>();
  @Output() repaymentCompleted = new EventEmitter<DebitRepaymentEvent>();

  private shiftService = inject(CashierShiftService);
  public Number = Number;

  public customers = signal<Customer[]>([]);
  public customerTransactions = signal<TransactionRecord[]>([]);
  public searchQuery = signal<string>('');
  public activeTab = signal<'ALL' | 'DEBTORS' | 'LOYALTY'>('ALL');
  public selectedCustomer = signal<Customer | null>(null);

  // New Customer Form
  public isCreatingCustomer = signal<boolean>(false);
  public newCust = signal<Partial<Customer>>({
    name: '',
    phone: '',
    cardBarcode: '',
    afm: '',
    doy: '',
    address: '',
    notes: '',
    discountRate: 0,
    loyaltyPoints: 0,
    currentDebt: 0,
    maxCreditLimit: 150
  });

  // Debt Settlement Form
  public paymentAmount = signal<number>(0);
  public paymentMethod = signal<'Cash' | 'Card'>('Cash');
  public isSubmitting = signal<boolean>(false);

  // Filtered List
  public filteredCustomers = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tab = this.activeTab();
    let list = this.customers();

    if (tab === 'DEBTORS') {
      list = list.filter(c => Number(c.currentDebt || 0) > 0);
    } else if (tab === 'LOYALTY') {
      list = list.filter(c => Boolean(c.cardBarcode || (c.loyaltyPoints && c.loyaltyPoints > 0)));
    }

    if (q) {
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.cardBarcode || '').toLowerCase().includes(q) ||
        (c.afm || '').toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => (Number(b.currentDebt || 0)) - (Number(a.currentDebt || 0)));
  });

  public totalOutstandingDebt = computed(() => {
    return this.customers().reduce((sum, c) => sum + Number(c.currentDebt || 0), 0);
  });

  public remainingDebtCalculated = computed(() => {
    const cust = this.selectedCustomer();
    if (!cust) return 0;
    const current = Number(cust.currentDebt || 0);
    const paying = Number(this.paymentAmount() || 0);
    return Math.max(0, current - paying);
  });

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['isOpen'] && this.isOpen) {
      await this.loadCustomers();
      this.selectedCustomer.set(null);
      this.customerTransactions.set([]);
      this.isCreatingCustomer.set(false);
      this.paymentAmount.set(0);
    }
  }

  public async loadCustomers(): Promise<void> {
    try {
      const all = await marketDb.customers.toArray();
      this.customers.set(all);
    } catch (err) {
      console.error('[CustomerHub] Error loading customers:', err);
    }
  }

  public async selectCustomer(c: Customer): Promise<void> {
    this.selectedCustomer.set(c);
    this.isCreatingCustomer.set(false);
    this.paymentAmount.set(Number(c.currentDebt || 0));

    // Load transaction history for selected customer
    try {
      const txs = await marketDb.transactions
        .filter(t => t.customerPhone === c.phone || (Boolean(t.customerId) && t.customerId === c.id))
        .reverse()
        .limit(15)
        .toArray();
      this.customerTransactions.set(txs);
    } catch (err) {
      console.warn('[CustomerHub] Could not load customer history:', err);
      this.customerTransactions.set([]);
    }
  }

  public startNewCustomer(): void {
    this.selectedCustomer.set(null);
    this.isCreatingCustomer.set(true);
    this.newCust.set({
      name: '',
      phone: '',
      cardBarcode: '',
      afm: '',
      doy: '',
      address: '',
      notes: '',
      discountRate: 0,
      loyaltyPoints: 0,
      currentDebt: 0,
      maxCreditLimit: 150
    });
  }

  public async saveNewCustomer(): Promise<void> {
    const data = this.newCust();
    if (!data.name?.trim() || !data.phone?.trim()) {
      alert('Το Όνομα και το Τηλέφωνο είναι υποχρεωτικά.');
      return;
    }

    const now = new Date().toISOString();
    const newRecord: Customer = {
      id: 'cust_' + Date.now(),
      phone: data.phone.trim(),
      name: data.name.trim(),
      cardBarcode: data.cardBarcode?.trim() || undefined,
      afm: data.afm?.trim() || undefined,
      doy: data.doy?.trim() || undefined,
      address: data.address?.trim() || undefined,
      notes: data.notes?.trim() || undefined,
      discountRate: Number(data.discountRate || 0),
      loyaltyPoints: Number(data.loyaltyPoints || 0),
      totalSpent: 0,
      totalVisits: 0,
      currentDebt: Number(data.currentDebt || 0),
      maxCreditLimit: Number(data.maxCreditLimit || 150),
      createdAt: now,
      lastVisit: now
    };

    await marketDb.customers.put(newRecord);
    await this.loadCustomers();
    this.isCreatingCustomer.set(false);
    this.selectCustomer(newRecord);
  }

  public attachToCartAndClose(): void {
    const cust = this.selectedCustomer();
    if (cust) {
      this.selectForCart.emit(cust);
      this.close.emit();
    }
  }

  public async handleSettleDebt(): Promise<void> {
    const cust = this.selectedCustomer();
    const amount = Number(this.paymentAmount() || 0);
    if (!cust || amount <= 0 || !cust.id) return;

    this.isSubmitting.set(true);

    try {
      const oldDebt = Number(cust.currentDebt || 0);
      const newDebt = Math.max(0, oldDebt - amount);
      const now = new Date().toISOString();

      // 1. Update Customer Record in Dexie
      await marketDb.customers.update(cust.id, {
        currentDebt: newDebt,
        lastVisit: now
      });

      // 2. If Cash, record drawer movement so drawer reconciliation reflects this intake
     // 2. If Cash, record drawer movement so drawer reconciliation reflects this intake
      if (this.paymentMethod() === 'Cash') {
        const activeShift = this.shiftService.currentShift();
        if (activeShift) {
          await marketDb.cashLogs.add({
            id: 'cash_' + Date.now(),
            type: 'IN',
            amount: amount,
            reason: `Είσπραξη Βερεσέ: ${cust.name}`,
            timestamp: new Date().toISOString(),
            cashierName: this.shiftService.currentCashier()?.name || 'Ταμίας'
          });
        }
      }
      
      // 3. Record Debt Settlement as an audit transaction record
      const settlementTx: TransactionRecord = {
        id: 'PAY-' + Date.now(),
        timestamp: now,
        storeId: this.shiftService.currentShift()?.storeId || 'mar-market',
        items: [],
        subtotal: 0,
        taxAmount: 0,
        grandTotal: amount,
        paymentMethod: this.paymentMethod(),
        cashierName: this.shiftService.currentCashier()?.name || 'Ταμίας',
        cashTendered: amount,
        changeDue: 0,
        customerId: cust.id,
        customerName: cust.name,
        customerPhone: cust.phone,
        _syncStatus: 'dirty'
      };
      await marketDb.transactions.put(settlementTx);

      const eventPayload: DebitRepaymentEvent = {
        customer: cust,
        amountPaid: amount,
        paymentMethod: this.paymentMethod(),
        remainingDebt: newDebt
      };

      // 4. Print physical slip for customer
      this.printRepaymentVoucher(eventPayload, settlementTx.id);

      // 5. Emit event, reload, and refresh detail
      this.repaymentCompleted.emit(eventPayload);
      await this.loadCustomers();

      const freshCust = this.customers().find(c => c.id === cust.id);
      if (freshCust) {
        this.selectCustomer(freshCust);
      }
    } catch (err) {
      console.error('[CustomerHub] Settlement failed:', err);
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private printRepaymentVoucher(data: DebitRepaymentEvent, receiptId: string): void {
    const printWin = window.open('', '_blank', 'width=420,height=620');
    if (!printWin) return;

    const company = this.companyProfile || {
      storeName: 'SUPER MARKET',
      afm: '-',
      doy: '-',
      phone: '-'
    } as any;

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('el-GR');
    const timeFormatted = now.toLocaleTimeString('el-GR');

    printWin.document.open();
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Απόδειξη Είσπραξης #${receiptId}</title>
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
          .double { border-top: 2px solid #000; margin: 6px 0; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 13px;">${company.storeName || 'SUPER MARKET'}</div>
        <div class="center">${company.address || ''}</div>
        <div class="center">ΑΦΜ: ${company.afm || '-'} • ΔΟΥ: ${company.doy || '-'}</div>

        <div class="double"></div>
        <div class="center bold" style="font-size: 12px;">ΕΙДИΚΗ ΑΠΟΔΕΙΞΗ ΕΙΣΠΡΑΞΗΣ</div>
        <div class="center" style="font-size: 9px;">(ΕΞΟΦΛΗΣΗ ΥΠΟΛΟΙΠΟΥ / ΒΕΡΕΣΕ)</div>
        <div class="center" style="font-size: 9px;">ΑΡ. ΠΑΡΑΣΤΑΤΙΚΟΥ: #${receiptId}</div>
        <div class="divider"></div>

        <div class="flex">
          <span>ΗΜ/ΝΙΑ: ${dateFormatted}</span>
          <span>ΩΡΑ: ${timeFormatted}</span>
        </div>
        <div class="flex">
          <span>ΤΑΜΙΑΣ: ${this.shiftService.currentCashier()?.name || 'Ταμίας'}</span>
        </div>

        <div class="divider"></div>
        <div class="bold">ΣΤΟΙΧΕΙΑ ΠΕΛΑΤΗ:</div>
        <div>${data.customer.name}</div>
        <div>Τηλ: ${data.customer.phone}</div>
        ${data.customer.cardBarcode ? `<div>Κάρτα: ${data.customer.cardBarcode}</div>` : ''}

        <div class="divider"></div>
        <div class="flex">
          <span>Προηγούμενη Οφειλή:</span>
          <span>€${(data.amountPaid + data.remainingDebt).toFixed(2)}</span>
        </div>
        <div class="flex bold" style="font-size: 13px; margin: 4px 0;">
          <span>ΠΟΣΟ ΕΙΣΠΡΑΞΗΣ:</span>
          <span>€${data.amountPaid.toFixed(2)}</span>
        </div>
        <div class="flex">
          <span>Τρόπος Πληρωμής:</span>
          <span class="bold">${data.paymentMethod === 'Cash' ? 'ΜΕΤΡΗΤΑ' : 'ΚΑΡΤΑ / POS'}</span>
        </div>

        <div class="double"></div>
        <div class="flex bold" style="font-size: 13px;">
          <span>ΝΕΟ ΥΠΟΛΟΙΠΟ ΟΦΕΙΛΗΣ:</span>
          <span>€${data.remainingDebt.toFixed(2)}</span>
        </div>

        <div class="divider"></div>
        <div class="center" style="font-size: 9px; margin-top: 10px;">Υπογραφή Πελάτη / Ταμία</div>
        <br/><br/>
        <div class="center">___________________________</div>
        <div class="center" style="font-size: 9px; margin-top: 6px;">maranth pos • debit ledger</div>

        <script>
          window.onload = function() { setTimeout(function() { window.print(); }, 200); };
        </script>
      </body>
      </html>
    `);
    printWin.document.close();
  }
}