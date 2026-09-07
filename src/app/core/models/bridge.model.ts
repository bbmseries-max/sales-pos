// 1. Represents the GET /health response
export interface BridgeHealthResponse {
  status: 'ready' | 'offline';
  version: string;
  peripherals?: {
    printer?: { connected: boolean; target: string };
    scale?: { connected: boolean; target: string };
    eft?: { connected: boolean; ip: string };
  };
}

// 2. Represents the POST /api/printer/raw request payload
export interface PrintReceiptPayload {
  openDrawer: boolean;
  cutPaper: boolean;
  lines: Array<{
    text?: string;
    columns?: [string, string];
    align?: 'left' | 'center' | 'right';
    bold?: boolean;
    size?: 'normal' | 'double' | 'wide';
  }>;
  qrCodeData?: string;
}

// 3. Represents the POST /api/eft/charge request & response
export interface EftChargeRequest {
  amount: number;
  currency: 'EUR';
  invoiceId: string;
}

export interface EftChargeResponse {
  status: 'APPROVED' | 'DECLINED' | 'ERROR';
  authCode: string;
  tid: string;
  mid: string;
  batchNumber: string;
  receiptText: string;
}