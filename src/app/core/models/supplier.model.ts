export interface Supplier {
  id: string;
  name: string;
  afm: string;
  doy?: string;
  phone?: string;
  email?: string;
  address?: string;
  leadTimeDays?: number;
  paymentTerms?: string;
  notes?: string;
  createdAt?: string;
}

export interface PurchaseOrderItem {
  productId: string;
  barcode: string;
  name: string;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;        // Invoiced purchase cost before VAT
  vatRate: number;
  newRetailPrice?: number; // Optional retail price update if cost changed
  expiryDate?: string;     // Batch expiry date
  isReceived?: boolean;
}

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrder {
  id: string;               // e.g. "PO-2026-001"
  supplierId: string;
  supplierName: string;
  supplierAfm?: string;
  invoiceNumber?: string;   // Supplier Delivery Note / Invoice No. (π.χ. ΔΑ-49201)
  orderDate: string;
  expectedDate?: string;
  receivedDate?: string;
  items: PurchaseOrderItem[];
  status: PurchaseOrderStatus;
  subtotalCost: number;
  totalTax: number;
  grandTotalCost: number;
  notes?: string;
}