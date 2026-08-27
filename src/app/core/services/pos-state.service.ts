import { Injectable, signal, computed } from '@angular/core';

export type PosViewMode = 'SCANNER' | 'CATALOG_GRID' | 'WEIGHT_MODAL' | 'PAYMENT' | 'DISCOUNT_MODAL';

export interface PeripheralStatus {
  scannerOnline: boolean;
  scaleOnline: boolean;
  printerOnline: boolean;
  eftPosOnline: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PosStateService {
  // Screen Lock & Focus State
  public isScreenLocked = signal<boolean>(true);
  public isBarcodeInputFocused = signal<boolean>(true);

  // Active View / Sub-modal State
  public currentViewMode = signal<PosViewMode>('SCANNER');
  public isProcessingTransaction = signal<boolean>(false);

  // Hardware Peripherals Health
  public peripherals = signal<PeripheralStatus>({
    scannerOnline: true,
    scaleOnline: false,
    printerOnline: false,
    eftPosOnline: false
  });

  // UI Banner / Notification Message
  public alertMessage = signal<{ text: string; type: 'info' | 'success' | 'warning' | 'error' } | null>(null);

  // Computed Check: Can cashier perform barcode scans?
  public canScan = computed(() => {
    return !this.isScreenLocked() && !this.isProcessingTransaction();
  });

  /**
   * Sets the active view mode (e.g., Grid, Weight Modal, Payment)
   */
  public setViewMode(mode: PosViewMode): void {
    this.currentViewMode.set(mode);
  }

  /**
   * Unlocks the POS screen after successful PIN entry
   */
  public unlockScreen(): void {
    this.isScreenLocked.set(false);
    this.currentViewMode.set('SCANNER');
    this.focusBarcodeInput();
  }

  /**
   * Locks the POS register (e.g., cashier step-away or shift closed)
   */
  public lockScreen(): void {
    this.isScreenLocked.set(true);
    this.currentViewMode.set('SCANNER');
  }

  /**
   * Helper to request keyboard focus on the master barcode input element
   */
  public focusBarcodeInput(): void {
    this.isBarcodeInputFocused.set(true);
    setTimeout(() => {
      const inputEl = document.getElementById('pos-barcode-input') as HTMLInputElement | null;
      if (inputEl) {
        inputEl.focus();
      }
    }, 50);
  }

  /**
   * Dispatches temporary top-bar toast or status feedback
   */
  public flashAlert(text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', durationMs = 3000): void {
    this.alertMessage.set({ text, type });
    setTimeout(() => {
      if (this.alertMessage()?.text === text) {
        this.alertMessage.set(null);
      }
    }, durationMs);
  }

  /**
   * Updates hardware connection flags (Scale, ESC/POS Serial, EFT POS)
   */
  public updatePeripheralStatus(patch: Partial<PeripheralStatus>): void {
    this.peripherals.update(current => ({ ...current, ...patch }));
  }
}