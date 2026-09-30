# Architectural Review: Z-Report & Cash Drawer Reconciliation

## 1. Eliminated Inconsistencies
1. **Dynamic Multi-Tenant Header Profile:**
   - Previous state: Printed fixed AFM `123456789`, DOY `XALANDRIOU`, and `Maranth Supermarket` for every store.
   - Current state: Reads `this.tenantConfig.activeShop()` dynamically via `getCompanyProfile()`.
2. **Unified Bridge Printing:**
   - Removed direct browser Web Serial connection (`EscPosPrinterService.printViaSerial()`).
   - Routes through `BridgeService` (`127.0.0.1:18080/api/printer/raw`) with graceful fallback to browser preview if the hardware daemon is offline.
3. **Formal Day Closing & Shift Invalidation:**
   - `closeDayAndLock()` queries Dexie for all open shifts in `activeStoreCode` and updates them to `status: 'CLOSED'`.
   - Clears `currentShift` and locks the register terminal, ensuring the next business day opens fresh.
4. **Dynamic Float Initialization:**
   - Eliminated hardcoded `€100.00` float; initializes from `currentShift.openingFloat`.