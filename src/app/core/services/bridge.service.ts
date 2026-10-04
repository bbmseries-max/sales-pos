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
   * Print X or Z Shift Report via maranth-bridge.exe with automatic browser fallback
   */
  public async printShiftReport(shift: any, reportType: 'X' | 'Z', companyProfile?: any): Promise<boolean> {
    // 1. Try hardware bridge if available
    if (this.isBridgeAvailable()) {
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
        if (res.ok) return true;
      } catch (err) {
        console.error(`[Bridge] ${reportType}-Report printing failed on bridge, falling back:`, err);
      }
    }

    // 2. Fallback to Browser Print Preview if bridge is offline or failed
    console.warn(`[Bridge] Hardware bridge offline. Opening browser preview for ${reportType}-Report.`);
    this.printReportInBrowser(shift, reportType, companyProfile);
    return true;
  }

  private printReportInBrowser(shift: any, reportType: 'X' | 'Z', company?: any): void {
    const printWin = window.open('', '_blank', 'width=460,height=780,menubar=no,toolbar=no,location=no,status=no');
    if (!printWin) {
      console.warn('Popup blocked. Please allow popups for printing.');
      return;
    }

    const title = reportType === 'X' ? 'ΕΝΔΙΑΜΕΣΟ ΔΕΛΤΙΟ "Χ"' : 'ΗΜΕΡΗΣΙΟ ΔΕΛΤΙΟ "Ζ"';
    const storeName = company?.storeName || 'Maranth Market';
    const afm = company?.afm || '-';
    const doy = company?.doy || '-';

    const salesCash = shift.sales?.cash ?? 0;
    const salesCard = shift.sales?.card ?? 0;
    const totalSales = shift.sales?.totalSales ?? 0;
    const count = shift.sales?.transactionCount ?? 0;
    const openingFloat = shift.openingFloat ?? 0;

    const html = `<!DOCTYPE html>
<html lang="el">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    @media print {
      .no-print { display: none !important; }
      body { margin: 0; padding: 0; }
    }
    body {
      font-family: 'Courier New', Courier, monospace;
      width: 76mm;
      margin: 0 auto;
      padding: 10px 5px;
      font-size: 11px;
      color: #000;
      background: #fff;
    }
    .action-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ccc;
    }
    .action-bar button {
      flex: 1;
      padding: 8px 12px;
      font-weight: bold;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid #333;
    }
    .btn-print { background: #2563eb; color: #fff; border-color: #1d4ed8; }
    .btn-close { background: #e5e7eb; color: #111; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    .double-divider { border-top: 2px solid #000; margin: 6px 0; }
    .flex { display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="no-print action-bar">
    <button class="btn-print" onclick="window.print()">Εκτύπωση</button>
    <button class="btn-close" onclick="window.close()">Κλείσιμο</button>
  </div>

  <div class="center bold" style="font-size: 14px;">${storeName}</div>
  <div class="center">ΑΦΜ: ${afm} • ΔΟΥ: ${doy}</div>
  <div class="double-divider"></div>
  <div class="center bold" style="font-size: 15px;">${title}</div>
  <div class="double-divider"></div>
  <div class="flex"><span>ΗΜ/ΝΙΑ: ${new Date().toLocaleDateString('el-GR')}</span><span>ΩΡΑ: ${new Date().toLocaleTimeString('el-GR')}</span></div>
  <div class="flex"><span>ΧΕΙΡΙΣΤΗΣ: ${shift.cashierName || 'Ταμίας'}</span></div>
  <div class="flex"><span>ΑΠΟΔΕΙΞΕΙΣ: ${count}</span></div>
  <div class="divider"></div>
  <div class="flex bold"><span>ΣΥΝΟΛΙΚΕΣ ΠΩΛΗΣΕΙΣ:</span><span>€${Number(totalSales).toFixed(2)}</span></div>
  <div class="divider"></div>
  <div class="bold">ΑΝΑΛΥΣΗ:</div>
  <div class="flex"><span>  ΜΕΤΡΗΤΑ:</span><span>€${Number(salesCash).toFixed(2)}</span></div>
  <div class="flex"><span>  ΚΑΡΤΑ:</span><span>€${Number(salesCard).toFixed(2)}</span></div>
  <div class="double-divider"></div>
  <div class="bold">ΤΑΜΕΙΟ:</div>
  <div class="flex"><span>Αρχικό Ταμείο (Float):</span><span>€${Number(openingFloat).toFixed(2)}</span></div>
  <div class="flex"><span>Εισπράξεις Μετρητών:</span><span>€${Number(salesCash).toFixed(2)}</span></div>
  ${shift.expectedDrawerCash !== undefined ? `<div class="flex"><span>Αναμενόμενο:</span><span>€${Number(shift.expectedDrawerCash).toFixed(2)}</span></div>` : ''}
  ${shift.countedCashInDrawer !== undefined ? `<div class="flex bold"><span>Καταμετρημένο:</span><span>€${Number(shift.countedCashInDrawer).toFixed(2)}</span></div>` : ''}
  ${shift.discrepancy !== undefined ? `<div class="flex bold"><span>ΔΙΑΦΟΡΑ:</span><span>€${Number(shift.discrepancy).toFixed(2)}</span></div>` : ''}
  <div class="double-divider"></div>
  <div class="center" style="margin-top: 8px;">ΤΕΛΟΣ ΔΕΛΤΙΟΥ</div>
</body>
</html>`;

    printWin.document.documentElement.innerHTML = html;
  }
}