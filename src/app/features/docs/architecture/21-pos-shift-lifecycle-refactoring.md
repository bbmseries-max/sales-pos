# POS Refactoring: Shift Handover, X-Report & Tenant Profile Hardening

## 1. Issues Resolved
1. **Duplicate X-Report & Close Handlers:**
   - Consolidated `printXReportSlip()` and `onPrintXReport()` into `handlePrintXReport()`.
   - Consolidated `onCloseZReport()` and `handleShiftClose()` into a unified closing procedure.
2. **Eliminated Hardcoded Company Profile:**
   - Created centralized `getActiveCompanyProfile()`, dynamically sourcing `name`, `address`, `afm`, `doy`, and `phone` from `tenantConfig.activeShop()`.
3. **Dynamic Default Float:**
   - Replaced static `100` float literals with `tenantConfig.activeShop()?.defaultFloat ?? 50`.
4. **Enforced Security on Close:**
   - Ensured `shiftService.lockTerminal()` is invoked on shift close, preventing unauthorized register operations before the next cashier enters their PIN.