import { Routes } from '@angular/router';
import { PosComponent } from './features/pos/pos.component';
import { InventoryComponent } from './features/inventory/inventory.component';
import { ShelfLabelsComponent } from './features/shelf-labels/shelf-labels.component';
import { ZReportComponent } from './features/z-report/z-report.component';
import { GoodsReceiptComponent } from './features/inventory/goods-receipt.component';
import { SpoilageLoggerComponent } from './features/inventory/spoilage-logger.component';
import { CatalogImportService } from './core/services/catalog-import.service';
export const routes: Routes = [
  { path: '', redirectTo: 'pos', pathMatch: 'full' },
  { path: 'pos', component: PosComponent },
  { path: 'inventory', component: InventoryComponent },
  { path: 'deliveries', component: GoodsReceiptComponent },
  { path: 'spoilage', component: SpoilageLoggerComponent },
  { path: 'import', component: CatalogImportService },
  { path: 'labels', component: ShelfLabelsComponent },
  { path: 'z-report', component: ZReportComponent }
];