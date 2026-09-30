# Security Hardening: `PosLockScreenComponent` PIN Sanitization

## 1. Eliminated Exposures
1. **Removed `Γρήγοροι Ταμίες` Block:**
   Previously rendered dynamic buttons containing each cashier's cleartext PIN (`{{ c.name }} ({{ c.pin }})`) with single-tap bypass.
2. **Removed `Δοκιμή PIN` Footer:**
   Previously exposed and allowed direct one-tap authentication with the store's `adminPin` (e.g., `2435`).
3. **Dead Code Cleanup:**
   Removed `submitDirectPin(code)` from component logic to prevent programmatic bypass.

## 2. Resulting User Flow
- Lock screen presents only the active store branding, the 4-dot indicator, and the numeric keypad.
- Any tester, cashier, or manager must manually enter their designated 4-digit PIN.
- Upon 4th digit entry, PIN is emitted to `pinSubmit` for validation by `CashierShiftService`.