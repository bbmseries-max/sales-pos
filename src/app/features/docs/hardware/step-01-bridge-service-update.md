# Step 1 Reference: Bridge Service Hardening

## Changes Applied to `bridge.service.ts`
1. **Removed `window.print()` Fallback:**
   - Previous behavior: If `maranth-bridge.exe` was closed, the browser opened a full-page system print preview that froze the POS UI and rendered the web layout instead of an ESC/POS slip.
   - New behavior: Silently logs a warning and returns `false`, keeping demo sessions smooth.
2. **Added Connection Heartbeat (15s):**
   - Automatically detects when `maranth-bridge.exe` starts or restarts without needing a hard browser refresh.
3. **Added `AbortController` Timeout (1200ms):**
   - Prevents fetch calls to `127.0.0.1:18080` from hanging if the daemon is busy or frozen.
4. **Added Card & Drawer Methods:**
   - `openCashDrawer()` for manual and post-sale drawer kicks.
   - `chargeCard()` for direct EFT/POS terminal charging via the bridge.

## Verification
- [ ] Save the updated `bridge.service.ts`.
- [ ] Ensure project compiles without TypeScript errors (`npm run build` or terminal console).
# EFT/POS Contract Alignment: `invoiceId` Property

## Protocol Definition
- **Identifier:** `invoiceId` on `EftChargeRequest`
- **Standard:** Aligns with Greek ERP and AADE-linked EFT-POS protocol schemas (transmitting receipt/invoice correlation IDs between POS software and physical bank terminals via `maranth-bridge.exe`).

## Applied Changes
- Populated `invoiceId: request.invoiceId || ''` in both offline and network error fallback response payloads.
- Maintained `as unknown as EftChargeResponse` assertion to prevent TypeScript structural overlap errors.