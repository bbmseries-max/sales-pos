# Bugfix: SpoilageService Parameter Unification & Scope Alignment

## 1. Root Cause
In `spoilage.service.ts`:
- Parameter signature used an inline literal `{ product, quantity, reason, cashierName, notes }` missing `storeId`.
- The method body referenced `data.storeId` and `data.product.storeId`, but the argument was named `params`, throwing `Cannot find name 'data'`.

## 2. Changes Applied
- Replaced the inline literal parameter with `params: CreateSpoilageDto`.
- Destructured `storeId` directly from `params`.
- Resolved `resolvedStoreId` using fallback priority: `storeId || product.storeId || activeStoreCode`.
- Unified store stamping across both `spoilageLogs` and `products` tables.