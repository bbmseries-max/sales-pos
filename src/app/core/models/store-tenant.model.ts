export interface StoreTenant {
  code: string;            // e.g. 'mar-market'
  name: string;            // e.g. 'MARANTH Market - Branch 1'
  afm: string;             // Greek AFM (e.g. '123456789')
  doy: string;             // Greek DOY
  address: string;
  phone: string;
  mydataIssuerAfm?: string;
  currency: string;
  createdAt: string;
}