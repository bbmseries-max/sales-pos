# Bugfix: Deprecation of `EscPosPrinterService` & Strict Type Alignment

## 1. Issues Addressed
1. **`Cannot find name 'EscPosPrinterService'`:**
   Residual calls to `printerService` were lingering in `handleShiftClose`, `printXReportSlip`, `onPrintXReport`, and `onCloseZReport`.
2. **`Property 'printShiftReport' does not exist on type 'ReceiptPrinterService'`:**
   Shift report printing was not declared on the target service.
3. **`Object is of type 'unknown'`:**
   Strict mode flags caught exceptions (`err`) and untyped promise returns as `unknown`.

## 2. Changes Applied
- Added `printShiftReport(shift, 'X' | 'Z')` to `BridgeService` routing through `http://127.0.0.1:18080/api/printer/raw`.
- Pointed all shift report actions (`handleShiftClose`, `printXReportSlip`, etc.) to `this.bridge.printShiftReport`.
- Applied explicit `instanceof Error` type narrowing on caught errors in `completeSale()` and `handleFiscalPostProcessing()`.