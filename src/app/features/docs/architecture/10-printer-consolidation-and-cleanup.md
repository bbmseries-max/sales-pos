# Architecture Cleanup: Single Hardware Bridge & Memory Teardown

## 1. Printer Service Unification
- **Previous State:** `pos.component.ts` injected both `EscPosPrinterService` and `ReceiptPrinterService`. Raw HTML string construction and Greek character transliteration were embedded directly in UI controller methods.
- **Current State:** Single communication channel via `BridgeService` running over `127.0.0.1:18080`.
- Thermal slip generation and ESC/POS byte packing are offloaded from `pos.component.ts`.

## 2. Resource Cleanup (`OnDestroy`)
- Added `ngOnDestroy()` lifecycle implementation.
- Explicitly clears `feedbackTimer` and `secretClickTimer` to prevent leaked intervals and callbacks on route switches.