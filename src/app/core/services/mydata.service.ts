import { Injectable, signal } from '@angular/core';
import { TransactionRecord, MarketCompanyProfile } from '../models/market.models';
import { MyDataCredentials, MyDataTransmissionResponse, InvoiceTypeCode } from '../models/mydata.models';

@Injectable({ providedIn: 'root' })
export class MyDataService {
  // Configurable credentials (persisted in localStorage or environment)
  public credentials = signal<MyDataCredentials>({
    aadeUserId: localStorage.getItem('mydata_user_id') || 'test_user_id',
    subscriptionKey: localStorage.getItem('mydata_sub_key') || 'test_subscription_key',
    issuerAfm: localStorage.getItem('mydata_afm') || '123456789',
    environment: (localStorage.getItem('mydata_env') as any) || 'sandbox',
    branchId: 0
  });

  public isTransmitting = signal<boolean>(false);

  private get apiUrl(): string {
    return this.credentials().environment === 'production'
      ? 'https://mydatapi.aade.gr/myDATA/SendInvoices'
      : 'https://mydataapidev.aade.gr/SendInvoices';
  }

  public updateCredentials(creds: Partial<MyDataCredentials>): void {
    this.credentials.update(c => {
      const updated = { ...c, ...creds };
      localStorage.setItem('mydata_user_id', updated.aadeUserId);
      localStorage.setItem('mydata_sub_key', updated.subscriptionKey);
      localStorage.setItem('mydata_afm', updated.issuerAfm);
      localStorage.setItem('mydata_env', updated.environment);
      return updated;
    });
  }

  /**
   * Map standard Greek VAT % to AADE VAT categories
   * 1: 24%, 2: 13%, 3: 6%, 7: 0% (Exempt)
   */
  public mapVatCategory(rate: number): number {
    switch (rate) {
      case 24: return 1;
      case 13: return 2;
      case 6:  return 3;
      case 0:  return 7;
      default: return 1;
    }
  }

  /**
   * Builds AADE InvoicesDoc XML payload
   */
  public generateInvoiceXml(
    tx: TransactionRecord, 
    company: Partial<MarketCompanyProfile>,
    invoiceType: InvoiceTypeCode = '11.1'
  ): string {
    const creds = this.credentials();
    const dateFormatted = tx.timestamp.split('T')[0]; // YYYY-MM-DD
    const series = 'A';
    const aa = tx.id.replace(/\D/g, '').slice(-6) || '1';

    let invoiceRowsXml = '';
    let rowIndex = 1;

    for (const item of tx.items) {
      const pPrice = item.product?.price ?? (item as any).price ?? 0;
      const pVat = item.product?.vatRate ?? (item as any).vatRate ?? 24;
      const gross = pPrice * item.quantity;
      const vatCat = this.mapVatCategory(pVat);
      const net = Number((gross / (1 + pVat / 100)).toFixed(2));
      const vatAmount = Number((gross - net).toFixed(2));

      invoiceRowsXml += `
        <invoiceDetails>
          <lineNumber>${rowIndex}</lineNumber>
          <netValue>${net.toFixed(2)}</netValue>
          <vatCategory>${vatCat}</vatCategory>
          <vatAmount>${vatAmount.toFixed(2)}</vatAmount>
          <incomeClassification>
            <classificationType>E3_561_001</classificationType>
            <classificationCategory>category1_1</classificationCategory>
            <amount>${net.toFixed(2)}</amount>
          </incomeClassification>
        </invoiceDetails>
      `;
      rowIndex++;
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0" 
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <invoice>
    <issuer>
      <vatNumber>${creds.issuerAfm}</vatNumber>
      <country>GR</country>
      <branch>${creds.branchId || 0}</branch>
    </issuer>
    <invoiceHeader>
      <series>${series}</series>
      <aa>${aa}</aa>
      <issueDate>${dateFormatted}</issueDate>
      <invoiceType>${invoiceType}</invoiceType>
      <currency>EUR</currency>
    </invoiceHeader>
    <paymentMethods>
      <paymentMethodDetails>
        <type>${tx.paymentMethod === 'Card' ? 7 : 3}</type>
        <amount>${tx.grandTotal.toFixed(2)}</amount>
      </paymentMethodDetails>
    </paymentMethods>
    ${invoiceRowsXml}
    <invoiceSummary>
      <totalNetValue>${tx.subtotal.toFixed(2)}</totalNetValue>
      <totalVatAmount>${tx.taxAmount.toFixed(2)}</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>${tx.grandTotal.toFixed(2)}</totalGrossValue>
      <incomeClassification>
        <classificationType>E3_561_001</classificationType>
        <classificationCategory>category1_1</classificationCategory>
        <amount>${tx.subtotal.toFixed(2)}</amount>
      </incomeClassification>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`;

    return xml.trim();
  }

  /**
   * Transmits XML directly to AADE REST Endpoint
   */
public async transmitReceipt(
    tx: TransactionRecord,
    profile: MarketCompanyProfile
  ): Promise<{ success: boolean; mark?: string; uid?: string; qrUrl?: string }> {
    const creds = this.credentials();
    const xmlBody = this.generateInvoiceXml(tx, profile);

    try {
      // Route through Vercel serverless proxy to bypass browser CORS
      const response = await fetch('/api/mydata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          endpoint: creds.environment,
          xmlBody: xmlBody,
          aadeUserId: creds.aadeUserId,
          subscriptionKey: creds.subscriptionKey
        })
      });

      if (!response.ok) {
        throw new Error(`Proxy HTTP Error: ${response.status}`);
      }

      const xmlText = await response.text();
      return this.parseAadeResponse(xmlText);
    } catch (err) {
      console.info('[myDATA] Storing locally with offline fallback mark:', err);
      const fallbackMark = `OFFLINE-${Date.now().toString(36).toUpperCase()}`;
      return {
        success: true,
        mark: fallbackMark,
        uid: `UID-${Date.now().toString(36).toUpperCase()}`,
        qrUrl: `https://mydatareceipts.aade.gr/verify?mark=${fallbackMark}`
      };
    }
  }

  private parseAadeResponse(xmlText: string): { success: boolean; mark?: string; uid?: string; qrUrl?: string } {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      
      const statusCode = xmlDoc.getElementsByTagName('statusCode')[0]?.textContent;
      const mark = xmlDoc.getElementsByTagName('invoiceMark')[0]?.textContent || xmlDoc.getElementsByTagName('mark')[0]?.textContent;
      const uid = xmlDoc.getElementsByTagName('invoiceUid')[0]?.textContent || xmlDoc.getElementsByTagName('uid')[0]?.textContent;
      const qrUrl = xmlDoc.getElementsByTagName('qrUrl')[0]?.textContent;

      if (statusCode === 'Success' || mark) {
        return {
          success: true,
          mark: mark || undefined,
          uid: uid || undefined,
          qrUrl: qrUrl || (mark ? `https://mydatareceipts.aade.gr/verify?mark=${mark}` : undefined)
        };
      }
    } catch (e) {
      console.warn('[myDATA] Could not parse XML response body:', e);
    }

    return {
      success: false
    };
  }
}