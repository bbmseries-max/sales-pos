import { Injectable, inject } from '@angular/core';
import QRCode from 'qrcode';
import { TenantConfigService } from './tenant-config.service';
import { StoreHardwareSettings, MarketCompanyProfile } from '../models';

@Injectable({
  providedIn: 'root'
})
export class ReceiptPrinterService {
  private tenantConfig = inject(TenantConfigService);

  /**
   * Main entry point: Prints receipt using the active store's configured driver
   */
  public async printReceipt(tx: any): Promise<void> {
    const shop = (this.tenantConfig.activeShop() as MarketCompanyProfile) || ({} as MarketCompanyProfile);
    
    const settings: StoreHardwareSettings = shop.hardwareSettings || {
      printerDriver: 'browser',
      paperWidth: '58mm',
      autoPrintReceipt: true,
      printMyDataQr: true,
      footerNote: 'Ευχαριστούμε για την προτίμηση!'
    };

    switch (settings.printerDriver) {
      case 'browser':
        await this.printViaBrowser(tx, shop, settings);
        break;

      case 'escpos-usb':
        await this.printViaEscPosUsb(tx, shop, settings);
        break;

      case 'escpos-bluetooth':
        await this.printViaEscPosBluetooth(tx, shop, settings);
        break;

      default:
        await this.printViaBrowser(tx, shop, settings);
        break;
    }
  }

  /**
   * Driver 1: Universal HTML / Window Print (Works on all tablets, laptops, phones)
   */
  private async printViaBrowser(tx: any, shop: MarketCompanyProfile, settings: StoreHardwareSettings): Promise<void> {
    let qrDataUrl = '';
    
    // Generates the AADE QR code directly from the mydataQrUrl link on the transaction
    if (settings.printMyDataQr && tx.mydataQrUrl) {
      try {
        qrDataUrl = await QRCode.toDataURL(tx.mydataQrUrl, {
          width: settings.paperWidth === '80mm' ? 150 : 110,
          margin: 1,
          errorCorrectionLevel: 'M'
        });
      } catch (err) {
        console.error('[Printer] QR Generation failed:', err);
      }
    }

    const printWidth = settings.paperWidth === '80mm' ? '72mm' : '48mm';
    const itemsHtml = (tx.items || []).map((it: any) => `
      <div style="display:flex; justify-content:space-between; font-size:11px; margin: 2px 0;">
        <span>${(it.name || '').substring(0, 20)} x${it.quantity}</span>
        <span>€${(it.price * it.quantity).toFixed(2)}</span>
      </div>
    `).join('');

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.bottom = '0';
    iframe.style.right = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(`
      <html>
        <head>
          <style>
            @page { margin: 0; }
            body { 
              width: ${printWidth}; 
              margin: 0; 
              padding: 2mm; 
              font-family: monospace; 
              color: #000;
            }
            .dashed { border-top: 1px dashed #000; margin: 4px 0; }
            .center { text-align: center; }
            .flex-between { display: flex; justify-content: space-between; }
          </style>
        </head>
        <body>
          <div class="center" style="font-weight:bold; font-size:13px;">${shop.storeName || shop.name || 'MARANTH HUB'}</div>
          <div class="center" style="font-size:10px;">ΑΦΜ: ${shop.afm || '-'} | ΔΟΥ: ${shop.doy || '-'}</div>
          <div class="center" style="font-size:10px;">${shop.address || ''}</div>
          
          <div class="dashed"></div>
          <div class="flex-between" style="font-size:10px;">
            <span>Αρ: ${tx.id}</span>
            <span>${new Date(tx.timestamp).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div style="font-size:10px;">Ταμίας: ${tx.cashierName || 'Admin'}</div>
          
          <div class="dashed"></div>
          ${itemsHtml}
          
          <div class="dashed"></div>
          <div class="flex-between" style="font-weight:bold; font-size:13px;">
            <span>ΣΥΝΟΛΟ:</span>
            <span>€${Number(tx.grandTotal).toFixed(2)}</span>
          </div>
          <div class="flex-between" style="font-size:10px;">
            <span>${tx.paymentMethod === 'Cash' ? 'Μετρητά' : 'Κάρτα'}:</span>
            <span>€${Number(tx.cashTendered || tx.grandTotal).toFixed(2)}</span>
          </div>
          ${tx.changeDue ? `
          <div class="flex-between" style="font-size:10px;">
            <span>Ρέστα:</span>
            <span>€${Number(tx.changeDue).toFixed(2)}</span>
          </div>` : ''}

          <!-- AADE myDATA QR Section -->
          ${settings.printMyDataQr ? `
            <div class="dashed"></div>
            <div class="center" style="font-size:9px; font-weight:bold;">AADE myDATA</div>
            ${tx.mydataMark ? `<div class="center" style="font-size:9px;">MARK: ${tx.mydataMark}</div>` : ''}
            ${tx.mydataUid ? `<div class="center" style="font-size:8px; word-break:break-all;">UID: ${tx.mydataUid}</div>` : ''}
            ${qrDataUrl ? `<div class="center" style="margin-top:4px;"><img src="${qrDataUrl}" style="width:110px; height:110px; display:inline-block;"/></div>` : ''}
          ` : ''}

          <div class="center" style="font-size:9px; margin-top:6px;">
            ${settings.footerNote || 'Ευχαριστούμε για την προτίμηση!'}
          </div>
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 250);
  }

  /**
   * Driver 2: Direct USB ESC/POS
   */
  private async printViaEscPosUsb(tx: any, shop: MarketCompanyProfile, settings: StoreHardwareSettings): Promise<void> {
    console.log('[Printer] Sending binary ESC/POS commands via WebUSB...', tx.id);
  }

  /**
   * Driver 3: Direct Bluetooth ESC/POS
   */
  private async printViaEscPosBluetooth(tx: any, shop: MarketCompanyProfile, settings: StoreHardwareSettings): Promise<void> {
    console.log('[Printer] Sending binary ESC/POS commands via Web Bluetooth...', tx.id);
  }
}