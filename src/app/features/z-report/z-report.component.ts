import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ZReportService } from '../../core/services/z-report.service';
import { BridgeService } from '../../core/services/bridge.service';
import { CashierShiftService } from '../../core/services/cashier-shift.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { ZReportAudit, CashDenominationCount } from '../../core/models/z-report.model';
import { MarketCompanyProfile } from '../../core/models/market.models';
import { marketDb } from '../../core/db/market-db';

@Component({
  selector: 'app-z-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './z-report.component.html'
})
export class ZReportComponent implements OnInit {
  public zService = inject(ZReportService);
  public tenantConfig = inject(TenantConfigService);
  public shiftService = inject(CashierShiftService);
  public bridge = inject(BridgeService);
  private router = inject(Router);

  public auditData = signal<ZReportAudit | null>(null);
  public isLoading = signal<boolean>(true);

  // Cash Reconciliation State (Derived dynamically from active shift)
  public openingFloat = signal<number>(0.00);
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
    const activeShift = this.shiftService.currentShift();
    if (activeShift) {
      this.openingFloat.set(activeShift.openingFloat || 0);
      this.cashIn.set(activeShift.cashInTotal || 0);
      this.cashOut.set(activeShift.cashOutTotal || 0);
    }
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
    return Number(
      this.denominations().reduce((sum, item) => sum + (item.denomination * item.count), 0).toFixed(2)
    );
  }

  public getCompanyProfile(): MarketCompanyProfile {
    const shop = this.tenantConfig.activeShop();
    return {
      storeName: shop?.name || 'MARANTH RETAIL',
      address: shop?.address || 'Αθήνα',
      afm: shop?.afm || '000000000',
      doy: shop?.doy || 'ΔΟΥ',
      phone: shop?.phone || ''
    };
  }

  public async printZReport(): Promise<void> {
    const audit = this.auditData();
    if (!audit) return;

    const company = this.getCompanyProfile();

    try {
      const printed = await this.bridge.printShiftReport(
        {
          ...audit,
          company
        },
        'Z'
      );

      if (!printed) {
        this.printPreviewInBrowser(audit, company);
      }
    } catch (e) {
      console.warn('[Z-Report] Hardware bridge failed, falling back to browser print:', e);
      this.printPreviewInBrowser(audit, company);
    }
  }

  public async closeDayAndLock(): Promise<void> {
    const confirmed = window.confirm(
      'ΠΡΟΣΟΧΗ: Θέλετε να εκδώσετε οριστικά το Δελτίο "Ζ" και να μηδενίσετε το ημερήσιο ταμείο;'
    );
    if (!confirmed) {
      return;
    }

    const activeStoreCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    const counted = this.auditData()?.actualCountedCash ?? this.calculateDenominationsTotal();

    try {
      this.isClosed.set(true);

      // 1. Properly close the active shift through CashierShiftService
      if (this.shiftService.currentShift()) {
        await this.shiftService.closeShift(counted, `Κλείσιμο Ημέρας (Ζ #${this.auditData()?.zNumber || 1})`);
      } else {
        // Fallback: close any orphaned open shifts in DB for this store
        const openShifts = await marketDb.shifts
          .where('storeId')
          .equals(activeStoreCode)
          .and(s => s.status === 'OPEN')
          .toArray();

        const now = new Date().toISOString();
        for (const s of openShifts) {
          if (s.id) {
            await marketDb.shifts.update(s.id, {
              status: 'CLOSED',
              endTime: now,
              notes: 'Κλείσιμο Ημέρας (Ζ)'
            });
          }
        }
        this.shiftService.lockTerminal();
      }

      // 2. Increment Z number
      this.zService.currentZNumber.update(n => n + 1);

      // 3. Trigger printing non-blockingly (Bridge or Browser Popup)
      this.printZReport().catch(err => console.warn('[Z-Report] Print failed:', err));

    } catch (err) {
      console.error('Failed to close shift:', err);
      alert('Σφάλμα κατά το κλείσιμο βάρδιας.');
      return;
    }

    // 4. Clean navigate to POS in locked state
    await this.router.navigate(['/pos'], {
      queryParams: { shop: activeStoreCode },
      replaceUrl: true
    });
  }

  public backToPos(): void {
    const activeStoreCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    this.router.navigate(['/pos'], {
      queryParams: { shop: activeStoreCode }
    });
  }

  private printPreviewInBrowser(z: ZReportAudit, company: MarketCompanyProfile): void {
  const printWin = window.open('', '_blank', 'width=460,height=780,menubar=no,toolbar=no,location=no,status=no');
  if (!printWin) {
    console.warn('Popup blocked. Please allow popups for printing.');
    return;
  }

  const vatRows = Object.entries(z.vatAnalysis || {})
    .filter(([_, d]) => d.gross > 0)
    .map(([_, d]) => `
      <tr>
        <td>${d.rate}%</td>
        <td style="text-align: right;">€${d.net.toFixed(2)}</td>
        <td style="text-align: right;">€${d.vat.toFixed(2)}</td>
        <td style="text-align: right;">€${d.gross.toFixed(2)}</td>
      </tr>
    `).join('');

  const html = `<!DOCTYPE html>
<html lang="el">
<head>
  <meta charset="utf-8">
  <title>Δελτίο Ζ #${z.zNumber}</title>
  <style>
    @media print {
      .no-print { display: none !important; }
      body { margin: 0; padding: 0; }
    }
    body {
      font-family: 'Courier New', Courier, monospace;
      width: 76mm;
      margin: 0 auto;
      padding: 10px 5px;
      font-size: 11px;
      color: #000;
      background: #fff;
    }
    .action-bar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ccc;
    }
    .action-bar button {
      flex: 1;
      padding: 8px 12px;
      font-weight: bold;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid #333;
    }
    .btn-print { background: #2563eb; color: #fff; border-color: #1d4ed8; }
    .btn-close { background: #e5e7eb; color: #111; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 5px 0; }
    .double-divider { border-top: 2px solid #000; margin: 6px 0; }
    .flex { display: flex; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
  </style>
</head>
<body>
  <div class="no-print action-bar">
    <button class="btn-print" onclick="window.print()">Εκτύπωση</button>
    <button class="btn-close" onclick="window.close()">Κλείσιμο</button>
  </div>

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
  <table>
    <thead>
      <tr><th style="text-align: left;">ΣΥΝΤ</th><th style="text-align: right;">ΚΑΘΑΡΟ</th><th style="text-align: right;">ΦΠΑ</th><th style="text-align: right;">ΣΥΝΟΛΟ</th></tr>
    </thead>
    <tbody>
      ${vatRows}
    </tbody>
  </table>
  <div class="double-divider"></div>
  <div class="bold">ΤΑΜΕΙΑΚΟ ΙΣΟΖΥΓΙΟ:</div>
  <div class="flex"><span>Αρχικό Ταμείο:</span><span>€${z.openingFloat.toFixed(2)}</span></div>
  <div class="flex"><span>Εισπράξεις Μετρητών:</span><span>€${z.salesCash.toFixed(2)}</span></div>
  <div class="flex"><span>Αναμενόμενο:</span><span>€${z.expectedDrawerCash.toFixed(2)}</span></div>
  <div class="flex bold"><span>Καταμετρημένο:</span><span>€${z.actualCountedCash.toFixed(2)}</span></div>
  <div class="flex bold"><span>ΔΙΑΦΟΡΑ (${z.variance >= 0 ? 'Πλεόνασμα' : 'Έλλειμμα'}):</span><span>€${Math.abs(z.variance).toFixed(2)}</span></div>
  <div class="double-divider"></div>
  <div class="center bold">ΓΕΝΙΚΟ ΠΡΟΟΔΕΥΤΙΚΟ: €${z.progressiveGrandTotal.toFixed(2)}</div>
  <div class="center" style="margin-top: 8px;">ΤΕΛΟΣ ΗΜΕΡΗΣΙΟΥ ΔΕΛΤΙΟΥ "Ζ"</div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 300);
    };
  </script>
</body>
</html>`;

 printWin.document.documentElement.innerHTML = html;
}
}