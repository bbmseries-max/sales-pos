import { Injectable, signal } from '@angular/core';
import { TransactionRecord, CashierShift, CashLog, MarketCompanyProfile, SpoilageLog } from '../models';

@Injectable({ providedIn: 'root' })
export class EscPosPrinterService {
  public isConnected = signal<boolean>(false);
  private port: any = null;
  private device: any = null;

  /**
   * Transliterate Greek UTF-8 characters to clean ASCII for POS thermal printers
   */
  public transliterateGreek(text: string): string {
    const map: Record<string, string> = {
      'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'TH',
      'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P',
      'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F', 'Χ': 'X', 'Ψ': 'PS', 'Ω': 'O',
      'ά': 'a', 'έ': 'e', 'ή': 'i', 'ί': 'i', 'ό': 'o', 'ύ': 'y', 'ώ': 'o', 'ϊ': 'i',
      'ϋ': 'y', 'ΐ': 'i', 'ΰ': 'y', 'ς': 's',
      'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th',
      'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p',
      'ρ': 'r', 'σ': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'x', 'ψ': 'ps', 'ω': 'o'
    };

    return (text || '').split('').map(char => map[char] ?? char).join('');
  }

  public sanitizeGreek(text: string): string {
    return this.transliterateGreek(text);
  }

  /**
   * Build standard ESC/POS QR Code byte instructions
   */
  public buildEscPosQrCode(content: string, moduleSize: number = 4): number[] {
    const qrBytes: number[] = [];
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const len = data.length + 3;
    const pL = len % 256;
    const pH = Math.floor(len / 256);

    qrBytes.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    qrBytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.min(Math.max(moduleSize, 1), 8));
    qrBytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x32);
    qrBytes.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    for (let i = 0; i < data.length; i++) {
      qrBytes.push(data[i]);
    }
    qrBytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);
    return qrBytes;
  }

  /**
   * Safe binary dispatcher for thermal printers (Web Serial / WebUSB / Dev Log)
   */
 public async dispatchPrint(data: Uint8Array): Promise<boolean> {
    try {
      // 1. Web Serial Port if already connected and open
      if (this.port && this.port.writable) {
        const writer = this.port.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
        return true;
      }

      // 2. WebUSB Device if already connected and open
      if (this.device && this.device.opened) {
        await this.device.transferOut(1, data);
        return true;
      }

      // 3. Fallback: Log simulation buffer without crashing
      console.info(`[EscPosPrinter] Thermal print payload ready (${data.length} bytes).`);
      return true;
    } catch (err) {
      console.warn('[EscPosPrinter] Hardware dispatch skipped:', err);
      return false;
    }
  }

  public async printViaSerial(data: Uint8Array): Promise<boolean> {
    // Only attempt serial write if a port is already active; do not block with unconfigured popups
    if (this.port && this.port.writable) {
      try {
        const writer = this.port.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
        return true;
      } catch (err) {
        console.warn('[EscPosPrinter] Serial write failed:', err);
        return false;
      }
    }
    return false;
  }

  public async printRaw(data: Uint8Array): Promise<void> {
    await this.dispatchPrint(data);
  }

  /**
   * Standard Fiscal Retail Receipt
   */
  public buildEscPosReceipt(
    tx: TransactionRecord,
    profile?: Partial<MarketCompanyProfile>,
    options: { paperWidth?: number; openDrawer?: boolean; cutPaper?: boolean } = { paperWidth: 80, openDrawer: true, cutPaper: true }
  ): Uint8Array {
    const bytes: number[] = [];
    const push = (...b: number[]) => bytes.push(...b);
    const pushLine = (text: string) => {
      const clean = this.transliterateGreek(text);
      for (let i = 0; i < clean.length; i++) {
        bytes.push(clean.charCodeAt(i));
      }
      bytes.push(0x0A);
    };

    const lineWidth = options.paperWidth === 58 ? 24 : 32;
    const pad = (left: string, right: string) => {
      const spaces = Math.max(1, lineWidth - left.length - right.length);
      return left + ' '.repeat(spaces) + right;
    };

    push(0x1B, 0x40);

    if (options.openDrawer) {
      push(0x1B, 0x70, 0x00, 0x19, 0xFA);
    }

    push(0x1B, 0x61, 0x01);
    push(0x1B, 0x45, 0x01);
    pushLine(profile?.storeName || 'MARANTH SUPERMARKET');
    push(0x1B, 0x45, 0x00);
    pushLine(profile?.address || 'ATHENS, GREECE');
    pushLine(`AFM: ${profile?.afm || '094123456'} - DOY: ${profile?.doy || 'D ATHINON'}`);
    pushLine('APODEIXI LIANIKIS POLISIS');
    pushLine('='.repeat(lineWidth));
    push(0x1B, 0x61, 0x00);

    pushLine(`PARAST: ${tx.id}`);
    pushLine(`HM/NIA: ${new Date(tx.timestamp).toLocaleString('el-GR')}`);
    if (tx.cashierName) pushLine(`TAMIAS: ${tx.cashierName}`);
    pushLine('-'.repeat(lineWidth));

    for (const item of tx.items) {
      const name = item.product.name.slice(0, 18);
      const total = (item.quantity * item.product.price).toFixed(2);
      pushLine(pad(`${item.quantity}x ${name}`, `EUR ${total}`));
    }
    pushLine('-'.repeat(lineWidth));

    push(0x1B, 0x45, 0x01);
    pushLine(pad('SYNOLO:', `EUR ${tx.grandTotal.toFixed(2)}`));
    push(0x1B, 0x45, 0x00);
    pushLine(pad('TROPOS PLIROMIS:', `${tx.paymentMethod.toUpperCase()}`));

    if (tx.cashTendered !== undefined && tx.cashTendered > 0) {
      pushLine(pad('METRHTA:', `EUR ${tx.cashTendered.toFixed(2)}`));
      pushLine(pad('RESTA:', `EUR ${(tx.changeDue || 0).toFixed(2)}`));
    }

    if (tx.customerName || tx.customerPhone) {
      pushLine('-'.repeat(lineWidth));
      pushLine(`PELATIS: ${tx.customerName || 'PELATIS LIANIKIS'}`);
      pushLine(`THL: ${tx.customerPhone || '—'}`);
      if (tx.pointsEarned !== undefined || tx.pointsRedeemed !== undefined) {
        if ((tx.pointsRedeemed || 0) > 0) pushLine(`EXARGYROSI: -${tx.pointsRedeemed} pts`);
        pushLine(`KERDISMENOI PONTOI: +${tx.pointsEarned || 0} pts`);
      }
    }

    const qrUrl = tx.mydataQrUrl || (tx.mydataMark ? `https://mydatareceipts.aade.gr/verify?mark=${tx.mydataMark}` : '');

    if (qrUrl || tx.mydataMark) {
      pushLine('-'.repeat(lineWidth));
      push(0x1B, 0x61, 0x01);
      push(0x1B, 0x45, 0x01);
      pushLine('AADE myDATA ELEGHOS PARASTIKOY');
      push(0x1B, 0x45, 0x00);

      if (tx.mydataMark) {
        pushLine(`MARK: ${tx.mydataMark}`);
      }
      if (tx.mydataUid) {
        pushLine(`UID: ${tx.mydataUid}`);
      }

      if (qrUrl) {
        pushLine('');
        push(0x1B, 0x61, 0x01);
        const qrCodeBytes = this.buildEscPosQrCode(qrUrl, 4);
        push(...qrCodeBytes);
        pushLine('');
        pushLine('SKANARETE GIA EPIBEBAIOSI');
      }
      push(0x1B, 0x61, 0x00);
    }

    pushLine('\nEYHARISTOUME GIA THN PROTIMHSH!\n');

    if (options.cutPaper !== false) {
      push(0x1D, 0x56, 0x41, 0x10);
    }

    return new Uint8Array(bytes);
  }

  /**
   * Cash In / Out Log Slip
   */
  public buildEscPosCashLogSlip(log: CashLog, profile?: Partial<MarketCompanyProfile>): Uint8Array {
    const bytes: number[] = [];
    const push = (...b: number[]) => bytes.push(...b);
    const pushLine = (text: string) => {
      const clean = this.transliterateGreek(text);
      for (let i = 0; i < clean.length; i++) {
        bytes.push(clean.charCodeAt(i));
      }
      bytes.push(0x0A);
    };

    const lineWidth = 32;
    const pad = (left: string, right: string) => {
      const spaces = Math.max(1, lineWidth - left.length - right.length);
      return left + ' '.repeat(spaces) + right;
    };

    push(0x1B, 0x40);
    push(0x1B, 0x70, 0x00, 0x19, 0xFA);
    push(0x1B, 0x61, 0x01);
    push(0x1B, 0x45, 0x01);
    pushLine(profile?.storeName || 'MARANTH SUPERMARKET');
    push(0x1B, 0x45, 0x00);
    pushLine(log.type === 'IN' ? 'EISROI METRHTON TAMEIOY' : 'EKROI METRHTON TAMEIOY');
    pushLine('================================');
    push(0x1B, 0x61, 0x00);

    pushLine(`HM/NIA: ${new Date(log.timestamp).toLocaleString('el-GR')}`);
    if (log.cashierName) pushLine(`TAMIAS: ${log.cashierName}`);
    pushLine(`AITIA: ${log.reason}`);
    pushLine('-'.repeat(lineWidth));
    push(0x1B, 0x45, 0x01);
    pushLine(pad('POSO:', `EUR ${log.amount.toFixed(2)}`));
    push(0x1B, 0x45, 0x00);

    pushLine('\n\n');
    push(0x1B, 0x61, 0x01);
    pushLine('YPOGRAFI: ....................\n');
    push(0x1D, 0x56, 0x41, 0x10);

    return new Uint8Array(bytes);
  }

  /**
   * Spoilage Protocol Slip
   */
  public buildEscPosSpoilageSlip(log: SpoilageLog, profile?: Partial<MarketCompanyProfile>): Uint8Array {
    const bytes: number[] = [];
    const push = (...b: number[]) => bytes.push(...b);
    const pushLine = (text: string) => {
      const clean = this.transliterateGreek(text);
      for (let i = 0; i < clean.length; i++) {
        bytes.push(clean.charCodeAt(i));
      }
      bytes.push(0x0A);
    };

    const lineWidth = 32;
    const pad = (left: string, right: string) => {
      const spaces = Math.max(1, lineWidth - left.length - right.length);
      return left + ' '.repeat(spaces) + right;
    };

    push(0x1B, 0x40);
    push(0x1B, 0x61, 0x01);
    push(0x1B, 0x45, 0x01);
    pushLine(profile?.storeName || 'MARANTH SUPERMARKET');
    push(0x1B, 0x45, 0x00);
    pushLine('PROTOKOLLO KATASTROFIS / APOLIAS');
    pushLine('================================');
    push(0x1B, 0x61, 0x00);

    pushLine(`AR. PROTOKOLLOU: ${log.id}`);
    pushLine(`HM/NIA: ${new Date(log.timestamp).toLocaleString('el-GR')}`);
    pushLine(`YPEYTHYNOS: ${log.cashierName || 'TAMIAS'}`);
    pushLine(`AITIA: ${log.reason.toUpperCase()}`);
    pushLine('-'.repeat(lineWidth));

    push(0x1B, 0x45, 0x01);
    pushLine(`EIDOS: ${log.name}`);
    push(0x1B, 0x45, 0x00);
    pushLine(`BARCODE: ${log.barcode || '—'}`);
    pushLine(pad('POSOTHTA:', `${log.quantity}`));
    pushLine(pad('KOSTOS MONADOS:', `EUR ${log.unitCost.toFixed(2)}`));
    pushLine(pad('LIANIKI TIMH:', `EUR ${log.retailPrice.toFixed(2)}`));
    pushLine('-'.repeat(lineWidth));

    push(0x1B, 0x45, 0x01);
    pushLine(pad('SYNOLIKO KOSTOS ZHMIAS:', `EUR ${log.totalLossCost.toFixed(2)}`));
    push(0x1B, 0x45, 0x00);

    if (log.notes) {
      pushLine(`PARATIRISEIS: ${log.notes}`);
    }

    pushLine('\n\n');
    push(0x1B, 0x61, 0x01);
    pushLine('YPOGRAFI DIEYTHYNTHI   YPOGRAFI LOGISTIRIOY');
    pushLine('\n....................   ....................\n');

    push(0x1D, 0x56, 0x41, 0x10);
    return new Uint8Array(bytes);
  }

  /**
   * Intermediate Shift Audit (Deltio X)
   */
  public buildEscPosXReport(shift: CashierShift, profile?: Partial<MarketCompanyProfile>): Uint8Array {
    return this.generateShiftAuditReport(shift, 'X', profile);
  }

  /**
   * Final End-of-Day Closing Shift Audit (Deltio Z)
   */
  public buildEscPosZReport(shift: CashierShift, profile?: Partial<MarketCompanyProfile>): Uint8Array {
    return this.generateShiftAuditReport(shift, 'Z', profile);
  }

  /**
   * Unified X/Z Report ESC/POS Generator
   */
  private generateShiftAuditReport(shift: CashierShift, type: 'X' | 'Z', profile?: Partial<MarketCompanyProfile>): Uint8Array {
    const bytes: number[] = [];
    const push = (...b: number[]) => bytes.push(...b);
    const pushLine = (text: string) => {
      const clean = this.transliterateGreek(text);
      for (let i = 0; i < clean.length; i++) {
        bytes.push(clean.charCodeAt(i));
      }
      bytes.push(0x0A);
    };

    const lineWidth = 32;
    const pad = (left: string, right: string) => {
      const spaces = Math.max(1, lineWidth - left.length - right.length);
      return left + ' '.repeat(spaces) + right;
    };

    push(0x1B, 0x40);
    push(0x1B, 0x61, 0x01);
    push(0x1B, 0x45, 0x01);
    pushLine(profile?.storeName || 'MARANTH SUPERMARKET');
    push(0x1B, 0x45, 0x00);
    pushLine(`DELTIO "${type}" - ${type === 'Z' ? 'ORISTIKO KLEISIMO' : 'ENDIAMESI VARIDIA'}`);
    pushLine('ELEGCHOS TAMEIOY & TZIRAS');
    pushLine('================================');
    push(0x1B, 0x61, 0x00);

    pushLine(`TAMIAS: ${shift.cashierName}`);
    pushLine(`KODIKOS: ${shift.id}`);
    pushLine(`ENARXI: ${new Date(shift.startTime).toLocaleString('el-GR')}`);
    if (shift.endTime) {
      pushLine(`LIXI:   ${new Date(shift.endTime).toLocaleString('el-GR')}`);
    }
    pushLine(`EKTYPOSI: ${new Date().toLocaleString('el-GR')}`);
    pushLine('-'.repeat(lineWidth));

    pushLine(pad('ARHIKO TAMEIO (FLOAT):', `EUR ${shift.openingFloat.toFixed(2)}`));
    pushLine(pad('METRHTA ENARXIS:', `EUR ${shift.sales.cash.toFixed(2)}`));
    pushLine(pad('KARTES (POS/EFT):', `EUR ${shift.sales.card.toFixed(2)}`));
    pushLine(pad('EISROES (+):', `EUR ${shift.cashInTotal.toFixed(2)}`));
    pushLine(pad('EKROES (-):', `EUR ${shift.cashOutTotal.toFixed(2)}`));
    pushLine('-'.repeat(lineWidth));

    push(0x1B, 0x45, 0x01);
    pushLine(pad('SYNOLO POLISEON:', `EUR ${shift.sales.totalSales.toFixed(2)}`));
    pushLine(pad('SYNOLO SYNALLAGON:', `${shift.sales.transactionCount}`));
    push(0x1B, 0x45, 0x00);
    pushLine('='.repeat(lineWidth));

    const expected = (shift.openingFloat + shift.sales.cash + shift.cashInTotal - shift.cashOutTotal);
    push(0x1B, 0x45, 0x01);
    pushLine(pad('ANAMENOMENA METRHTA:', `EUR ${expected.toFixed(2)}`));
    push(0x1B, 0x45, 0x00);

    if (shift.countedCashInDrawer !== undefined) {
      pushLine(pad('KATAMETRHSH TAMEIOY:', `EUR ${shift.countedCashInDrawer.toFixed(2)}`));
      const disc = shift.discrepancy || 0;
      const discText = disc >= 0 ? `+EUR ${disc.toFixed(2)} (PLEONASMA)` : `-EUR ${Math.abs(disc).toFixed(2)} (ELLEIMMA)`;
      pushLine(pad('DIAFORA (TAMEIO):', discText));
    }

    pushLine('\n\n');
    push(0x1B, 0x61, 0x01);
    pushLine('YPOGRAFI TAMEIA        YPOGRAFI YPEYTHYNOY');
    pushLine('\n....................   ....................\n');

    push(0x1D, 0x56, 0x41, 0x10);
    return new Uint8Array(bytes);
  }

/**
   * Fixed-Alignment Thermal / Label Slip Dispatcher
   */
  public printHtmlThermalSlip(htmlBody: string): void {
    if (typeof window === 'undefined') return;

    const printWin = window.open('', '_blank', 'width=350,height=550,left=10000,top=10000');
    if (!printWin) {
      console.warn('[Printer] Popup blocked. Please allow popups for this POS site.');
      return;
    }

    printWin.document.open();
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>POS Receipt</title>
          <style>
            @page {
              size: portrait;
              margin: 0;
            }
            *, *:before, *:after {
              box-sizing: border-box;
            }
            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              background: #fff;
              color: #000;
              font-family: 'Courier New', Courier, monospace;
              font-size: 11px;
              line-height: 1.3;
              font-weight: bold;
              text-transform: uppercase;
              -webkit-print-color-adjust: exact;
            }
            .slip-wrapper {
              width: 48mm;
              margin: 0 auto;
              padding: 1mm 1mm 10mm 1mm;
              page-break-inside: avoid;
              page-break-after: avoid;
            }
            .center { text-align: center; }
            .bold { font-weight: 900; }
            .large { font-size: 13px; }
            .divider { border-top: 1px dashed #000; margin: 4px 0; }
            .row { 
              display: flex; 
              justify-content: space-between; 
              align-items: flex-start;
              gap: 2px;
              margin: 2px 0; 
            }
            .row span:first-child {
              flex: 1;
              text-align: left;
              word-break: break-word;
            }
            .row span:last-child {
              text-align: right;
              white-space: nowrap;
            }
            .small { font-size: 9px; }
            
            /* Physical Paper-Feed Buffer to clear the cutter blade */
            .cutter-feed-gap {
              display: block;
              min-height: 25mm;
              height: 25mm;
              line-height: 25mm;
              visibility: visible;
              color: transparent; /* Prevents dot/content from being visible */
            }
          </style>
        </head>
        <body>
          <div class="slip-wrapper">
            ${htmlBody}
            
            <!-- Force physical paper advance past the cutter -->
            <div class="cutter-feed-gap"></div>
          </div>
          <script>
            window.onload = function() {
              window.focus();
              window.print();
              window.onafterprint = function() {
                window.close();
              };
              setTimeout(function() {
                window.close();
              }, 4000);
            };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
  }

  /**
   * Shift Report Generator for X and Z
   */
  public printShiftReportHtml(shift: CashierShift, type: 'X' | 'Z', profile?: Partial<MarketCompanyProfile>): void {
    const storeTitle = this.transliterateGreek(profile?.storeName || 'MARANTH SUPERMARKET');
    const cashier = this.transliterateGreek(shift.cashierName || 'TAMIAS');
    const expected = (shift.openingFloat + (shift.sales?.cash || 0) + (shift.cashInTotal || 0) - (shift.cashOutTotal || 0));

    const slip = `
      <div class="center bold large">${storeTitle}</div>
      <div class="center bold">DELTIO "${type}" - ${type === 'Z' ? 'ORISTIKO KLEISIMO' : 'ENDIAMESI VARIDIA'}</div>
      <div class="divider"></div>
      <div class="small">TAMIAS: ${cashier}</div>
      <div class="small">KODIKOS: ${shift.id}</div>
      <div class="small">ENARXI: ${new Date(shift.startTime).toLocaleString('el-GR')}</div>
      ${shift.endTime ? `<div class="small">LIXI:   ${new Date(shift.endTime).toLocaleString('el-GR')}</div>` : ''}
      <div class="small">EKTYPOSI: ${new Date().toLocaleString('el-GR')}</div>
      <div class="divider"></div>
      <div class="row"><span>FLOAT ENARXIS:</span><span>${(shift.openingFloat || 0).toFixed(2)} &euro;</span></div>
      <div class="row"><span>METRHTA:</span><span>${(shift.sales?.cash || 0).toFixed(2)} &euro;</span></div>
      <div class="row"><span>KARTES (POS):</span><span>${(shift.sales?.card || 0).toFixed(2)} &euro;</span></div>
      <div class="row"><span>EISROES (+):</span><span>${(shift.cashInTotal || 0).toFixed(2)} &euro;</span></div>
      <div class="row"><span>EKROES (-):</span><span>${(shift.cashOutTotal || 0).toFixed(2)} &euro;</span></div>
      <div class="divider"></div>
      <div class="row bold large"><span>TZIRAS:</span><span>${(shift.sales?.totalSales || 0).toFixed(2)} &euro;</span></div>
      <div class="row small"><span>SYNALLAGES:</span><span>${shift.sales?.transactionCount || 0}</span></div>
      <div class="divider"></div>
      <div class="row bold"><span>ANAMENOMENO:</span><span>${expected.toFixed(2)} &euro;</span></div>
      ${shift.countedCashInDrawer !== undefined ? `
        <div class="row"><span>KATAMETRHMENO:</span><span>${shift.countedCashInDrawer.toFixed(2)} &euro;</span></div>
        <div class="row bold"><span>DIAFORA:</span><span>${((shift.discrepancy || 0) >= 0 ? '+' : '') + (shift.discrepancy || 0).toFixed(2)} &euro;</span></div>
      ` : ''}
      <div class="divider"></div>
      <div class="center small">${type === 'Z' ? 'TELOS IMERAS - VARIDIA EKLEISE' : 'PROSORINH ENDIAMESH EKTYPOSI'}</div>
    `;

    this.printHtmlThermalSlip(slip);
  }
}