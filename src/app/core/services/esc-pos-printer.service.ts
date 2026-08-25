import { Injectable, signal } from '@angular/core';
import { TransactionRecord, CashierShift, CashLog, MarketCompanyProfile, SpoilageLog } from '../models';

@Injectable({ providedIn: 'root' })
export class EscPosPrinterService {
  public isConnected = signal<boolean>(false);
  private port: any = null;
  private device: any = null;

  /**
   * Transliterates Greek text to ASCII Latin to prevent thermal character corruption
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
   * Generates standard ESC/POS bytes for 2D QR Code (Model 2, Error Correction level M)
   * Commands: GS ( k <Function 165, 167, 169, 180, 181>
   */
  public buildEscPosQrCode(content: string, moduleSize: number = 4): number[] {
    const qrBytes: number[] = [];
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const len = data.length + 3;
    const pL = len % 256;
    const pH = Math.floor(len / 256);

    // 1. Set QR Code Model (Model 2 is universal standard)
    // GS ( k 04 00 31 41 32 00
    qrBytes.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);

    // 2. Set Module (Dot) Size (1 to 16, default 4 dots for 80mm paper)
    // GS ( k 03 00 31 43 n
    qrBytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.min(Math.max(moduleSize, 1), 8));

    // 3. Set Error Correction Level (49 = Level L 7%, 50 = Level M 15%, 51 = Level Q 25%, 52 = Level H 30%)
    // GS ( k 03 00 31 45 32
    qrBytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x32);

    // 4. Store Data into QR Code buffer
    // GS ( k pL pH 31 50 30 d1...dk
    qrBytes.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    for (let i = 0; i < data.length; i++) {
      qrBytes.push(data[i]);
    }

    // 5. Print the QR Code from buffer
    // GS ( k 03 00 31 51 30
    qrBytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);

    return qrBytes;
  }

  /**
   * Sends raw binary buffer to Web Serial device
   */
  public async printViaSerial(data: Uint8Array): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && 'serial' in navigator) {
        if (!this.port) {
          this.port = await (navigator as any).serial.requestPort();
          await this.port.open({ baudRate: 9600 });
          this.isConnected.set(true);
        }
        const writer = this.port.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
        return true;
      }
      console.log('⚡ [Web Serial Simulator] Buffer Sent:', data.length, 'bytes');
      return true;
    } catch (err) {
      console.warn('Web Serial print skipped:', err);
      return false;
    }
  }

  public async printRaw(data: Uint8Array): Promise<void> {
    try {
      if (this.device && this.device.opened) {
        await this.device.transferOut(1, data);
        return;
      }
      console.log('⚡ [Raw Buffer] Dispatched:', data.length, 'bytes');
    } catch (err) {
      console.error('Print raw failed:', err);
    }
  }

  /**
   * Generates 80mm ESC/POS byte sequence with AADE myDATA QR Code Verification
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

    // ESC/POS Reset & Init
    push(0x1B, 0x40);

    // Open cash drawer kick pulse if requested
    if (options.openDrawer) {
      push(0x1B, 0x70, 0x00, 0x19, 0xFA);
    }

    // Header (Center & Bold)
    push(0x1B, 0x61, 0x01);
    push(0x1B, 0x45, 0x01);
    pushLine(profile?.storeName || 'MARANTH SUPERMARKET');
    push(0x1B, 0x45, 0x00);
    pushLine(profile?.address || 'ATHENS, GREECE');
    pushLine(`AFM: ${profile?.afm || '094123456'} - DOY: ${profile?.doy || 'D ATHINON'}`);
    pushLine('APODEIXI LIANIKIS POLISIS');
    pushLine('='.repeat(lineWidth));
    push(0x1B, 0x61, 0x00);

    // Transaction Details
    pushLine(`PARAST: ${tx.id}`);
    pushLine(`HM/NIA: ${new Date(tx.timestamp).toLocaleString('el-GR')}`);
    if (tx.cashierName) pushLine(`TAMIAS: ${tx.cashierName}`);
    pushLine('-'.repeat(lineWidth));

    // Items
    for (const item of tx.items) {
      const name = item.product.name.slice(0, 18);
      const total = (item.quantity * item.product.price).toFixed(2);
      pushLine(pad(`${item.quantity}x ${name}`, `EUR ${total}`));
    }
    pushLine('-'.repeat(lineWidth));

    // Grand Total
    push(0x1B, 0x45, 0x01);
    pushLine(pad('SYNOLO:', `EUR ${tx.grandTotal.toFixed(2)}`));
    push(0x1B, 0x45, 0x00);
    pushLine(pad('TROPOS PLIROMIS:', `${tx.paymentMethod.toUpperCase()}`));

    if (tx.cashTendered !== undefined && tx.cashTendered > 0) {
      pushLine(pad('METRHTA:', `EUR ${tx.cashTendered.toFixed(2)}`));
      pushLine(pad('RESTA:', `EUR ${(tx.changeDue || 0).toFixed(2)}`));
    }

    // Customer & Loyalty Block
    if (tx.customerName || tx.customerPhone) {
      pushLine('-'.repeat(lineWidth));
      pushLine(`PELATIS: ${tx.customerName || 'PELATIS LIANIKIS'}`);
      pushLine(`THL: ${tx.customerPhone || '—'}`);
      if (tx.pointsEarned !== undefined || tx.pointsRedeemed !== undefined) {
        if ((tx.pointsRedeemed || 0) > 0) pushLine(`EXARGYROSI: -${tx.pointsRedeemed} pts`);
        pushLine(`KERDISMENOI PONTOI: +${tx.pointsEarned || 0} pts`);
      }
    }

    // ==========================================
    // AADE myDATA FISCAL QR CODE BLOCK
    // ==========================================
    const qrUrl = tx.mydataQrUrl || (tx.mydataMark ? `https://mydatareceipts.aade.gr/verify?mark=${tx.mydataMark}` : '');

    if (qrUrl || tx.mydataMark) {
      pushLine('-'.repeat(lineWidth));
      push(0x1B, 0x61, 0x01);
      push(0x1B, 0x45, 0x01);
      pushLine('AADE myDATA ELEGHOS PARASATIKOY');
      push(0x1B, 0x45, 0x00);

      if (tx.mydataMark) {
        pushLine(`MARK: ${tx.mydataMark}`);
      }
      if (tx.mydataUid) {
        pushLine(`UID: ${tx.mydataUid}`);
      }

      if (qrUrl) {
        pushLine(''); // spacing before QR
        // Center alignment for QR
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
   * Generates 80mm ESC/POS byte sequence for Spoilage / Loss / Damaged Goods Protocol
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

    // ESC/POS Reset & Init
    push(0x1B, 0x40);

    // Header (Center & Bold)
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

  public buildEscPosXReport(shift: CashierShift): Uint8Array {
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
    pushLine('DELTIO "X" - ENDIAMESI VARIDIA');
    push(0x1B, 0x45, 0x00);
    pushLine('ELEGCHOS TAMEIOY & PARADOSI');
    pushLine('================================');
    push(0x1B, 0x61, 0x00);

    pushLine(`TAMIAS: ${shift.cashierName}`);
    pushLine(`KODIKOS: ${shift.id}`);
    pushLine(`ENARXI: ${new Date(shift.startTime).toLocaleString('el-GR')}`);
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
    pushLine('YPOGRAFI PARADIDONTOS   YPOGRAFI PARALAMBANONTOS');
    pushLine('\n....................   ....................\n');

    push(0x1D, 0x56, 0x41, 0x10);
    return new Uint8Array(bytes);
  }
}