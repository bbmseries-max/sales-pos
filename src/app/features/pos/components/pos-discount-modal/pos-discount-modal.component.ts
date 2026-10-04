import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pos-discount-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-discount-modal.component.html'
})
export class PosDiscountModalComponent {
  @Input({ required: true }) isOpen = false;
  @Input() scope: 'CART' | 'ITEM' = 'CART';

  @Output() close = new EventEmitter<void>();
  @Output() discountApply = new EventEmitter<number>();

  public customDiscount = signal<number>(0);

  public applyPreset(pct: number): void {
    this.discountApply.emit(pct);
  }

  public applyCustom(): void {
    const val = Math.min(Math.max(0, Number(this.customDiscount()) || 0), 100);
    this.discountApply.emit(val);
  }
}