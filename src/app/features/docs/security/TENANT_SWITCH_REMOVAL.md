# Tenant Switch UI Removal & Direct Store Navigation Links

## Overview
Removed the in-app multi-tenant switcher button/dropdown from the POS interface to prevent unauthorized store switching during active shifts, and established dedicated full URLs with the `?shop=` parameter for each branch.

---

## 1. Architectural Motivation

* **Strict Store Isolation**: Eliminates cashier confusion or accidental cross-store inventory shifts by locking the active terminal context on boot.
* **Deterministic Initialization**: Relies entirely on the query parameter (`?shop=<code >`) to configure the local state, salts, and Dexie database namespace without runtime manual switching.
* **Streamlined UI**: Reduces visual clutter and closes potential session hijacking vectors where a cashier switches stores on an open terminal without entering that branch's admin PIN.

---

## 2. Dedicated Store URLs

Each terminal must be launched directly via its dedicated URL (bookmark each terminal browser accordingly):

| Store Name | Code | Direct Application Link | Admin PIN |
| :--- | :--- | :--- | :--- |
| **Maranth Market (Central)** | `mar-market` | `http://localhost:4200/pos?shop=mar-market` | `2435` |
| **Epta Enteka** | `ftest` | `http://localhost:4200/pos?shop=ftest` | `5564` |
| **Maranth Parnassos** | `parnasos` | `http://localhost:4200/pos?shop=parnasos` | `1978` |

*(Replace `http://localhost:4200` with the production domain/IP in production environments).*

---

## 3. Implementation Details

### A. Template Cleanup
* **Location**: POS header / top navigation bar (typically `src/app/features/pos/pos.component.html` or `header.component.html`).
* **Action**: Removed the store selection `<select>`, dropdown button, or modal toggle previously bound to `tenantConfig.switchShop()`.
* **Retained Display**: The store name label is retained as a read-only badge:
  ```html
  <div class="store-badge">
    <span class="store-name">{{ tenantConfig.activeShop().name }}</span>
    <span class="store-code">({{ tenantConfig.activeShop().code }})</span>
  </div>