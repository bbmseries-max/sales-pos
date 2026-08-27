export interface CashMovement {
  id: string;
  shiftId?: string;
  type: 'IN' | 'OUT' | 'FLOAT' | 'DROP';
  amount: number;
  reason: string;
  timestamp: string;
}

export interface ShiftPaymentSummary {
  cash: number;
  card: number;
  split: number;
  totalSales: number;
  transactionCount: number;
}

export type CashierRole = 'CASHIER' | 'MANAGER' | 'ADMIN';

export interface Cashier {
  id: string;
  name: string;
  storeId?: string;
  pin: string;
  role: 'ADMIN' | 'CASHIER';
  isActive: boolean;
  avatarColor?: string;
  //storeId: string;
}

export interface CashierShift {
  id: string;
  cashierId: string;
  cashierName: string;
  startTime: string;
  endTime?: string;
  status: 'OPEN' | 'CLOSED';
  openingFloat: number;
  cashInTotal: number;
  cashOutTotal: number;
  cashMovements?: CashMovement[];
  countedCash?: number;
  countedCashInDrawer?: number;
  expectedCashInDrawer?: number;
  discrepancy?: number;
  notes?: string;
  sales: ShiftPaymentSummary;
}