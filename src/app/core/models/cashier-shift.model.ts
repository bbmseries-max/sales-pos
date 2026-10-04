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
  debit?: number;
  split?: number;
  total?: number;
  totalSales: number;
  transactionCount: number;
}
export type ShiftReportType = 'X-REPORT' | 'Z-REPORT';
export type CashierRole = 'ADMIN' | 'CASHIER' | 'MANAGER';

export interface Cashier {
  id: string;
  name: string;
  storeId?: string;
  pin: string;
  role: CashierRole;
  isActive: boolean;
  avatarColor?: string;
  //storeId: string;
}

export interface CashierShift {
  id: string;
  shiftNumber?: number;
  cashierId: string;
  cashierName: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  registerId?: string;
  status: 'OPEN' | 'CLOSED';
  openingFloat: number;
  cashInTotal: number;
  cashOutTotal: number;
  cashMovements?: CashMovement[];
  countedCash?: number;
  sales: ShiftPaymentSummary;
  expectedCash?: number;
  actualCountedCash?: number;
  discrepancy?: number;
  closedBy?: 'CASHIER' | 'MANAGER_FORCE' | 'SYSTEM_Z';
  notes?: string;
  countedCashInDrawer?: number;
  expectedCashInDrawer?: number;
  storeId?: string;
}