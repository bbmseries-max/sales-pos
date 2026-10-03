# Store PIN Authentication & Regression Test Suite

## Overview
Resolved multi-tenant authentication failures across stores (`parnasos`, `ftest`, `mar-market`), unified SHA-256 salted PIN hash configurations, and added an automated Vitest regression suite to prevent future drift.

---

## 1. Root Cause Analysis

1. **Hash Mismatch & Runtime Salting**:
   * Plain store PINs are hashed using the formula `SHA-256("${salt}:${pin}")`.
   * Stale or unaligned hash entries in `DEFAULT_SHOPS` caused PIN authentication to fail across environments.
   * `parnasos` generated hash discrepancies between local iterations until the runtime-evaluated SHA-256 value (`ca4bd03986619a01a38d485124ce7b251f158431986027d2e915fb8ba459991f`) was locked into configuration.

2. **Test Runner Environment Dependencies**:
   * Running tests under Vitest encountered missing browser APIs in the default Node.js environment:
     * `ReferenceError: localStorage is not defined`
     * `Error: Need to call TestBed.initTestEnvironment() first`
     * `MissingAPIError: IndexedDB API missing` (from Dexie in `CashierShiftService`).

---

## 2. Verified Store Credentials & Hashes

The production configuration in `src/app/core/services/tenant-config.service.ts` (`DEFAULT_SHOPS`) is locked to:

| Store Code | Store Name | Admin PIN | Salt | Verified SHA-256 Hash |
| :--- | :--- | :--- | :--- | :--- |
| `mar-market` | Maranth Market (Central) | `2435` | `mar-market` | `9b0919b5f30eaf305e85a691684b27c38014260204851be92d652856b0893fee` |
| `ftest` | Epta Enteka | `5564` | `ftest` | `75b6ee7b2c5dc649749ba20f8c3752e5052feefc5332f144d18ecf518e388c6b` |
| `parnasos` | Maranth Parnassos | `1978` | `parnasos` | `ca4bd03986619a01a38d485124ce7b251f158431986027d2e915fb8ba459991f` |

---

## 3. Key Code Changes

### `src/app/core/services/tenant-config.service.ts`
* Exported `DEFAULT_SHOPS` to make configuration accessible to tests and external initializers.
* Replaced outdated admin PIN hash strings with verified hashes for all three stores.

### `src/app/core/services/cashier-shift.service.ts`
* Removed temporary `[DEBUG AUTH]` console logging statements in `loginWithPin()` to ensure clean production builds.

### `src/app/core/services/store-pin-auth.spec.ts` (New Test Suite)
Created automated test coverage with:
1. **Static Hash Integrity Suite**: Validates that any changes to `DEFAULT_SHOPS` (salts, PINs, or hashes) match mathematical SHA-256 output.
2. **Service Login Flow Suite**: Validates `loginWithPin()` against valid PINs and ensures invalid inputs (`0000`) are rejected.
3. **Environment Polyfills**:
   * Uses `fake-indexeddb/auto` to back Dexie during headless test execution.
   * Initializes Angular's test environment via `TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting())`.

---

## 4. Test Verification Command

Run the test suite anytime using Vitest:

```bash
npx vitest run src/app/core/services/store-pin-auth.spec.ts

✓ src/app/core/services/store-pin-auth.spec.ts (5 tests)
   ✓ Store PIN Authentication & Hash Integrity (5)
     ✓ Static Hash Integrity (3)
       ✓ verifies PIN hash for shop: mar-market
       ✓ verifies PIN hash for shop: ftest
       ✓ verifies PIN hash for shop: parnasos
     ✓ CashierShiftService Login Flow (2)
       ✓ authenticates mar-market with correct PIN
       ✓ rejects an invalid PIN

 Test Files  1 passed (1)
      Tests  5 passed (5)