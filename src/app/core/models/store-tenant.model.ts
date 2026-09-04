export interface StoreTenant {
  code: string;
  id?: string;
  name: string;
  afm: string;
  doy: string;
  address: string;
  phone?: string;
  mydataIssuerAfm?: string;
  hardwareSettings?: StoreHardwareSettings;
  [key: string]: any;
  currency: string;
  createdAt: string;
}

export type PrinterDriver = 'browser' | 'escpos-usb' | 'escpos-bluetooth' | 'network';
export type PaperWidth = '58mm' | '80mm';

export interface StoreHardwareSettings {
  printerDriver: PrinterDriver;
  paperWidth: PaperWidth;
  autoPrintReceipt: boolean;
  printMyDataQr: boolean;
  printerIp?: string; // For network receipt printers
  headerNote?: string;
  footerNote?: string;
}