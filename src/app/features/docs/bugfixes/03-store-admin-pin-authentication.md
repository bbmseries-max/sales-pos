# Bugfix: Store `adminPin` (e.g., 2435) Rejection on Lock Screen

## 1. Problem Description
When entering `2435` (the configured `adminPin` for `mar-market`), the lock screen displayed `Λάθος PIN`.

## 2. Root Cause
- `loginWithPin()` only authenticated against rows present in `marketDb.cashiers`.
- The initial admin record creation in `loadAllCashiers()` was gated behind `if (scopedList.length === 0)`.
- If any legacy or test cashier existed in Dexie, `scopedList.length > 0`, so the admin record with PIN `2435` was never written to the database.

## 3. Resolution
Added explicit fallback in `CashierShiftService.loginWithPin()`:
1. Validates against `c.pin === cleanPin` in `allCashiers()`.
2. If not found, checks if `cleanPin === activeShop.adminPin`.
3. If matched, dynamically registers and persists the Store Admin cashier (`CASH-<STORE>-ADMIN`) in Dexie, ensuring `2435` always works out of the box.