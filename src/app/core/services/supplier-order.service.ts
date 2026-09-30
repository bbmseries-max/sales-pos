import { Injectable, signal, inject } from '@angular/core';
import { marketDb } from '../db/market-db';
import { PurchaseOrder, Supplier, PurchaseOrderItem, Product } from '../models/market.models';
import { MarketCatalogService } from './market-catalog.service';

@Injectable({ providedIn: 'root' })
export class SupplierOrderService {
  private catalogService = inject(MarketCatalogService);

  public purchaseOrders = signal<PurchaseOrder[]>([]);
  public suppliers = signal<Supplier[]>([]);
  public isLoading = signal<boolean>(false);

  public async loadAll(): Promise<void> {
    this.isLoading.set(true);
    try {
      let sups = await marketDb.suppliers.toArray();

      // If no suppliers exist in Dexie DB, seed default Greek suppliers
      if (sups.length === 0) {
        await this.seedDefaultSuppliers();
        sups = await marketDb.suppliers.toArray();
      }

      const pos = await marketDb.purchaseOrders.reverse().toArray();

      this.suppliers.set(sups);
      this.purchaseOrders.set(pos);
    } catch (err) {
      console.error('Error loading supplier data:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  public async seedDefaultSuppliers(): Promise<void> {
    const defaultSuppliers: Supplier[] = [
      { id: 'SUP-01', name: 'ΔΩΔΩΝΗ Α.Ε. (Γαλακτοβιομηχανία)', afm: '094032110', phone: '2651089100', email: 'orders@dodoni.gr' },
      { id: 'SUP-02', name: 'ΟΛΥΜΠΟΣ - ΕΛΛΗΝΙΚΑ ΓΑΛΑΚΤΟΚΟΜΕΙΑ', afm: '094125890', phone: '2410688688', email: 'b2b@olympos.gr' },
      { id: 'SUP-03', name: 'BARILLA HELLAS A.E.', afm: '094002341', phone: '2105197800', email: 'sales@barilla.gr' },
      { id: 'SUP-04', name: 'COCA-COLA 3E ΕΛΛΑΔΟΣ', afm: '094003882', phone: '2106381200', email: 'orders@coca-cola.gr' }
    ];
    await marketDb.suppliers.bulkPut(defaultSuppliers);
  }

  public async addCustomSupplier(supplier: Omit<Supplier, 'id'>): Promise<Supplier> {
    const newSup: Supplier = {
      ...supplier,
      id: 'SUP-' + Date.now().toString(36).toUpperCase()
    };
    await marketDb.suppliers.add(newSup);
    await this.loadAll();
    return newSup;
  }

  public async createPurchaseOrder(po: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const id = po.id || `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    
    let subtotalCost = 0;
    let totalTax = 0;

    const items: PurchaseOrderItem[] = (po.items || []).map((item: PurchaseOrderItem) => {
      const lineCost = item.orderedQty * item.unitCost;
      const lineVat = lineCost * (item.vatRate / 100);
      subtotalCost += lineCost;
      totalTax += lineVat;
      return {
        ...item,
        receivedQty: item.receivedQty || 0,
        isReceived: false
      };
    });

    const newPO: PurchaseOrder = {
      id,
      supplierId: po.supplierId || '',
      supplierName: po.supplierName || 'General Supplier',
      supplierAfm: po.supplierAfm,
      invoiceNumber: po.invoiceNumber || '',
      orderDate: po.orderDate || new Date().toISOString().split('T')[0],
      items,
      status: 'ORDERED',
      subtotalCost: Number(subtotalCost.toFixed(2)),
      totalTax: Number(totalTax.toFixed(2)),
      grandTotalCost: Number((subtotalCost + totalTax).toFixed(2)),
      notes: po.notes || ''
    };

    await marketDb.purchaseOrders.add(newPO);
    await this.loadAll();
    return newPO;
  }

  public async receiveDelivery(
    poId: string,
    invoiceNo: string,
    items: PurchaseOrderItem[],
    cashierName: string = 'Υπεύθυνος Αποθήκης',
    storeId: string = 'mar-market'
  ): Promise<void> {
    await marketDb.transaction('rw', [marketDb.products, (marketDb as any).purchaseOrders, (marketDb as any).stockLogs], async () => {
      for (const item of items) {
        const received = Number(item.receivedQty || 0);
        if (received <= 0) continue;

        const dbProduct = await marketDb.products.get(item.productId);
        if (dbProduct) {
          const currentQty = Number(dbProduct.stockQuantity ?? 0);
          const newQty = parseFloat((currentQty + received).toFixed(3));

          // 1. Increment Physical Stock, update Cost Price and Expiry Date
          await marketDb.products.update(dbProduct.id!, {
            stockQuantity: newQty,
            costPrice: item.unitCost ? Number(item.unitCost) : dbProduct.costPrice,
            expire: item.expiryDate || dbProduct.expire,
            statusDate: item.expiryDate || dbProduct.statusDate,
            storeId: dbProduct.storeId || storeId,
            updatedAt: new Date().toISOString(),
            _syncStatus: 'dirty'
          });

          // 2. Append to immutable StockAuditLog ledger
          if ((marketDb as any).stockLogs) {
            await (marketDb as any).stockLogs.put({
              id: `STK-DELIV-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              productId: dbProduct.id,
              productName: dbProduct.name,
              barcode: dbProduct.barcode,
              storeId: dbProduct.storeId || storeId,
              cashierId: 'SYSTEM',
              cashierName,
              previousQuantity: currentQty,
              newQuantity: newQty,
              delta: received,
              reason: 'DELIVERY',
              timestamp: new Date().toISOString(),
              _syncStatus: 'dirty'
            });
          }
        }
      }

      // Mark the Purchase Order as RECEIVED
      if ((marketDb as any).purchaseOrders) {
        await (marketDb as any).purchaseOrders.update(poId, {
          status: 'RECEIVED',
          invoiceNumber: invoiceNo,
          receivedAt: new Date().toISOString(),
          items
        });
      }
    });

    await this.loadAll();
  }
}