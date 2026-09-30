# Hardware Bridge Integration: Shelf Labels (`printShelfLabels`)

## 1. Problem Addressed
Component attempted to access `private baseUrl` directly on `BridgeService` and execute arbitrary `fetch` calls.

## 2. Solution
- Added typed `printShelfLabels(labels: Array<...>): Promise<boolean>` method directly to `BridgeService`.
- Standardized payload format (`type: 'SHELF_LABELS_TSPL'`) targeting `127.0.0.1:18080/api/printer/raw`.
- Implemented offline guard returning `false` on network failure, triggering automatic fallback to browser print dialog.