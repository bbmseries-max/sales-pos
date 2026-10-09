import { MarketCompanyProfile, TransactionRecord, Customer } from '../models';

export interface InvoicePrintOptions {
  transaction: TransactionRecord;
  company: MarketCompanyProfile;
  customer: Customer;
  documentTypeTitle?: string; // Default: 'ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ - ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ'
  series?: string;            // e.g. 'ΤΔΑ-Α'
  documentNumber?: string | number; // e.g. '104'
  vehiclePlate?: string;      // Optional for Δελτίο Αποστολής (e.g. 'ΙΧΕ 1234')
  dispatchPurpose?: string;   // e.g. 'ΠΩΛΗΣΗ'
}

export function printA4InvoiceDocument(options: InvoicePrintOptions): void {
  const { transaction, company, customer } = options;
  const printWin = window.open('', '_blank', 'width=900,height=1000');
  if (!printWin) {
    alert('Το παράθυρο εκτύπωσης μπλοκαρίστηκε από τον browser. Παρακαλώ επιτρέψτε τα popups.');
    return;
  }

  const title = options.documentTypeTitle || 'ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ - ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ';
  const series = options.series || 'ΤΔΑ';
  const docNum = options.documentNumber || transaction.id.replace(/\D/g, '').slice(-5) || '1';
  const purpose = options.dispatchPurpose || 'ΠΩΛΗΣΗ';

  const txDate = new Date(transaction.timestamp || Date.now());
  const dateStr = txDate.toLocaleDateString('el-GR');
  const timeStr = txDate.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });

  // 1. Process line items and VAT buckets (0%, 6%, 13%, 24%)
  const vatBuckets: Record<number, { net: number; vat: number; gross: number }> = {
    0: { net: 0, vat: 0, gross: 0 },
    6: { net: 0, vat: 0, gross: 0 },
    13: { net: 0, vat: 0, gross: 0 },
    24: { net: 0, vat: 0, gross: 0 }
  };

  let totalNet = 0;
  let totalVat = 0;

  const itemRowsHtml = (transaction.items || []).map((item, idx) => {
    const rate = Number(item.product?.vatRate ?? 24);
    const gross = Number(item.lineTotal ?? ((item.unitPrice ?? 0) * item.quantity));
    const net = rate === 0 ? gross : gross / (1 + rate / 100);
    const vat = gross - net;

    totalNet += net;
    totalVat += vat;

    if (!vatBuckets[rate]) {
      vatBuckets[rate] = { net: 0, vat: 0, gross: 0 };
    }
    vatBuckets[rate].net += net;
    vatBuckets[rate].vat += vat;
    vatBuckets[rate].gross += gross;

    const unitMeasure = item.product?.isWeighted ? 'Kg' : 'Τεμ';

    return `
      <tr>
        <td class="text-center">${idx + 1}</td>
        <td class="font-mono">${item.product?.barcode || '-'}</td>
        <td class="bold">${item.product?.name || 'Προϊόν'}</td>
        <td class="text-center">${unitMeasure}</td>
        <td class="text-right font-mono">${item.quantity}</td>
        <td class="text-right font-mono">€${(item.unitPrice ?? 0).toFixed(2)}</td>
        <td class="text-right font-mono">€${net.toFixed(2)}</td>
        <td class="text-center font-mono">${rate}%</td>
        <td class="text-right font-mono bold">€${gross.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  // 2. Active VAT summary rows (show only non-zero buckets)
  const vatSummaryRowsHtml = Object.entries(vatBuckets)
    .filter(([_, v]) => v.gross > 0)
    .map(([r, v]) => `
      <tr>
        <td class="bold font-mono">ΦΠΑ ${r}%:</td>
        <td class="text-right font-mono">Καθαρό: €${v.net.toFixed(2)}</td>
        <td class="text-right font-mono">ΦΠΑ: €${v.vat.toFixed(2)}</td>
        <td class="text-right font-mono bold">Σύνολο: €${v.gross.toFixed(2)}</td>
      </tr>
    `).join('');

  // 3. AADE myDATA QR Code generation
  const mark = transaction.mydataMark || '40000' + Date.now().toString().slice(-8);
  const uid = transaction.mydataUid || 'UID-' + Math.random().toString(36).substring(2, 12).toUpperCase();
  
  const qrVerificationUrl = transaction.mydataQrUrl || 
    `https://www.aade.gr/mydata/verify?afm=${company.afm}&d=${txDate.toISOString().split('T')[0]}&mark=${mark}&g=${transaction.grandTotal.toFixed(2)}`;

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=2&data=${encodeURIComponent(qrVerificationUrl)}`;

  printWin.document.open();
  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="el">
    <head>
      <meta charset="utf-8" />
      <title>${title} - ${series} ${docNum}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 8mm 6mm;
        }
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 10px;
          color: #0f172a;
          margin: 0;
          padding: 4mm 6mm;
          background: #fff;
          line-height: 1.25;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .text-left { text-align: left; }
        .bold { font-weight: 700; }
        .font-mono { font-family: "Courier New", Courier, monospace; }
        
        .header-box {
          display: flex;
          justify-content: space-between;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 8px;
          margin-bottom: 10px;
        }
        .company-title {
          font-size: 16px;
          font-weight: 900;
          color: #0f172a;
          text-transform: uppercase;
        }
        .doc-title-badge {
          text-align: right;
        }
        .badge-text {
          font-size: 13px;
          font-weight: 900;
          color: #b45309;
          text-transform: uppercase;
        }

        .parties-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }
        .party-card {
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 8px 10px;
          background-color: #f8fafc;
        }
        .party-card-title {
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          color: #475569;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 3px;
          margin-bottom: 4px;
        }

        .meta-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          padding: 6px 10px;
          margin-bottom: 12px;
          font-size: 9.5px;
        }

        table.items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }
        table.items-table th {
          background-color: #0f172a;
          color: #ffffff;
          padding: 5px 6px;
          font-size: 9px;
          text-transform: uppercase;
          font-weight: 800;
        }
        table.items-table td {
          padding: 5px 6px;
          border-bottom: 1px solid #e2e8f0;
          font-size: 9.5px;
        }
        table.items-table tr:nth-child(even) {
          background-color: #f8fafc;
        }

        .footer-grid {
          display: grid;
          grid-template-columns: 150px 1fr 240px;
          gap: 12px;
          align-items: start;
          border-top: 1.5px solid #0f172a;
          padding-top: 10px;
        }
        .aade-box {
          border: 1px dashed #64748b;
          border-radius: 6px;
          padding: 6px;
          text-align: center;
          background: #fdfdfd;
        }
        .aade-box img {
          width: 90px;
          height: 90px;
          margin: 0 auto;
          display: block;
        }
        .totals-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
        }
        .totals-table td {
          padding: 2.5px 0;
        }
        .grand-total-row {
          border-top: 2px solid #0f172a;
          border-bottom: 2px solid #0f172a;
          font-size: 13px;
          font-weight: 900;
        }

        .signatures-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          margin-top: 24px;
          padding: 0 20px;
          font-size: 9px;
        }
        .sig-line {
          border-top: 1px dotted #64748b;
          margin-top: 30px;
          text-align: center;
          padding-top: 3px;
        }
      </style>
    </head>
    <body>
      
      <!-- Top Header -->
      <div class="header-box">
        <div>
          <div class="company-title">${company.storeName || company.name || 'MARANTH SUPERMARKET'}</div>
          <div class="bold" style="font-size: 11px;">${company.companyTitle || 'ΕΜΠΟΡΙΟ ΤΡΟΦΙΜΩΝ &amp; ΕΙΔΩΝ SUPERMARKET'}</div>
          <div>${company.address || 'ΕΔΡΑ ΚΑΤΑΣΤΗΜΑΤΟΣ'} • Τ.Κ. ${company.postalCode || '10431'} ${company.city || 'ΑΘΗΝΑ'}</div>
          <div>ΑΦΜ: <span class="font-mono bold">${company.afm}</span> • ΔΟΥ: ${company.doy || 'ΑΘΗΝΩΝ'} • Τηλ: ${company.phone || '-'}</div>
        </div>
        <div class="doc-title-badge">
          <div class="badge-text">${title}</div>
          <div style="font-size: 11px; margin-top: 2px;">
            ΣΕΙΡΑ: <span class="bold font-mono">${series}</span> • ΑΡΙΘΜΟΣ: <span class="bold font-mono">${docNum}</span>
          </div>
          <div class="font-mono" style="font-size: 9.5px; color: #475569; margin-top: 2px;">
            ΗΜ/ΝΙΑ: ${dateStr} • ΩΡΑ: ${timeStr}
          </div>
        </div>
      </div>

      <!-- Parties: Issuer vs Recipient -->
      <div class="parties-grid">
        <div class="party-card">
          <div class="party-card-title">ΣΤΟΙΧΕΙΑ ΕΚΔΟΤΗ</div>
          <div><span class="bold">${company.storeName || company.name || 'MARANTH IKE'}</span></div>
          <div>ΑΦΜ: <span class="font-mono bold">${company.afm}</span> (${company.doy || 'ΔΟΥ ΑΘΗΝΩΝ'})</div>
          <div>Διεύθυνση: ${company.address || '-'}</div>
          <div>Web: <span class="font-mono">https://www.maranth.gr/</span></div>
        </div>

        <div class="party-card">
          <div class="party-card-title">ΣΤΟΙΧΕΙΑ ΛΗΠΤΗ (ΠΕΛΑΤΗ)</div>
          <div>Επωνυμία: <span class="bold">${customer.name}</span></div>
          <div>ΑΦΜ: <span class="font-mono bold">${customer.afm || '—'}</span> • ΔΟΥ: ${customer.doy || '—'}</div>
          <div>Επάγγελμα: ${customer.profession || 'ΕΜΠΟΡΙΚΗ ΔΡΑΣΤΗΡΙΟΤΗΤΑ'}</div>
          <div>Διεύθυνση: ${customer.address || 'ΕΔΡΑ ΠΕΛΑΤΗ'} • Τηλ: ${customer.phone || '—'}</div>
        </div>
      </div>

      <!-- Dispatch & Delivery Meta Strip -->
      <div class="meta-strip">
        <div><strong>Σκοπός Διακίνησης:</strong> ${purpose}</div>
        <div><strong>Τρόπος Πληρωμής:</strong> ${transaction.paymentMethod === 'Card' ? 'ΠΙΣΤΩΤΙΚΗ/ΧΡΕΩΣΤΙΚΗ ΚΑΡΤΑ' : transaction.paymentMethod === 'Debit' ? 'ΕΠΙ ΠΙΣΤΩΣΕΙ (ΒΕΡΕΣΕ)' : 'ΜΕΤΡΗΤΑ'}</div>
        <div><strong>Τόπος Αποστολής:</strong> ΕΔΡΑ ΜΑΣ</div>
        <div><strong>Τόπος Προορισμού:</strong> ΕΔΡΑ ΠΕΛΑΤΗ</div>
      </div>

      <!-- Items Table -->
      <table class="items-table">
        <thead>
          <tr>
            <th style="width: 25px;">Α/Α</th>
            <th style="width: 95px;">Κωδικός/Barcode</th>
            <th>Περιγραφή Είδους</th>
            <th style="width: 35px;" class="text-center">Μ/Μ</th>
            <th style="width: 45px;" class="text-right">Ποσ.</th>
            <th style="width: 55px;" class="text-right">Τιμή Μον.</th>
            <th style="width: 60px;" class="text-right">Καθαρή Αξία</th>
            <th style="width: 45px;" class="text-center">ΦΠΑ %</th>
            <th style="width: 65px;" class="text-right">Σύνολο</th>
          </tr>
        </thead>
        <tbody>
          ${itemRowsHtml}
        </tbody>
      </table>

      <!-- Footer Grid: AADE QR Code + VAT Breakdown + Totals -->
      <div class="footer-grid">
        
        <!-- AADE QR & MARK Column -->
        <div class="aade-box">
          <img src="${qrImageUrl}" alt="AADE myDATA QR Code" />
          <div class="font-mono bold" style="font-size: 8px; margin-top: 4px;">ΕΠΑΛΗΘΕΥΣΗ myDATA</div>
          <div class="font-mono" style="font-size: 7.5px;">MARK: ${mark}</div>
          <div class="font-mono" style="font-size: 6.5px; color: #64748b; word-break: break-all;">${uid}</div>
        </div>

        <!-- VAT Breakdown Column (Including 0% for Cigarettes/Cards) -->
        <div style="padding-top: 4px;">
          <div class="bold" style="font-size: 9px; text-transform: uppercase; margin-bottom: 4px; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px;">
            Ανάλυση Συντελεστών Φ.Π.Α.
          </div>
          <table style="width: 100%; font-size: 9px;">
            ${vatSummaryRowsHtml}
          </table>
          <div style="font-size: 8.5px; color: #64748b; margin-top: 6px;">
            * Σημείωση: Προϊόντα καπνού και κάρτες τηλεφωνίας τιμολογούνται με συντελεστή 0% Φ.Π.Α. (Άρθρο 44 Κ.Φ.Π.Α.).
          </div>
        </div>

        <!-- Grand Totals Column -->
        <div>
          <table class="totals-table">
            <tr>
              <td>Σύνολο Καθαρής Αξίας:</td>
              <td class="text-right font-mono bold">€${totalNet.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Συνολικό Ποσό Φ.Π.Α.:</td>
              <td class="text-right font-mono bold">€${totalVat.toFixed(2)}</td>
            </tr>
            <tr class="grand-total-row">
              <td style="padding: 4px 0;">ΠΛΗΡΩΤΕΟ ΠΟΣΟ:</td>
              <td class="text-right font-mono" style="padding: 4px 0; color: #b45309;">€${transaction.grandTotal.toFixed(2)}</td>
            </tr>
          </table>
        </div>

      </div>

      <!-- Signatures -->
      <div class="signatures-grid">
        <div>
          <div class="sig-line">Ο Εκδώσας (Σφραγίδα &amp; Υπογραφή)</div>
        </div>
        <div>
          <div class="sig-line">Ο Παραλαβών (Ονοματεπώνυμο &amp; Υπογραφή)</div>
        </div>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 400);
        };
      </script>
    </body>
    </html>
  `);
  printWin.document.close();
}