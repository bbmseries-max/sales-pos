export interface MasterProduct {
  barcode: string;             // Primary key / EAN-13
  name: string;                // Greek product title
  brand?: string;              // Manufacturer (e.g. Παπαδοπούλου)
  categoryName: string;        // e.g. Σνακ, Γαλακτοκομικά
  imageUrl?: string;           // Product photo URL
  packageSize?: string;        // e.g. 400g, 1L
  
  // Local Operational Data
  price: number;               // Retail price gross (€)
  purchasePrice: number;       // Wholesale cost (€)
  vatRate: number;             // 24, 13, or 6
  stockQuantity: number;       // Current inventory
  expireDate?: string | null;  // YYYY-MM-DD
  isWeighted: boolean;         // True for scale items (28...)
  
  // Multitenancy & Sync
  tenantId: string;            // 'mar-market'
  updatedAt: string;           // ISO timestamp
}