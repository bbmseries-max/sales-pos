import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Product } from '../../../../core/models/market.models';

@Component({
  selector: 'app-pos-out-of-stock-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pos-out-of-stock-modal.component.html'
})
export class PosOutOfStockModalComponent {
  @Input({ required: true }) isOpen = false;
  @Input() product: Product | null = null;
  @Input() imageUrl = '';

  @Output() close = new EventEmitter<void>();

  public onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) {
      target.style.display = 'none';
    }
  }
}