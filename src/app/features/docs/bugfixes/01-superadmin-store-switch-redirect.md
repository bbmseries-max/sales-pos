# Bugfix: Super-Admin Store Switch Overwrite by URL Parameter

## Root Cause
When the app was launched with a query parameter (e.g., `?store=ftest`), executing `window.location.reload()` inside `switchShop()` refreshed the page with the original query string intact. Upon reinitialization, `getInitialShop()` prioritized the query string from the address bar, overriding the new store saved to `localStorage`.

## Resolution
Modified `switchShop()` in `tenant-config.service.ts`:
- Uses the `URL` API to update `?store=` to the newly selected store's code.
- Navigates via `window.location.href = url.toString()` rather than a blank `window.location.reload()`.
- Keeps the browser address bar and active store synchronized on Super-Admin switches.