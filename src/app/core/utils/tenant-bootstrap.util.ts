import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { DEFAULT_SHOPS, ShopInfo } from '../services/tenant-config.service';

export async function bootstrapTenantDocuments(firestore: Firestore): Promise<number> {
  let count = 0;

  for (const shop of DEFAULT_SHOPS) {
    const tenantDocRef = doc(firestore, 'tenants', shop.code);
    
    const payload: Partial<ShopInfo> = {
      code: shop.code,
      name: shop.name,
      adminPinSalt: shop.adminPinSalt || shop.code,
      adminPinHash: shop.adminPinHash || '',
      defaultFloat: Number(shop.defaultFloat ?? 50),
      defaultRegister: shop.defaultRegister || 'REG-01',
      address: shop.address || '',
      afm: shop.afm || '',
      doy: shop.doy || '',
      phone: shop.phone || '',
      currency: shop.currency || 'EUR',
      isActive: shop.isActive !== false,
      allowStoreSwitch: shop.allowStoreSwitch ?? false,
      updatedAt: new Date().toISOString()
    };

    await setDoc(tenantDocRef, payload, { merge: true });
    console.log(`[Bootstrap] Tenant parent doc created/merged: /tenants/${shop.code}`);
    count++;
  }

  return count;
}