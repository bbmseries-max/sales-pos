# Security & Access Control: PIN Exposure Resolution

## 1. Context & Business Domain
- **Company:** Maranth (`maranth.gr`)
- **Product:** Retail Supermarket POS & Store Management SaaS
- **Target Audience:** Retail operators, franchise multi-store businesses, demo testers
- **Data Architecture:** Offline-first IndexedDB (via Dexie.js) synchronizing with Firebase/Firestore. Multi-tenant shop partitioning.

## 2. Identified Vulnerabilities
1. **Cleartext PIN Exposure in Staff List:**
   The employee directory rendered plaintext PIN strings inside the DOM, exposing credentials to demo testers and casual observers.
2. **Implicit Auth Bypass on Shift Start:**
   Selecting a cashier in the `Start New Shift` modal automatically loaded their PIN, allowing any user to open a cash drawer under another employee's name without knowing their credential.

## 3. Implemented Fixes
1. **Masked Credential Rendering:**
   Replaced `{{ c.pin }}` with a masked label (`PIN: ••••`).
2. **Explicit Verification Flow:**
   Selecting a cashier now sets `selectedShiftCashierId`. The user must manually input their PIN to authenticate before starting the shift.
3. **Super-Admin Protection:**
   The master code (`8820`) and registered store admin PINs remain protected against collision or reassignment by demo users.

## 4. Verification Steps
- [ ] Open the **Υπάλληλοι** (Employees) modal and verify that no cleartext PIN digits appear in the DOM inspector.
- [ ] Open the **Έναρξη Νέας Βάρδιας** (Start Shift) modal, select a cashier, enter an incorrect PIN, and verify that authentication fails.
- [ ] Enter the correct PIN and verify that the shift opens with the designated opening float.