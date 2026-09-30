# Architectural Note: PIN Uniqueness vs. Tenant Resolution

## 1. Current State
- Double/duplicate PIN creation is blocked at the employee creation form level.
- This prevents identical credentials within the reachable dataset.

## 2. Why Tenant-First Resolution Still Matters
1. **Tenant Independence:**
   Cross-store uniqueness rules force independent tenants to share a single global credential namespace. Tenant-scoped resolution allows different stores to use identical local PIN sequences without collision.
2. **Scoped Authentication:**
   Resolving the tenant via URL slug or local device configuration scopes the query:
   `SELECT * FROM cashiers WHERE storeId = :activeStoreId AND pin = :enteredPin`
   rather than querying all tenants simultaneously.
3. **Demo Delivery Ergonomics:**
   Enables sending distinct, branded demo links (`?store=slug`) directly to prospects.