import { Directive, EventEmitter, HostListener, Output } from '@angular/core';

@Directive({
  selector: '[appBarcodeScanner]',
  standalone: true
})
export class BarcodeScannerDirective {
  @Output() barcodeScanned = new EventEmitter<string>();

  private buffer: string[] = [];
  private lastKeyTime = Date.now();
  private readonly MAX_DELAY = 50; // Milliseconds between hardware scanner keystrokes

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    // Ignore input if user is manually typing into a standard search text input
    const target = event.target as HTMLElement;
    if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') {
      return;
    }

    const currentTime = Date.now();

    if (currentTime - this.lastKeyTime > this.MAX_DELAY) {
      this.buffer = []; // Reset if keystrokes are slow (human typing)
    }
    this.lastKeyTime = currentTime;

    if (event.key === 'Enter') {
      if (this.buffer.length >= 3) {
        event.preventDefault();
        const fullBarcode = this.buffer.join('');
        this.barcodeScanned.emit(fullBarcode);
      }
      this.buffer = [];
      return;
    }

    // Only capture printable characters
    if (event.key.length === 1) {
      this.buffer.push(event.key);
    }
  }
}