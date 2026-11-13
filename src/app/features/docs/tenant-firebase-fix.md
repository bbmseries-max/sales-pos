# Architecture Consolidation & Migration Report

**Project**: Maranth IKE — Multi-Tenant B2B Invoicing & POS Engine  
**Standard**: Greek Market Fiscal Compliance (AADE / myDATA)  
**Target Structure**: Hierarchical Tenant Isolation (`/tenants/{shopSlug}/*`)

---

## 1. Executive Summary

The database architecture has been migrated from flat, filter-based root collections (`/products`, `/shops`) to a strictly isolated, hierarchical Firestore document model:

$$\text{Firestore Root} \longrightarrow \texttt{/tenants/\{shopSlug\}} \longrightarrow \begin{cases} \texttt{/products} \\ \texttt{/transactions} \end{cases}$$

This structure guarantees that cross-store data leakage is structurally impossible at the database query level, eliminates complex composite indexes, and aligns local Dexie.js offline caches directly with remote tenant subcollections.

---

## 2. Root Cause Analysis: What Went Wrong

During the initial transition, three primary architectural defects emerged:

| Defect Observed | Immediate Consequence | Root Architectural Cause |
| :--- | :--- | :--- |
| **Phantom / Italicized Parent Docs** | Store document displayed in italics in Firebase Console; queries returned empty objects. | Child collections (`/products`) were populated without creating an underlying document at `/tenants/{shopSlug}` with store metadata. |
| **Cross-Collection Infiltration** | Product records (barcodes, cost prices) were found inside `/transactions`. | Code path confusion between transaction write triggers and catalog imports. |
| **Flat Table Reliance** | Services queried root `/products` with `where('storeId', '==', activeCode)`. | Legacy flat-table design allowed reads to fall back to shared collections, risking data leaks. |

---

## 3. Structural Solutions Implemented

### 3.1. Parent Tenant Documents
Every tenant record under `/tenants/{shopSlug}` is now a concrete, fully populated document containing the business identity:
- `code`: Unique URL slug (e.g., `glyfada-store`, `ftest`, `mar-market`)
- `name`: Legal or trade name (e.g., "Maranth Glyfada")
- `afm`: 9-digit Greek Tax Identification Number (validated for AADE myDATA transmission)
- `doy`: Competent Tax Office (e.g., `GLYFADAS`, `AGIAS PARASKEVIS`)
- `adminPinSalt` & `adminPinHash`: Salted SHA-256 hash for secure managerial authentication

### 3.2. Scoped Subcollections
- **Products**: `tenants/{shopSlug}/products/{productId}`  
  Queries are scoped via `collection(firestore, 'tenants', activeCode, 'products')`, removing the need for error-prone `where('storeId', ...)` filters.
- **Transactions & Invoices**: `tenants/{shopSlug}/transactions/{txId}`  
  Sales and fiscal transmissions remain strictly isolated within the respective tenant's record.

### 3.3. Offline Local Sandbox (Dexie.js)
IndexedDB partitions retain an identical structure without breaking legacy components. Local mutations are queued with `_syncStatus: 'dirty'` and flushed to `/tenants/{shopSlug}/products` once online connectivity is verified.

---

## 4. Final Validation & Clean-Up Checklist

Follow these three verification steps before promoting this configuration to production:

- [ ] **Delete Deprecated Root `/shops`**: The root `/shops` collection is fully superseded by `/tenants/{shopSlug}` and can be dropped from Firebase Console.
- [ ] **Delete Deprecated Root `/products`**: Ensure all products have synced into `/tenants/{shopSlug}/products`, then drop the flat root `/products`.
- [ ] **Clean Misplaced Records**: Delete any stray product records found in `/tenants/{shopSlug}/transactions`.
- [ ] **Verify A4 Timologio Output**: Ensure the PDF/print layout renders the correct store AFM, DOY, and AADE QR code pulled from the active `/tenants/{shopSlug}` parent document.