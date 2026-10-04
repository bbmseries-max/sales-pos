import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Cashier, CashierRole } from '../../../../core/models/cashier-shift.model';

export interface NewCashierPayload {
  name: string;
  pin: string;
  role: CashierRole;
  storeId: string;
}

@Component({
  selector: 'app-pos-employee-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-employee-modal.component.html'
})
export class PosEmployeeModalComponent {
  @Input({ required: true }) isOpen = false;
  @Input() cashiers: Cashier[] = [];
  @Input() defaultStoreId = 'SHOP-01';

  @Output() close = new EventEmitter<void>();
  @Output() saveEmployee = new EventEmitter<NewCashierPayload>();
  @Output() toggleCashier = new EventEmitter<{ cashierId: string; status: boolean }>();

  public form = signal<NewCashierPayload>({
    name: '',
    pin: '',
    role: 'CASHIER',
    storeId: this.defaultStoreId
  });

  public handleSave(): void {
    const data = this.form();
    if (!data.name.trim()) {
      alert('Εισάγετε όνομα υπαλλήλου.');
      return;
    }
    if (!data.pin.trim() || data.pin.length < 4) {
      alert('Εισάγετε τουλάχιστον 4-ψήφιο PIN.');
      return;
    }

    this.saveEmployee.emit({ ...data });
    this.form.set({
      name: '',
      pin: '',
      role: 'CASHIER',
      storeId: this.defaultStoreId
    });
  }
}