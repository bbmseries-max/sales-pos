// src/app/core/models/audit-log.model.ts

export type SpoilageReason = 'EXPIRED' | 'DAMAGED' | 'THEFT' | 'SAMPLE' | 'INTERNAL_USE';

export interface SpoilageLog {
  id: string;
  productId: string;
  barcode: string;
  name: string;
  categoryName?: string;
  quantity: number;
  unitCost: number;
  retailPrice: number;
  totalLossCost: number;
  reason: SpoilageReason;
  timestamp: string;
  cashierName?: string;
  notes?: string;
}

export interface CashLog {
  id: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason: string;
  timestamp: string;
  cashierName?: string;
}