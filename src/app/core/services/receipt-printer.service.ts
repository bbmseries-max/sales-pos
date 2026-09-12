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
   * Driver 1: Universal HTML / Window Print (Works across tablets, desktop browsers, mobiles)
   */
  private async printViaBrowser(tx: any, shop: MarketCompanyProfile, settings: StoreHardwareSettings): Promise<void> {
    const isFiscalized = Boolean(tx.mydataMark || tx.fhmSignature || tx.status === 'completed');
    const qrTargetUrl = tx.mydataQrUrl || tx.qrUrl;
    let qrDataUrl = '';

    const qrDimensions = settings.paperWidth === '80mm' ? 140 : 110;
    const printWidth = settings.paperWidth === '80mm' ? '72mm' : '48mm';

    // Generate QR only if valid fiscal URL is present
    if (settings.printMyDataQr && qrTargetUrl) {
      try {
        qrDataUrl = await QRCode.toDataURL(qrTargetUrl, {
          width: qrDimensions,
          margin: 1,
          errorCorrectionLevel: 'M'
        });
      } catch (err) {
        console.error('[Printer] QR Generation failed:', err);
      }
    }

    // Line items HTML
    const itemsHtml = (tx.items || []).map((it: any) => `
      <div style="display:flex; justify-content:space-between; font-size:11px; margin: 2px 0;">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:65%;">
          ${it.quantity}x ${(it.name || '').substring(0, 22)}
        </span>
        <span>€${(Number(it.price || 0) * Number(it.quantity || 1)).toFixed(2)}</span>
      </div>
    `).join('');

    // VAT Breakdown HTML (Mandatory under AADE rules)
    const vatHtml = (tx.vatAmounts || []).map((v: any) => `
      <div style="display:flex; justify-content:space-between; font-size:9px; color:#333;">
        <span>ΦΠΑ ${v.rate}% (Καθ: €${Number(v.net).toFixed(2)})</span>
        <span>€${Number(v.vat).toFixed(2)}</span>
      </div>
    `).join('');

    // Hidden iframe creation
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
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            @page { margin: 0; }
            body { 
              width: ${printWidth}; 
              margin: 0; 
              padding: 2mm; 
              font-family: 'Courier New', Courier, monospace; 
              color: #000;
              background: #fff;
              -webkit-print-color-adjust: exact;
            }
            .dashed { border-top: 1px dashed #000; margin: 4px 0; }
            .center { text-align: center; }
            .flex-between { display: flex; justify-content: space-between; }
            .badge-box {
              border: 1px solid #000;
              padding: 3px;
              margin: 4px 0;
              text-align: center;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <!-- Store Header -->
          <div class="center" style="font-weight:bold; font-size:12px; text-transform:uppercase;">
            ${shop.storeName || shop.name || 'MARANTH HUB'}
          </div>
          <div class="center" style="font-size:10px;">ΑΦΜ: ${shop.afm || '-'} • ΔΟΥ: ${shop.doy || '-'}</div>
          <div class="center" style="font-size:9px;">${shop.address || ''}</div>
          
          <div class="dashed"></div>

          <!-- Document Legal Status Header -->
          ${isFiscalized ? `
            <div class="center" style="font-size:11px; font-weight:bold; letter-spacing:0.5px;">
              ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ
            </div>
          ` : `
            <div class="badge-box">
              <div style="font-size:11px;">ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ</div>
              <div style="font-size:8px; font-weight:normal;">(ΕΚΚΡΕΜΕΙ ΣΗΜΑΝΣΗ - OFFLINE)</div>
            </div>
          `}

          <div class="flex-between" style="font-size:10px; margin-top:2px;">
            <span>Αρ: ${tx.localOrderId || tx.id}</span>
            <span>${new Date(tx.timestamp || Date.now()).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div style="font-size:10px;">Ταμίας: ${tx.cashierName || 'Admin'}</div>
          
          <div class="dashed"></div>
          
          <!-- Items List -->
          ${itemsHtml}
          
          <div class="dashed"></div>

          <!-- Totals -->
          <div class="flex-between" style="font-weight:bold; font-size:13px;">
            <span>ΣΥΝΟΛΟ:</span>
            <span>€${Number(tx.grandTotal || tx.totalGross || 0).toFixed(2)}</span>
          </div>
          <div class="flex-between" style="font-size:10px;">
            <span>${tx.paymentMethod === 'Cash' ? 'Μετρητά' : 'Κάρτα'}:</span>
            <span>€${Number(tx.cashTendered || tx.grandTotal || tx.totalGross || 0).toFixed(2)}</span>
          </div>
          ${tx.changeDue ? `
            <div class="flex-between" style="font-size:10px;">
              <span>Ρέστα:</span>
              <span>€${Number(tx.changeDue).toFixed(2)}</span>
            </div>
          ` : ''}

          <!-- VAT Breakdown Table -->
          ${vatHtml ? `
            <div class="dashed"></div>
            <div style="font-size:9px; font-weight:bold; margin-bottom:2px;">ΑΝΑΛΥΣΗ ΦΠΑ:</div>
            ${vatHtml}
          ` : ''}

          <!-- Fiscal Verification Section -->
          ${settings.printMyDataQr ? `
            <div class="dashed"></div>
            ${isFiscalized && qrDataUrl ? `
              <div class="center" style="font-size:9px; font-weight:bold;">AADE myDATA</div>
              ${tx.mydataMark ? `<div class="center" style="font-size:9px; word-break:break-all;">MARK: ${tx.mydataMark}</div>` : ''}
              ${tx.mydataUid ? `<div class="center" style="font-size:8px; word-break:break-all;">UID: ${tx.mydataUid}</div>` : ''}
              <div class="center" style="margin-top:4px;">
                <img src="${qrDataUrl}" style="width:${qrDimensions}px; height:${qrDimensions}px; display:inline-block;" />
              </div>
              <div class="center" style="font-size:8px; color:#444; margin-top:2px;">Έλεγχος εγκυρότητας μέσω Appodixi</div>
            ` : `
              <div class="center" style="font-size:9px; padding:4px 0; color:#333;">
                *** OFFLINE ΚΑΤΑΧΩΡΗΣΗ ***<br/>
                Αποστολή στο myDATA με την επαναφορά σύνδεσης.
              </div>
            `}
          ` : ''}

          <div class="center" style="font-size:9px; margin-top:8px;">
            ${settings.footerNote || 'Ευχαριστούμε για την προτίμηση!'}
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Trigger printing once content and images are rendered
    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 2000);
        }
      }, 150);
    };
  }

  /**
   * Driver 2: Direct USB ESC/POS
   */
  private async printViaEscPosUsb(tx: any, shop: MarketCompanyProfile, settings: StoreHardwareSettings): Promise<void> {
    console.log('[Printer] Dispatching binary ESC/POS payload via WebUSB...', tx.id);
  }

  /**
   * Driver 3: Direct Bluetooth ESC/POS
   */
  private async printViaEscPosBluetooth(tx: any, shop: MarketCompanyProfile, settings: StoreHardwareSettings): Promise<void> {
    console.log('[Printer] Dispatching binary ESC/POS payload via Web Bluetooth...', tx.id);
  }
}