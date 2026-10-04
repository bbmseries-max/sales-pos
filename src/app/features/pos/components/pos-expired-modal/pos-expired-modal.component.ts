import { Component, Input, Output, EventEmitter, signal, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Product } from '../../../../core/models';

export interface ExpiredResolutionEvent {
  action: 'PROCEED_AS_IS' | 'UPDATE_DATE_AND_ADD';
  newExpiryDate?: string;
  product: Product;
}

@Component({
  selector: 'app-pos-expired-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-expired-modal.component.html'
})
export class PosExpiredModalComponent implements OnChanges {
  @Input({ required: true }) isOpen = false;
  @Input() product: Product | null = null;

  @Output() resolve = new EventEmitter<ExpiredResolutionEvent>();
  @Output() cancel = new EventEmitter<void>();

  public newDate = signal<string>('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      // Default the date picker to today or 1 month ahead
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      this.newDate.set(nextMonth.toISOString().split('T')[0]);
    }
  }

  public handleUpdateDate(): void {
    if (!this.product || !this.newDate()) return;
    this.resolve.emit({
      action: 'UPDATE_DATE_AND_ADD',
      newExpiryDate: this.newDate(),
      product: this.product
    });
  }

  public handleProceedAsIs(): void {
    if (!this.product) return;
    this.resolve.emit({
      action: 'PROCEED_AS_IS',
      product: this.product
    });
  }
}