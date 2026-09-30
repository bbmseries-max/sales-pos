# Architectural Review: Spoilage Logger (`spoilage-logger.component.ts`)

## 1. Eliminated Inconsistencies
1. **Removed `EscPosPrinterService` Web Serial Call:**
   - Previous behavior: Invoked raw Web Serial API bytes (`printViaSerial`), which fails on browser POS terminals without direct USB permissions.
   - New behavior: Dispatches structured `SPOILAGE_PROTOCOL` payloads to `BridgeService` (`127.0.0.1:18080`).
2. **Tenant Scoping for Spoilage:**
   - `filteredLogs` and `productMatches` now filter by `storeId === activeShop.code`, preventing multi-tenant data leaks in cost aggregations.
3. **Double Submission Guard:**
   - Added `isSaving = signal<boolean>(false)` early-exit guard to prevent rapid double-registration of spoilage records.
4. **Weighted Product Support:**
   - Detects `prod.isWeighted` to initialize fractional quantity defaults (`0.500 kg`) rather than locking to integer unit steps.