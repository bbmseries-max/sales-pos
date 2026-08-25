export interface Category {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}

export interface Product {
  id: string;
  barcode?: string;
  sku?: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  brand?: string;
  price: number;
  costPrice?: number;
  isActive?: boolean;
  vatRate: number; // e.g. 6, 13, 24
  stockQuantity?: number;
  stock?: number;
  minStockWarning?: number;
  shelfLocation?: string;
  isWeighted?: boolean;
  isPinned?: boolean;
  expire?: string;
  image?: string;
  updatedAt?: string;
  createdAt?: string;
  notes?: string;
}

export interface ScaleBarcodeResult {
  isScaleBarcode: boolean;
  itemCode?: string;
  weightKg?: number;
  priceTotal?: number;
  lookupBarcodes: string[];
}

export interface ParsedScaleBarcode {
  isScaleBarcode: boolean;
  prefix?: string;
  itemCode?: string;
  mode?: 'weight' | 'price';
  weightKg?: number;
  embeddedPrice?: number;
  priceTotal?: number;
  lookupBarcodes: string[];
}