import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ZReportService } from '../../core/services/z-report.service';
import { EscPosPrinterService } from '../../core/services/esc-pos-printer.service';
import { ZReportAudit, CashDenominationCount } from '../../core/models/z-report.model';
import { MarketCompanyProfile } from '../../core/models/market.models';

@Component({
  selector: 'app-z-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './z-report.component.html'
})
export class ZReportComponent implements OnInit {
  private zService = inject(ZReportService);
  private printerService = inject(EscPosPrinterService);
  private router = inject(Router);

  public auditData = signal<ZReportAudit | null>(null);
  public isLoading = signal<boolean>(true);

  // Cash Reconciliation State
  public openingFloat = signal<number>(100.00);
  public cashIn = signal<number>(0.00);
  public cashOut = signal<number>(0.00);
  public isClosed = signal<boolean>(false);

  // Currency Denomination Counter
  public denominations = signal<CashDenominationCount[]>([
    { denomination: 100, count: 0 },
    { denomination: 50, count: 0 },
    { denomination: 20, count: 0 },
    { denomination: 10, count: 0 },
    { denomination: 5, count: 0 },
    { denomination: 2, count: 0 },
    { denomination: 1, count: 0 },
    { denomination: 0.50, count: 0 },
    { denomination: 0.20, count: 0 },
    { denomination: 0.10, count: 0 }
  ]);

  async ngOnInit(): Promise<void> {
    await this.calculateAudit();
  }

  public async calculateAudit(): Promise<void> {
    this.isLoading.set(true);
    const countedTotal = this.calculateDenominationsTotal();
    
    const report = await this.zService.generateDailyAudit(
      new Date(),
      this.openingFloat(),
      countedTotal,
      this.cashIn(),
      this.cashOut()
    );

    this.auditData.set(report);
    this.isLoading.set(false);
  }

  public onDenominationChange(index: number, val: number): void {
    const list = [...this.denominations()];
    list[index].count = Math.max(0, val || 0);
    this.denominations.set(list);
    this.calculateAudit();
  }

  public calculateDenominationsTotal(): number {
    return this.denominations().reduce((sum, item) => sum + (item.denomination * item.count), 0);
  }

  public async printZReport(): Promise<void> {
    const audit = this.auditData();
    if (!audit) return;

    const company: MarketCompanyProfile = {
      storeName: 'MARANTH SUPERMARKET',
      address: 'Leof. Pentelis 45, Vrilissia',
      afm: '123456789',
      doy: 'XALANDRIOU',
      phone: '210-6800000'
    };

    const rawBuffer = this.zService.buildEscPosZReport(audit, company);
    const printedSerial = await this.printerService.printViaSerial(rawBuffer);

    if (!printedSerial) {
      this.printPreviewInBrowser(audit, company);
    }
  }

  public closeDayAndLock(): void {
    if (confirm('ΠΡΟΣΟΧΗ: Θέλετε να εκδώσετε οριστικά το Δελτίο "Ζ" και να μηδενίσετε το ημερήσιο ταμείο;')) {
      this.isClosed.set(true);
      this.printZReport();
      this.zService.currentZNumber.update(n => n + 1);
    }
  }

  public backToPos(): void {
    this.router.navigate(['/pos']);
  }

  private printPreviewInBrowser(z: ZReportAudit, company: MarketCompanyProfile): void {
    const printWin = window.open('', '_blank', 'width=420,height=700');
    if (!printWin) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>ΗΜΕΡΗΣΙΟ ΔΕΛΤΙΟ "Ζ" #${z.zNumber}</title>
        <style>
          @page { margin: 0; size: 80mm auto; }
          body { font-family: 'Courier New', monospace; width: 76mm; margin: 0 auto; padding: 3mm; font-size: 11px; }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 4px 0; }
          .double-divider { border-top: 2px solid #000; margin: 5px 0; }
          .flex { display: flex; justify-content: space-between; }
        </style>
      </head>
      <body onload="window.print(); window.close();">
        <div class="center bold" style="font-size: 14px;">${company.storeName}</div>
        <div class="center">ΑΦΜ: ${company.afm} • ΔΟΥ: ${company.doy}</div>
        <div class="double-divider"></div>
        <div class="center bold" style="font-size: 15px;">ΔΕΛΤΙΟ "Ζ" ΑΡ. ${z.zNumber}</div>
        <div class="double-divider"></div>
        <div class="flex"><span>ΗΜ/ΝΙΑ: ${new Date(z.closedAt).toLocaleDateString('el-GR')}</span><span>ΩΡΑ: ${new Date(z.closedAt).toLocaleTimeString('el-GR')}</span></div>
        <div class="flex"><span>ΤΑΜΕΙΟ: ${z.registerId}</span><span>ΧΕΙΡΙΣΤΗΣ: ${z.cashierName}</span></div>
        <div class="flex"><span>ΑΠΟΔΕΙΞΕΙΣ: ${z.transactionCount}</span></div>
        <div class="divider"></div>
        <div class="flex bold"><span>ΑΚΑΘΑΡΙΣΤΟΣ ΤΖΙΡΟΣ:</span><span>€${z.grossTurnover.toFixed(2)}</span></div>
        <div class="flex"><span>ΚΑΘΑΡΗ ΑΞΙΑ:</span><span>€${z.netTurnover.toFixed(2)}</span></div>
        <div class="flex"><span>ΣΥΝΟΛΟ Φ.Π.Α.:</span><span>€${z.totalTax.toFixed(2)}</span></div>
        <div class="divider"></div>
        <div class="bold">ΑΝΑΛΥΣΗ ΠΛΗΡΩΜΩΝ:</div>
        <div class="flex"><span>  ΜΕΤΡΗΤΑ:</span><span>€${z.salesCash.toFixed(2)}</span></div>
        <div class="flex"><span>  ΚΑΡΤΕΣ / POS:</span><span>€${z.salesCard.toFixed(2)}</span></div>
        <div class="double-divider"></div>
        <div class="bold center">ΑΝΑΛΥΣΗ Φ.Π.Α.</div>
        <table style="width: 100%; font-size: 10px;">
          <tr><th align="left">ΣΥΝΤ</th><th align="right">ΚΑΘΑΡΟ</th><th align="right">ΦΠΑ</th><th align="right">ΣΥΝΟΛΟ</th></tr>
          ${Object.entries(z.vatAnalysis).filter(([_, d]) => d.gross > 0).map(([_, d]) => `
            <tr>
              <td>${d.rate}%</td>
              <td align="right">€${d.net.toFixed(2)}</td>
              <td align="right">€${d.vat.toFixed(2)}</td>
              <td align="right">€${d.gross.toFixed(2)}</td>
            </tr>
          `).join('')}
        </table>
        <div class="double-divider"></div>
        <div class="bold">ΤΑΜΕΙΑΚΟ ΙΣΟΖΥΓΙΟ:</div>
        <div class="flex"><span>Αρχικό Ταμείο (Float):</span><span>€${z.openingFloat.toFixed(2)}</span></div>
        <div class="flex"><span>Εισπράξεις Μετρητών:</span><span>€${z.salesCash.toFixed(2)}</span></div>
        <div class="flex"><span>Αναμενόμενο Ταμείο:</span><span>€${z.expectedDrawerCash.toFixed(2)}</span></div>
        <div class="flex bold"><span>Καταμετρημένο:</span><span>€${z.actualCountedCash.toFixed(2)}</span></div>
        <div class="flex bold" style="font-size: 12px;"><span>ΔΙΑΦΟΡΑ (${z.variance >= 0 ? 'Πλεόνασμα' : 'Έλλειμμα'}):</span><span>€${Math.abs(z.variance).toFixed(2)}</span></div>
        <div class="double-divider"></div>
        <div class="center bold">ΓΕΝΙΚΟ ΠΡΟΟΔΕΥΤΙΚΟ: €${z.progressiveGrandTotal.toFixed(2)}</div>
        <div class="center" style="margin-top: 6px;">ΤΕΛΟΣ ΗΜΕΡΗΣΙΟΥ ΔΕΛΤΙΟΥ "Ζ"</div>
      </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  }
}