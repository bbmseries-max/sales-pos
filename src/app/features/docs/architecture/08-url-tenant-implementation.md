# Implementation Reference: URL Query Parameter Store Routing

## 1. File Modified
`src/app/core/services/tenant-config.service.ts`

## 2. Changes Applied
- Added inspection of `window.location.search` for `?store=` or `?shop=` in `getInitialShop()`.
- Added safety check: when URL specifies a different store than what was previously cached in `localStorage`, `sessionStorage.removeItem('active_cashier_data')` fires to prevent cashier session bleed across stores.
- Preserved `localStorage` caching so the register remembers the store if the cashier refreshes or navigates without query params.

## 3. Demo Delivery URLs

| Target Business | Demo Link | Notes |
| :--- | :--- | :--- |
| **Maranth Central** | `https://maranth.gr/pos?store=mar-market` | Supermarket catalog & profile |
| **Epta Enteka** | `https://maranth.gr/pos?store=ftest` | Mini-market profile |
| **Maranth Parnassos** | `https://maranth.gr/pos?store=parnasos` | Specialty grocery profile |

## 4. Next Step
Proceed to **`cashier-shift.service.ts`** to ensure cashier logins are strictly scoped to `activeShop().code`.