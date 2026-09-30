# UI Bugfix: Payment Modal Styling & Active State Restoration

## 1. Issues Identified
1. **Low Contrast on Cash / Card Buttons:**
   Using `bg-emerald-950/40` on top of `bg-slate-950` resulted in near-zero contrast, causing active buttons to look like plain dark input boxes.
2. **Disabled State Sticking on Checkout Button:**
   The `[disabled]` directive checked `cashTendered() < cart.grandTotal()`, which caused the button to remain in a disabled gray state when loyalty points or discounts reduced the payable total below the raw grand total.

## 2. Applied Remediation
- **Explicit Button Styles:** Selected payment methods now toggle to vibrant `bg-emerald-600 text-slate-950 border-emerald-400 shadow-emerald-500/30`, making the active choice immediately obvious.
- **Payable Total Consistency:** Corrected tender validation to check against `finalPayableAmount()`.
- **Pre-seeded Tender:** `openPayment()` pre-populates `cashTendered` with `Math.ceil(payable)`, ensuring the complete button renders enabled and styled in green immediately.