# Security Hardening: Elimination of Backdoor PINs & Strict Tenant Isolation

## 1. Eliminated Vulnerabilities
1. **Universal Backdoor Removal:**
   - Deleted hardcoded `'8820'` master bypass from `CashierShiftService` and `PosComponent`.
2. **Tenant Scoping on Authentication:**
   - In `loginWithPin`, cashiers are matched strictly where `c.storeId === activeShopCode`.
   - Cashiers from Store A can no longer authenticate on a terminal switched to Store B.
3. **Store Switching Hardening:**
   - Switching stores terminates active cashier sessions and locks the terminal.
   - Cross-store navigation requires target store authorization.