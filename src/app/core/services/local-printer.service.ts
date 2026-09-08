import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface PrintResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
}

export interface ReceiptData {
  storeName: string;
  receiptNumber: string;
  date: string;
  items: ReceiptItem[];
  total: number;
}

@Injectable({
  providedIn: 'root'
})
export class LocalPrinterService {
  private readonly BRIDGE_URL = 'http://127.0.0.1:18080';
  private defaultPrinterName = 'POS-58';

  // ESC/POS Command sequences
  private readonly ESC = '\x1B';
  private readonly GS = '\x1D';

  // Drawer kick: ESC p pin 0 (25ms pulse)
  private readonly CMD_DRAWER_KICK = this.ESC + 'p' + '\x00' + '\x19' + '\x19';

  // Paper cut: 4 line feeds + GS V 65 0
  private readonly CMD_PAPER_CUT = '\n\n\n\n' + this.GS + 'V' + '\x41' + '\x00';

  constructor(private http: HttpClient) {}

  /**
   * Set custom printer name if different from POS-58
   */
  setPrinterName(name: string): void {
    this.defaultPrinterName = name;
  }

  /**
   * Checks if the local Go bridge is running on 127.0.0.1:18080
   */
  checkBridgeStatus(): Observable<boolean> {
    return this.http.get<{ status: string }>(`${this.BRIDGE_URL}/health`).pipe(
      map(res => res?.status === 'online'),
      catchError(() => of(false))
    );
  }

  /**
   * Pop/kick the cash drawer solenoid
   */
  openCashDrawer(): Observable<PrintResponse> {
    return this.sendRaw(this.CMD_DRAWER_KICK);
  }

  /**
   * Format receipt text and send to the printer
   */
  printReceipt(receipt: ReceiptData): Observable<PrintResponse> {
    let payload = '';

    // Header
    payload += '================================\n';
    payload += `         ${receipt.storeName.toUpperCase()}         \n`;
    payload += '================================\n';
    payload += `Receipt #: ${receipt.receiptNumber}\n`;
    payload += `Date:      ${receipt.date}\n`;
    payload += '--------------------------------\n';

    // Line items (formatted for 32-char line width of 58mm)
    receipt.items.forEach(item => {
      const itemLine = `${item.qty}x ${item.name}`;
      const priceStr = `€${item.price.toFixed(2)}`;
      const spacesNeeded = 32 - (itemLine.length + priceStr.length);
      const spacing = spacesNeeded > 0 ? ' '.repeat(spacesNeeded) : ' ';
      payload += `${itemLine}${spacing}${priceStr}\n`;
    });

    // Total
    payload += '--------------------------------\n';
    const totalStr = `€${receipt.total.toFixed(2)}`;
    const totalSpaces = 32 - ('TOTAL:'.length + totalStr.length);
    payload += `TOTAL:${' '.repeat(Math.max(1, totalSpaces))}${totalStr}\n`;
    payload += '================================\n';
    payload += '     Thank you for your visit!  \n';

    // Append Cut & Drawer Kick commands
    payload += this.CMD_PAPER_CUT;
    payload += this.CMD_DRAWER_KICK;

    return this.sendRaw(payload);
  }

  /**
   * Low-level method: Encodes raw ESC/POS strings to base64 and posts to bridge
   */
  private sendRaw(textData: string): Observable<PrintResponse> {
    try {
      // Safe UTF-8 to Base64 encoding for Greek characters and binary ESC/POS
      const base64Data = btoa(unescape(encodeURIComponent(textData)));

      const body = {
        printer_name: this.defaultPrinterName,
        data: base64Data
      };

      return this.http.post<PrintResponse>(`${this.BRIDGE_URL}/api/printer/raw`, body).pipe(
        catchError(err => {
          console.error('Print spooler request failed', err);
          return throwError(() => new Error(err?.error?.error || 'Bridge communication failed'));
        })
      );
    } catch (err: any) {
      return throwError(() => new Error(`Encoding error: ${err.message}`));
    }
  }
}