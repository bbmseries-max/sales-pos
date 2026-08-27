import { Product } from './product.model';

export interface CartItem {
  product: Product;
  quantity: number;
  isRefund?: boolean;
  unitPrice?: number;
  lineTotal?: number;
  discountPercent?: number;
  discountAmount?: number;
}

export interface HeldTicket {
  id: string;
  timestamp: string;
  items: CartItem[];
  customerPhone?: string;
  customerName?: string;
  notes?: string;
}