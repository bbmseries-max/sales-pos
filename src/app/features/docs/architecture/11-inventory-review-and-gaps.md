# Architectural Review: Inventory Module (`inventory.component.ts`)

## 1. Resolved Flaws & Gaps
1. **Misplaced `<router-outlet>`:**
   - The `<router-outlet>` was declared inside the flex `<nav>` header strip, corrupting router viewport rendering.
   - Removed from the navigation container.
2. **Missing Status Filter Controls:**
   - Signals `selectedTab`, `lowStockCount`, `expiringCount`, and `pinnedCount` were calculated in TypeScript but had no corresponding UI triggers.
   - Restored status pill buttons (`📦 Όλα`, `⚠️ Χαμηλό Απόθεμα`, `⏰ Λήγοντα`, `📌 Καρφιτσωμένα`).
3. **Modal UI Inversion:**
   - Replaced conflicting light-mode Tailwind classes (`bg-slate-50`, `border-slate-200`) on the weighted item toggle with dark-mode utilities (`bg-slate-950/80`, `border-slate-800`).

## 2. Shift & Cashier Audit Trail Enhancement
- Recommended linking manual stock updates to `CashierShiftService.currentCashier()?.name` so audit adjustments store the operating cashier's ID alongside the `dirty` sync status.