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
  unitCost: number;
  vatRate: number;
  newRetailPrice?: number;
  expiryDate?: string;
  isReceived?: boolean;
}

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierAfm?: string;
  invoiceNumber?: string;
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