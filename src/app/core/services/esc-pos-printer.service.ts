import { Injectable, signal } from '@angular/core';
import { TransactionRecord, CashierShift, CashLog, MarketCompanyProfile, SpoilageLog } from '../models';

@Injectable({ providedIn: 'root' })
export class EscPosPrinterService {
  public isConnected = signal<boolean>(false);
  private port: any = null;
  private device: any = null;
  private usbDevice: any = null;
  private usbOutEndpoint: number | null = null;

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
   * Safe binary dispatcher for thermal printers
   */
  public async dispatchPrint(data: Uint8Array): Promise<boolean> {
    try {
      // 1. Web Serial Port if connected
      if (this.port && this.port.writable) {
        const writer = this.port.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
        return true;
      }

      // 2. WebUSB Device if connected and open
      if (this.device && this.device.opened) {
        await this.device.transferOut(1, data);
        return true;
      }

      // 3. Fallback / Dev environment simulation
      console.info(`[EscPosPrinter] Thermal print simulated (${data.length} bytes ready).`);
      return true;
    } catch (err) {
      console.warn('[EscPosPrinter] Hardware dispatch skipped:', err);
      return false;
    }
  }

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
      return true;
    } catch (err) {
      console.warn('Web Serial print skipped:', err);
      return false;
    }
  }

  public async printRaw(data: Uint8Array): Promise<void> {
    await this.dispatchPrint(data);
  }

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
      pushLine('AADE myDATA ELEGHOS PARASATIKOY');
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

  public async connectPrinter(): Promise<boolean> {
    if (typeof window === 'undefined' || !('usb' in navigator)) {
      alert('WebUSB is not supported in this browser. Please use Chrome or Edge.');
      return false;
    }

    try {
      // Request any USB device or filter by known POS/Xprinter vendor IDs
      this.usbDevice = await (navigator as any).usb.requestDevice({
        filters: [] // Empty filter shows all plugged-in USB peripherals (XP-58, POS-58, etc.)
      });

      await this.usbDevice.open();
      
      // Claim the first configuration and interface
      if (this.usbDevice.configuration === null) {
        await this.usbDevice.selectConfiguration(1);
      }
      
      await this.usbDevice.claimInterface(0);

      // Find the Out Endpoint (Bulk Transfer to printer)
      const endpoints = this.usbDevice.configuration.interfaces[0].alternate.endpoints;
      const outEndpoint = endpoints.find((e: any) => e.direction === 'out');
      
      if (!outEndpoint) {
        throw new Error('No OUT endpoint found on USB printer device.');
      }

      this.usbOutEndpoint = outEndpoint.endpointNumber;
      this.isConnected.set(true);
      console.info('[Printer] Connected via WebUSB to:', this.usbDevice.productName);
      return true;
    } catch (err) {
      console.warn('[Printer] USB connection cancelled or failed:', err);
      this.isConnected.set(false);
      return false;
    }
  }

  /**
   * Send 58mm raw ESC/POS test slip via WebUSB
   */
  public async print58mmTestSlip(): Promise<void> {
    if (!this.usbDevice || !this.usbDevice.opened) {
      const connected = await this.connectPrinter();
      if (!connected) return;
    }

    const encoder = new TextEncoder();

    // ESC/POS Commands
    const ESC_INIT = [0x1B, 0x40];
    const ESC_ALIGN_CENTER = [0x1B, 0x61, 1];
    const ESC_ALIGN_LEFT = [0x1B, 0x61, 0];
    const ESC_BOLD_ON = [0x1B, 0x45, 1];
    const ESC_BOLD_OFF = [0x1B, 0x45, 0];
    const FEED_LINES = [0x1B, 0x64, 4];

    const content =
      "================================\n" +
      "        MAR-MARKET POS          \n" +
      "       XPRINTER XP-58IIH        \n" +
      "================================\n" +
      "STORE: FTEST (SANDBOX)          \n" +
      "STATUS: HARDWARE CONNECTED      \n" +
      "DATE: " + new Date().toLocaleDateString() + "            \n" +
      "--------------------------------\n" +
      "ITEM                 QTY   PRICE\n" +
      "--------------------------------\n" +
      "GALA FRESKO 1L       1x     1.85\n" +
      "PSOMI HORIATIKO      1x     1.10\n" +
      "--------------------------------\n" +
      "SYNOLO EYRO:                2.95\n" +
      "METRHTA:                    5.00\n" +
      "RESTA:                      2.05\n" +
      "================================\n" +
      "   EYXARISTOYME GIA THN        \n" +
      "        PROTIMHSH!              \n";

    try {
      const payload = new Uint8Array([
        ...ESC_INIT,
        ...ESC_ALIGN_CENTER,
        ...ESC_BOLD_ON,
        ...encoder.encode("MARANTH HUB POS\n"),
        ...ESC_BOLD_OFF,
        ...ESC_ALIGN_LEFT,
        ...encoder.encode(content),
        ...FEED_LINES
      ]);

      await this.usbDevice.transferOut(this.usbOutEndpoint!, payload);
      console.info('[Printer] Print payload sent successfully via WebUSB.');
    } catch (err) {
      console.error('[Printer] WebUSB write failed:', err);
    }
  }
}