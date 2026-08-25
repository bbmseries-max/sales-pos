export interface ToastNotification {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

export interface ShelfLabelPrintJob {
  productId: string;
  productName: string;
  barcode: string;
  price: number;
  vatRate: number;
  copies: number;
}