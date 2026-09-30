# Service Hardening: Cashier & Shift Scoping (`cashier-shift.service.ts`)

## 1. Eliminated Issues
1. **Removed Arbitrary Hardcoded PINs (`1111`, `2222`, `3333`):**
   Initial cashier records use `activeShop.adminPin` directly.
2. **Removed Forced Default Float (`100`):**
   Opening float defaults to `0` or uses the exact value passed in by the cashier during shift initialization (`loginWithPin(pin, float)`).
3. **Tenant-Scoped Cashier Queries:**
   `loadAllCashiers()` strictly selects cashiers matching `storeId === activeShop.code`.
4. **Tenant-Scoped Shifts:**
   Active shift checks verify both `cashierId` and `storeId === activeShopCode`.
5. **Session Cross-Contamination Guard:**
   `getInitialCashier()` detects if cached session data belongs to a different store and purges it immediately.

## 2. Verification Steps
- [ ] Save the updated `cashier-shift.service.ts`.
- [ ] Verify project compilation without TypeScript errors.
- [ ] Open `?store=mar-market`, verify only Maranth Central staff appear.
- [ ] Open `?store=ftest`, verify staff from `mar-market` do not appear.