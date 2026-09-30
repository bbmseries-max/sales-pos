# Model Definition: `StockAuditLog` & `SpoilageDto` Schema Alignment

## 1. Resolution of Spoilage Type Mismatch
- Added `storeId?: string` to `CreateSpoilageDto` in `SpoilageService` to allow explicit store tagging from POS components.
- Bounded fallback to `product.storeId` when unspecified.

## 2. Model Registration: `StockAuditLog`
- Created unified interface in `market.models.ts` with strict `StockAuditReason` literals.
- Registered typed table `public stockLogs!: Table<StockAuditLog, string>` in `marketDb` (`market-db.ts`).
- Indexed on `productId`, `storeId`, `cashierId`, and `timestamp` for inventory tracking and cloud delta synchronization.