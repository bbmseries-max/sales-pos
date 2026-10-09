import { MarketCompanyProfile } from '../models';
import { LiveShiftAuditResult } from './shift-calculator.util';

export function renderAndPrintXReport(data: LiveShiftAuditResult & { registerId?: string }, company: MarketCompanyProfile): void {
  const printWin = window.open('', '_blank', 'width=440,height=750,menubar=no,toolbar=no,location=no');
  if (!printWin) {
    alert('Το πρόγραμμα περιήγησης μπλόκαρε το παράθυρο εκτύπωσης. Επιτρέψτε τα popups.');
    return;
  }

  const now = new Date();
  const dateFormatted = now.toLocaleDateString('el-GR');
  const timeFormatted = now.toLocaleTimeString('el-GR');

  const vatRows = (data.vatBreakdown || []).map(v => `
    <tr>
      <td style="text-align: left;">${v.rate}%</td>
      <td style="text-align: right;">€${v.net.toFixed(2)}</td>
      <td style="text-align: right;">€${v.vat.toFixed(2)}</td>
      <td style="text-align: right; font-weight: bold;">€${v.gross.toFixed(2)}</td>
    </tr>
  `).join('');

  printWin.document.open();
  printWin.document.write(`
    <!DOCTYPE html>
    <html lang="el">
    <head>
      <meta charset="utf-8" />
      <title>Ενδιάμεσο Δελτίο "Χ"</title>
      <style>
        @page { size: 80mm auto; margin: 0; }
        body {
          font-family: 'Courier New', Courier, monospace;
          font-size: 11px;
          color: #000;
          width: 72mm;
          margin: 0 auto;
          padding: 8px 4px;
          line-height: 1.25;
        }
        .center { text-align: center; }
        .bold { font-weight: 900; }
        .flex { display: flex; justify-content: space-between; }
        .divider { border-top: 1px dashed #000; margin: 5px 0; }
        .double-divider { border-top: 2px solid #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 10px; }
      </style>
    </head>
    <body>
      <div class="center bold" style="font-size: 13px;">${company.storeName || 'SUPER MARKET'}</div>
      <div class="center">${company.address || ''}</div>
      <div class="center">ΑΦΜ: ${company.afm || '-'} • ΔΟΥ: ${company.doy || '-'}</div>

      <div class="double-divider"></div>
      <div class="center bold" style="font-size: 13px; letter-spacing: 1px;">ΕΝΔΙΑΜΕΣΟ ΔΕΛΤΙΟ "Χ"</div>
      <div class="center" style="font-size: 9px;">(ΔΟΚΙΜΑΣΤΙΚΟ / ΠΛΗΡΟΦΟΡΙΑΚΟ - ΔΕΝ ΚΛΕΙΝΕΙ ΤΗ ΒΑΡΔΙΑ)</div>
      <div class="divider"></div>

      <div class="flex"><span>ΗΜ/ΝΙΑ: ${dateFormatted}</span><span>ΩΡΑ: ${timeFormatted}</span></div>
      <div class="flex"><span>ΤΑΜΕΙΟ: ${data.registerId || 'POS-01'}</span><span>ΧΕΙΡΙΣΤΗΣ: ${data.cashierName || 'Ταμίας'}</span></div>
      <div class="flex"><span>ΕΝΑΡΞΗ ΒΑΡΔΙΑΣ:</span><span>${new Date(data.openedAt).toLocaleTimeString('el-GR')}</span></div>
      <div class="flex bold"><span>ΑΠΟΔΕΙΞΕΙΣ:</span><span>${data.transactionCount}</span></div>

      <div class="double-divider"></div>
      <div class="flex bold" style="font-size: 13px;"><span>ΑΚΑΘΑΡΙΣΤΟΣ ΤΖΙΡΟΣ:</span><span>€${Number(data.totalSales).toFixed(2)}</span></div>
      <div class="flex"><span>ΚΑΘΑΡΗ ΑΞΙΑ:</span><span>€${Number(data.netSales).toFixed(2)}</span></div>
      <div class="flex"><span>ΣΥΝΟΛΟ Φ.Π.Α.:</span><span>€${Number(data.vatTotal).toFixed(2)}</span></div>

      <div class="divider"></div>
      <div class="bold" style="margin-bottom: 2px;">ΑΝΑΛΥΣΗ ΠΛΗΡΩΜΩΝ:</div>
      <div class="flex"><span>ΜΕΤΡΗΤΑ:</span><span>€${Number(data.cashSales).toFixed(2)}</span></div>
      <div class="flex"><span>ΚΑΡΤΕΣ / POS:</span><span>€${Number(data.cardSales).toFixed(2)}</span></div>
      <div class="flex"><span>ΒΕΡΕΣΕ (ΤΕΦΤΕΡΙ):</span><span>€${Number(data.debitSales).toFixed(2)}</span></div>

      ${vatRows ? `
        <div class="divider"></div>
        <div class="bold" style="margin-bottom: 2px;">ΑΝΑΛΥΣΗ Φ.Π.Α.:</div>
        <table>
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th style="text-align: left;">ΣΥΝΤ</th>
              <th style="text-align: right;">ΚΑΘΑΡΟ</th>
              <th style="text-align: right;">ΦΠΑ</th>
              <th style="text-align: right;">ΣΥΝΟΛΟ</th>
            </tr>
          </thead>
          <tbody>${vatRows}</tbody>
        </table>
      ` : ''}

      <div class="double-divider"></div>
      <div class="bold" style="margin-bottom: 2px;">ΤΑΜΕΙΑΚΟ ΙΣΟΖΥΓΙΟ ΣΥΡΤΑΡΙΟΥ:</div>
      <div class="flex"><span>Αρχικό Ταμείο (Float):</span><span>€${Number(data.openingFloat).toFixed(2)}</span></div>
      <div class="flex"><span>Εισπράξεις Μετρητών:</span><span>€${Number(data.cashSales).toFixed(2)}</span></div>
      <div class="flex bold" style="font-size: 12px; margin-top: 2px;">
        <span>ΑΝΑΜΕΝΟΜΕΝΟ ΤΑΜΕΙΟ:</span>
        <span>€${Number(data.expectedCashInDrawer).toFixed(2)}</span>
      </div>

      <div class="double-divider"></div>
      <div class="center bold" style="font-size: 10px;">ΤΕΛΟΣ ΕΝΔΙΑΜΕΣΟΥ ΔΕΛΤΙΟΥ "Χ"</div>

      <script>
        window.onload = function() { setTimeout(function() { window.print(); }, 250); };
      </script>
    </body>
    </html>
  `);
  printWin.document.close();
}