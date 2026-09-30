# POS Imports & Dependency Analysis (`pos.component.ts`)

## 1. Dependency Map & Anomaly Audit

| Imported Dependency | Injected Token | Purpose in Component | Identified Issue / Risk |
| :--- | :--- | :--- | :--- |
| `EscPosPrinterService` | `printerService` | Greek transliteration, HTML slip, X/Z reports | **Duplicate printer service**: works alongside `ReceiptPrinterService` causing duplicated or conflicting print calls. |
| `ReceiptPrinterService` | `receiptPrinter` | Receipt printing on `completeSale()` | Ambiguous division of labor with `EscPosPrinterService`. |
| `marketDb` | Direct import | Direct Dexie calls (`products.toArray()`, `transactions.put()`) | **Leaky Abstraction**: UI accesses database directly instead of through `SyncService` or `MarketCatalogService`. |
| `Router` / `RouterLink` | `router` | Navigation to `/inventory`, `/labels`, `/spoilage` | HostListener `window:keydown` in POS component could cause ghost scanning events if route transitions occur without teardown. |
| Modal Components (8) | Template tags | Standalone child modals | Inconsistent: 8 modals are extracted, while 6 remain inline, inflating the parent component. |

---

## 2. Refactoring Targets

### A. Printer Service Consolidation
Unify `EscPosPrinterService` and `ReceiptPrinterService` under a single facade service:
- Provide unified methods: `printReceipt(tx)`, `printShiftReport(shift, 'X' | 'Z')`, `openCashDrawer()`.
- Eliminate duplicate injections from `pos.component.ts`.

### B. Encapsulate Dexie Writes
Move all `marketDb.transactions.put(tx)` calls out of `pos.component.ts` into `SyncService` or `TransactionService` to guarantee offline queue flags (`_syncStatus = 'dirty'`) and Firestore sync triggers are centralized.

### C. Modal Architecture Standardization
Extract the remaining 6 inline modals into standalone components matching the pattern used by `PosPriceCheckModalComponent` and `PosCashDrawerModalComponent`.