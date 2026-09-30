import { Injectable, signal, OnDestroy } from '@angular/core';
import { 
  BridgeHealthResponse, 
  PrintReceiptPayload, 
  EftChargeRequest, 
  EftChargeResponse 
} from '../models/bridge.model';

@Injectable({
  providedIn: 'root'
})
export class BridgeService implements OnDestroy {
  private readonly baseUrl = 'http://127.0.0.1:18080';
  public isBridgeAvailable = signal<boolean>(false);
  private healthIntervalId: any = null;

  constructor() {
    this.checkBridgeStatus();
    // Periodically re-check bridge status every 15 seconds
    this.healthIntervalId = setInterval(() => this.checkBridgeStatus(), 15000);
  }

  ngOnDestroy(): void {
    if (this.healthIntervalId) {
      clearInterval(this.healthIntervalId);
    }
  }

  /**
   * Dispatches shelf labels payload to the bridge daemon for TSPL / thermal roll printing
   */
  public async printShelfLabels(labels: Array<{
    name: string;
    barcode: string;
    price: number;
    unitPrice: number;
    unitMeasure: string;
    vatRate: number;
    brand: string;
  }>): Promise<boolean> {
    if (!this.isBridgeAvailable()) {
      console.warn('[Bridge] Hardware bridge is offline. Falling back to browser print.');
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/printer/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'SHELF_LABELS_TSPL',
          labels,
          printedAt: new Date().toISOString()
        })
      });
      return res.ok;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Bridge] Shelf labels printing failed:', msg);
      return false;
    }
  }

  /**
   * Health ping to maranth-bridge.exe
   */
  public async checkBridgeStatus(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error('Bridge unreachable');
      const data: BridgeHealthResponse = await res.json();
      const online = data.status === 'ready';

      this.isBridgeAvailable.set(online);
      return online;
    } catch {
      clearTimeout(timeoutId);
      this.isBridgeAvailable.set(false);
      return false;
    }
  }

  /**
   * Send print payload to maranth-bridge.exe
   */
  public async printReceipt(payload: PrintReceiptPayload | any): Promise<boolean> {
    if (!this.isBridgeAvailable()) {
      // In demo mode or when bridge is closed, bypass silently without freezing the screen
      console.warn('[Bridge] maranth-bridge.exe is offline. Print bypassed.');
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/printer/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (err) {
      console.error('[Bridge] Printing failed:', err);
      return false;
    }
  }

  /**
   * Electronic cash drawer kick
   */
  public async openCashDrawer(): Promise<boolean> {
    if (!this.isBridgeAvailable()) return false;

    try {
      const res = await fetch(`${this.baseUrl}/api/printer/open-drawer`, {
        method: 'POST'
      });
      return res.ok;
    } catch {
      return false;
    }
  }

 /**
   * EFT/POS Card Terminal Charge
   */
  public async chargeCard(request: EftChargeRequest): Promise<EftChargeResponse> {
    if (!this.isBridgeAvailable()) {
      return {
        status: 'FAILED',
        success: false,
        message: 'maranth-bridge.exe is offline.',
        authCode: '',
        tid: '',
        mid: '',
        txId: request.invoiceId || '',
        referenceNumber: ''
      } as unknown as EftChargeResponse;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/eft/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      return await res.json();
    } catch (err: any) {
      return {
        status: 'ERROR',
        success: false,
        message: err.message || 'EFT communication error',
        authCode: '',
        tid: '',
        mid: '',
        txId: request.invoiceId || '',
        referenceNumber: ''
      } as unknown as EftChargeResponse;
    }
  }

  /**
   * Print X or Z Shift Report via maranth-bridge.exe
   */
  public async printShiftReport(shift: any, reportType: 'X' | 'Z'): Promise<boolean> {
    if (!this.isBridgeAvailable()) {
      console.warn(`[Bridge] Offline. ${reportType}-Report printing bypassed.`);
      return false;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/printer/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'SHIFT_REPORT',
          reportType,
          shift,
          printedAt: new Date().toISOString()
        })
      });
      return res.ok;
    } catch (err) {
      console.error(`[Bridge] ${reportType}-Report printing failed:`, err);
      return false;
    }
  }
}