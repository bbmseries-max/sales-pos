import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Cashier } from '../../../../core/models/cashier-shift.model';

export interface StartShiftPayload {
  cashierId: string;
  pin: string;
  openingFloat: number;
}

@Component({
  selector: 'app-pos-new-shift-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-new-shift-modal.component.html'
})
export class PosNewShiftModalComponent {
  @Input({ required: true }) isOpen = false;
  @Input() cashiers: Cashier[] = [];
  @Input() errorMessage = '';

  @Output() close = new EventEmitter<void>();
  @Output() lockTerminal = new EventEmitter<void>();
  @Output() startShift = new EventEmitter<StartShiftPayload>();

  public selectedCashierId = signal<string>('');
  public pin = signal<string>('');
  public openingFloat = signal<number>(50.00);

  public selectCashier(c: Cashier): void {
    this.selectedCashierId.set(c.id);
  }

  public setFloatPreset(amount: number): void {
    this.openingFloat.set(amount);
  }

  public handleConfirm(): void {
    const cashierId = this.selectedCashierId();
    if (!cashierId) {
      alert('Επιλέξτε ταμία για την έναρξη βάρδιας.');
      return;
    }
    if (!this.pin().trim()) {
      alert('Εισάγετε το PIN του ταμία.');
      return;
    }

    this.startShift.emit({
      cashierId,
      pin: this.pin().trim(),
      openingFloat: Number(this.openingFloat()) || 0
    });
  }
}