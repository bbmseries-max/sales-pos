# Tenant Resolution Architecture (`tenant-config.service.ts`)

## 1. Context & Motivation
Previously, store switching relied on entering a store-specific `adminPin` (e.g. `2435`, `5564`) on the main lock screen via `resolveAndSwitchByPin()`.
This created confusion between **cashier login PINs** and **store switcher PINs**.

## 2. Solution: Deterministic URL Parameter Resolution