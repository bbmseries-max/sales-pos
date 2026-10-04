import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Customer } from '../../../../../core/models/market.models';
import { UiPaymentMethod } from '../../../pos.component';

export interface PaymentCompletionEvent {
  method: UiPaymentMethod;
  cashTendered: number;
  changeDue: number;
  splitDetails?: { cash: number; card: number };
  customerId?: string;
  newCustomerName?: string;
}

@Component({
  selector: 'app-pos-payment-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-payment-modal.component.html'
})
export class PosPaymentModalComponent {
  @Input({ required: true }) isOpen = false;
  @Input({ required: true }) totalAmount = 0;
  @Input() customers: Customer[] = [];
  @Input() isProcessing = false;

  @Output() close = new EventEmitter<void>();
  @Output() completePayment = new EventEmitter<PaymentCompletionEvent>();

  // Payment State
  public paymentMethod = signal<UiPaymentMethod>('CASH');
  public cashTendered = signal<number>(0);
  public cardAmount = signal<number>(0);

  // Customer Debt ("Βερεσέ") state
  public selectedCustomerId = signal<string | null>(null);
  public customerInputName = signal<string>('');

  // Computed Values
  public cashRemainder = computed(() => {
    const total = this.totalAmount;
    if (this.paymentMethod() === 'CASH') return total;
    if (this.paymentMethod() === 'CARD' || this.paymentMethod() === 'DEBIT') return 0;
    const card = this.cardAmount();
    return Math.max(0, parseFloat((total - card).toFixed(2)));
  });

  public changeDue = computed(() => {
    if (this.paymentMethod() !== 'CASH') return 0;
    const tendered = this.cashTendered();
    const total = this.totalAmount;
    return tendered >= total ? parseFloat((tendered - total).toFixed(2)) : 0;
  });

  public isSplitBalanced = computed(() => {
    const sum = parseFloat((this.cashRemainder() + this.cardAmount()).toFixed(2));
    return Math.abs(sum - this.totalAmount) < 0.01;
  });

  // Split Helpers
  public setSplitExactCard(amount: number): void {
    const valid = Math.min(Math.max(0, Number(amount) || 0), this.totalAmount);
    this.cardAmount.set(parseFloat(valid.toFixed(2)));
  }

  public setSplitExactCash(amount: number): void {
    const validCash = Math.min(Math.max(0, Number(amount) || 0), this.totalAmount);
    this.cardAmount.set(parseFloat((this.totalAmount - validCash).toFixed(2)));
  }

  public splitHalf(): void {
    this.cardAmount.set(parseFloat((this.totalAmount / 2).toFixed(2)));
  }

  public setTender(amount: number): void {
    this.cashTendered.set(amount);
  }

  public handleCancel(): void {
    this.close.emit();
  }

  public handleSubmit(): void {
    const method = this.paymentMethod();

    if (method === 'CASH' && this.cashTendered() > 0 && this.cashTendered() < this.totalAmount) {
      alert('Τα χρήματα δεν επαρκούν!');
      return;
    }

    if (method === 'SPLIT' && !this.isSplitBalanced()) {
      alert('Το άθροισμα Μετρητών και Κάρτας δεν καλύπτει ακριβώς το συνολικό ποσό!');
      return;
    }

    if (method === 'DEBIT' && !this.selectedCustomerId() && !this.customerInputName().trim()) {
      alert('Επιλέξτε ή πληκτρολογήστε όνομα πελάτη για το βερεσέ.');
      return;
    }

    const payload: PaymentCompletionEvent = {
      method,
      cashTendered: method === 'CASH' ? (this.cashTendered() || this.totalAmount) : this.cashRemainder(),
      changeDue: this.changeDue(),
      splitDetails: method === 'SPLIT' ? { cash: this.cashRemainder(), card: this.cardAmount() } : undefined,
      customerId: this.selectedCustomerId() || undefined,
      newCustomerName: this.customerInputName().trim() || undefined
    };

    this.completePayment.emit(payload);
  }
}