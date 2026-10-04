import { Component, Input, Output, EventEmitter, signal, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Product } from '../../../../core/models/market.models';

@Component({
  selector: 'app-pos-weight-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-weight-modal.component.html'
})
export class PosWeightModalComponent implements OnChanges {
  @Input({ required: true }) isOpen = false;
  @Input() product: Product | null = null;
  @Input() initialWeight = 1.000;

  @Output() close = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<number>();

  public inputWeightKg = signal<number>(1.000);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.inputWeightKg.set(this.initialWeight || 1.000);
    }
  }

  public setPresetWeight(w: number): void {
    this.inputWeightKg.set(w);
  }

  public handleConfirm(): void {
    const val = Number(this.inputWeightKg()) || 0;
    if (val <= 0) {
      alert('Εισάγετε έγκυρο βάρος μεγαλύτερο του 0.');
      return;
    }
    this.confirm.emit(val);
  }
}