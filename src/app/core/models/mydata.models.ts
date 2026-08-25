export interface MyDataCredentials {
  aadeUserId: string;
  subscriptionKey: string;
  issuerAfm: string;
  environment: 'sandbox' | 'production';
  branchId?: number;
}

export type InvoiceTypeCode = 
  | '1.1'   // Τιμολόγιο Πώλησης (B2B Invoice)
  | '11.1'  // Απόδειξη Λιανικής Πώλησης (B2C Retail Receipt)
  | '11.2'  // Απόδειξη Παροχής Υπηρεσιών (B2C Service Receipt)
  | '11.4'; // Πιστωτικό Στοιχείο Λιανικής (Refund / Credit)

export interface MyDataTransmissionResponse {
  success: boolean;
  mark?: string;
  uid?: string;
  qrUrl?: string;
  errors?: string[];
  rawXmlResponse?: string;
}