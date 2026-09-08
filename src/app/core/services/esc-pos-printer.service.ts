import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ReceiptPrintData {
  storeName: string;
  receiptNumber: string;
  date: string;
  items: Array<{ name: string; qty: number; price: number }>;
  total: number;
}

@Injectable({
  providedIn: 'root'
})
export class EscPosPrinterService {
  private http = inject(HttpClient);
  private readonly bridgeUrl = 'http://127.0.0.1:18080/api/printer/raw';
  private defaultPrinter = 'POS-58';

  private readonly ESC = '\x1B';
  private readonly GS = '\x1D';

  public openCashDrawer(): Observable<any> {
    const CMD_DRAWER_KICK = this.ESC + 'p' + '\x00' + '\x19' + '\x19';
    return this.sendRaw(CMD_DRAWER_KICK);
  }

  public printReceipt(receipt: ReceiptPrintData): Observable<any> {
    const CMD_PAPER_CUT = '\n\n\n\n' + this.GS + 'V' + '\x41' + '\x00';
    const CMD_DRAWER_KICK = this.ESC + 'p' + '\x00' + '\x19' + '\x19';

    let body = '================================\n';
    body += `         ${this.transliterateGreek(receipt.storeName).toUpperCase()}         \n`;
    body += '================================\n';
    body += `Receipt #: ${receipt.receiptNumber}\n`;
    body += `Date:      ${receipt.date}\n`;
    body += '--------------------------------\n';

    receipt.items.forEach(item => {
      const safeName = this.transliterateGreek(item.name).substring(0, 16);
      const line = `${item.qty}x ${safeName}`;
      const priceStr = `€${item.price.toFixed(2)}`;
      const spaces = 32 - (line.length + priceStr.length);
      body += `${line}${' '.repeat(Math.max(1, spaces))}${priceStr}\n`;
    });

    body += '--------------------------------\n';
    const totalStr = `€${receipt.total.toFixed(2)}`;
    const totalSpaces = 32 - ('TOTAL:'.length + totalStr.length);
    body += `TOTAL:${' '.repeat(Math.max(1, totalSpaces))}${totalStr}\n`;
    body += '================================\n';
    body += '     Thank you for your visit!  \n';

    body += CMD_PAPER_CUT;
    body += CMD_DRAWER_KICK;

    return this.sendRaw(body);
  }

  public printShiftReportHtml(shift: any, type: 'X' | 'Z'): void {
    const title = type === 'Z' ? 'DELTIO Z (KLEISIMO)' : 'DELTIO X (ENDIAMESO)';
    const text = 
      `================================\n` +
      `         ${title}         \n` +
      `================================\n` +
      `Vardia:     ${shift.id || 'SHIFT-01'}\n` +
      `Tamias:     ${this.transliterateGreek(shift.cashierName || 'TAMIAS')}\n` +
      `Enarxi:     ${shift.openedAt || ''}\n` +
      `Synolo:     €${Number(shift.totalSales || 0).toFixed(2)}\n` +
      `Metrhta:    €${Number(shift.cashTotal || 0).toFixed(2)}\n` +
      `Karta:      €${Number(shift.cardTotal || 0).toFixed(2)}\n` +
      `================================\n\n\n\n` +
      this.GS + 'V' + '\x41' + '\x00';

    this.sendRaw(text).subscribe({
      error: err => console.warn('[Bridge] Shift report print error:', err)
    });
  }

  public printHtmlThermalSlip(htmlSnippet: string): void {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlSnippet;
    const text = (tempDiv.textContent || tempDiv.innerText || '') + '\n\n\n\n' + this.GS + 'V' + '\x41' + '\x00';
    this.sendRaw(text).subscribe({
      error: err => console.warn('[Bridge] Thermal slip print error:', err)
    });
  }

  public transliterateGreek(text: string): string {
    if (!text) return '';
    const map: Record<string, string> = {
      'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'TH',
      'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O', 'Π': 'P',
      'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F', 'Χ': 'CH', 'Ψ': 'PS', 'Ω': 'O',
      'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th',
      'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p',
      'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o',
      'ά': 'a', 'έ': 'e', 'ή': 'i', 'ί': 'i', 'ό': 'o', 'ύ': 'y', 'ώ': 'o',
      'Ά': 'A', 'Έ': 'E', 'Ή': 'I', 'Ί': 'I', 'Ό': 'O', 'Ύ': 'Y', 'Ώ': 'O'
    };
    return text.split('').map(char => map[char] || char).join('');
  }

  private sendRaw(rawText: string): Observable<any> {
    const base64Data = btoa(unescape(encodeURIComponent(rawText)));
    return this.http.post(this.bridgeUrl, {
      printer_name: this.defaultPrinter,
      data: base64Data
    });
  }

  /**
   * Sanitizes Greek characters for standard ESC/POS 7-bit/8-bit code pages (ISO-8859-7 / CP737 / ASCII transliteration)
   */
  public sanitizeGreek(str: string): string {
    if (!str) return '';
    const map: Record<string, string> = {
      'Ά': 'Α', 'Έ': 'Ε', 'Ή': 'Η', 'Ί': 'Ι', 'Ό': 'Ο', 'Ύ': 'Υ', 'Ώ': 'Ω',
      'Ϊ': 'Ι', 'Ϋ': 'Υ', 'ΐ': 'ι', 'ΰ': 'υ',
      'ά': 'α', 'έ': 'ε', 'ή': 'η', 'ί': 'ι', 'ό': 'ο', 'ύ': 'υ', 'ώ': 'ω'
    };
    return str.replace(/[ΆΈΉΊΌΎΏΪΫΐΰάέήίόύώ]/g, (m) => map[m] || m);
  }

  /**
   * Serial / Web Serial printing fallback (dispatches via local bridge if available or falls back to Web Serial)
   */
  public async printViaSerial(data: Uint8Array | number[]): Promise<boolean> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    try {
     // 1. Try local Go bridge on 127.0.0.1:18080 if running
      const res = await fetch('http://127.0.0.1:18080/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes as any
      }).catch(() => null);

      if (res && res.ok) {
        return true;
      }

      // 2. Try browser Web Serial API if supported
      if ('serial' in navigator) {
        const serial = (navigator as any).serial;
        const ports = await serial.getPorts();
        if (ports.length > 0) {
          const port = ports[0];
          await port.open({ baudRate: 9600 });
          const writer = port.writable.getWriter();
          await writer.write(bytes);
          writer.releaseLock();
          await port.close();
          return true;
        }
      }

      console.warn('[EscPosPrinter] No local bridge or active serial port found.');
      return false;
    } catch (err) {
      console.error('[EscPosPrinter] printViaSerial failed:', err);
      return false;
    }
  }

  /**
   * Builds an ESC/POS byte sequence for inventory spoilage slips
   */
  public buildEscPosSpoilageSlip(log: any): Uint8Array {
    const ESC = 0x1B;
    const GS = 0x1D;
    const LF = 0x0A;
    const bytes: number[] = [];

    const pushStr = (text: string) => {
      const sanitized = this.sanitizeGreek(text);
      for (let i = 0; i < sanitized.length; i++) {
        bytes.push(sanitized.charCodeAt(i) & 0xFF);
      }
    };

    // Initialize printer
    bytes.push(ESC, 0x40);

    // Center alignment
    bytes.push(ESC, 0x61, 0x01);
    // Double height/width header
    bytes.push(GS, 0x21, 0x11);
    pushStr('ΔΕΛΤΙΟ ΑΠΩΛΕΙΩΝ / ΦΘΟΡΩΝ');
    bytes.push(LF, LF);

    // Normal text & Left align
    bytes.push(GS, 0x21, 0x00);
    bytes.push(ESC, 0x61, 0x00);

    const dateStr = log?.timestamp ? new Date(log.timestamp).toLocaleString('el-GR') : new Date().toLocaleString('el-GR');
    pushStr(`Ημερομηνία : ${dateStr}`);
    bytes.push(LF);
    pushStr(`Προϊόν      : ${log?.productName || log?.name || '-'}`);
    bytes.push(LF);
    pushStr(`Ποσότητα    : ${log?.quantity ?? '-'} ${log?.unit || 'τεμ'}`);
    bytes.push(LF);
    pushStr(`Αιτία       : ${log?.reason || 'Φθορά / Λήξη'}`);
    bytes.push(LF);
    pushStr(`Χρήστης     : ${log?.userName || log?.cashier || '-'}`);
    bytes.push(LF, LF);

    // Divider line
    pushStr('--------------------------------');
    bytes.push(LF, LF);

    // Signature line
    pushStr('Υπογραφή: ......................');
    bytes.push(LF, LF, LF);

    // Cut paper
    bytes.push(GS, 0x56, 0x41, 0x03);

    return new Uint8Array(bytes);
  }
}