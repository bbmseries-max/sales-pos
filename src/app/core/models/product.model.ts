export interface Category {
  id: string;
  name: string;
  tenantId?: string;
  icon?: string;
  count?: number;
}

export interface Product {
  id?: string;
  barcode: string;
  name: string;
  price: number;
  costPrice?: number;
  purchasePrice?: number;
  vatRate: number;
  stockQuantity: number;
  stock?: number;
  categoryId: string;
  categoryName?: string;
  brand?: string;
  packageSize?: string;
  imageUrl?: string;
  image?: string;
  shelfLocation?: string;
  minStockWarning?: number;   // <-- Added
  isActive?: boolean;
  createdAt?: string;
  expire?: string;
  statusDate?: string;
  isWeighted?: boolean;
  isPinned?: boolean;
  sku?: string;
  tenantId?: string;
  storeId?: string;
  updatedAt?: string;
  notes?: string;
  deletedAt?: string;
  _syncStatus?: 'synced' | 'dirty' | 'pending';
}