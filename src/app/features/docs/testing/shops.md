https://your-domain.com/?shop='code'
https://your-domain.com/?shop=mar-market  2435
https://www.maranth.gr/?shop=parnasos   1978
https://your-domain.com/?shop=ftest    5564
export interface ShopInfo {
  code: string;
  name: string;
  adminPinSalt?: string;
  adminPinHash?: string; // SHA-256 hash of salt:pin
  defaultFloat?: number;
  defaultRegister?: string;
  address?: string;
  afm?: string;
  doy?: string;
  phone?: string;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean;
  fiscalMode?: FiscalMode;
  fhmEndpoint?: string;
  providerApiKey?: string;
}

const DEFAULT_SHOPS: ShopInfo[] = [
  {
    code: 'mar-market',
    name: 'Maranth Market (Central)',
    adminPinSalt: 'mar-market',
    // Hash of "mar-market:2435"
    adminPinHash: '9b0919b5f30eaf305e85a691684b27c38014260204851be92d652856b0893fee', // PIN: 2435
    defaultFloat: 100,
    defaultRegister: 'REG-01',
    address: 'Leof. Pentelis 45, Vrilissia',
    afm: '123456789',
    doy: 'XALANDRIOU',
    phone: '210-6800000',
    currency: 'EUR',
    isActive: true,
  },
  {
    code: 'ftest',
    name: 'Epta Enteka',
    adminPinSalt: 'ftest',
    // Hash of "ftest:5564"
    adminPinHash: '75b6ee7b2c5dc649749ba20f8c3752e5052feefc5332f144d18ecf518e388c6b', // PIN: 5564
    defaultFloat: 50,
    defaultRegister: 'REG-01',
    address: 'Plateia Agias Paraskevis 12',
    afm: '998877665',
    doy: 'AGIAS PARASKEVIS',
    phone: '210-6001122',
    currency: 'EUR',
    isActive: true,
  },
  {
    code: 'parnasos',
    name: 'Maranth Parnassos',
    adminPinSalt: 'parnasos',
    // Hash of "parnasos:1978"
    adminPinHash: '1a50a1dff548d88e04043b3ae0ae5cb8e30b3552b7ee9ebfaaa26aa57ebba724', // PIN: 1978
    defaultFloat: 50,
    defaultRegister: 'REG-01',
    address: 'Αρηστοτελους 103',
    afm: '887766554',
    doy: 'ΚΕΦΟΔΕ',
    phone: '22670-31000',
    currency: 'EUR',
    isActive: true,
  }
];
hash creation console.log
async function getHash(pin, salt) {
  const enc = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}  

or 

await tenantConfig.registerNewStore({
  code: 'glyfada-store',
  name: 'Maranth Glyfada',
  afm: '999111222',
  doy: 'GLYFADAS',
  address: 'Metaxa 10',
  adminPin: '1234' // <--- Set the plain 4-digit PIN here
});



,
  {
    code: 'new-store01',
    name@: 'New Store01',
    adminPinHash: 'ca4bd03986619a01a38d485124ce7b251f158431986027d2e915fb8ba459991f', // PIN: 5545
    defaultFloat: 50,
    defaultRegister: 'REG-01',
    address: 'Αρησ 10',
    afm: '887776554',
    doy: 'ΚΕΦΟΔΕ',
    phone: '22670-31111',
    currency: 'EUR',
    isActive: true,
  }

  iform firebase with 
  await seedTenants();