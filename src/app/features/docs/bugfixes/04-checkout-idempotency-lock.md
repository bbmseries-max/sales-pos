# Bugfix: Checkout Idempotency & Re-Entrancy Guard

## 1. Problem Description
Rapid consecutive taps on "ΕΚΤΥΠΩΣΗ & ΟΛΟΚΛΗΡΩΣΗ" or pressing `[Space]` triggered concurrent `cart.checkout()` calls, resulting in:
- Duplicate transactions stored in IndexedDB (`marketDb.transactions`).
- Discrepancy inflation in active shift sales records.
- Concurrent duplicate AADE myDATA transmission attempts.

## 2. Remediation
1. Introduced `isCompletingSale = signal<boolean>(false)` in `PosComponent`.
2. Applied synchronous early-exit check at the entry point of `completeSale()`.
3. Tied button `[disabled]` state and loading spinner to `isCompletingSale()`.
4. Guaranteed state release via `finally { this.isCompletingSale.set(false); }`.