"We are setting up physical devices and testing a local-first supermarket POS system.

Tech stack: Angular 19+ (Signals, standalone), Dexie.js (local-first IndexedDB), and a local hardware bridge daemon (maranth-bridge.exe running on [http://127.0.0.1:18080](http://127.0.0.1:18080)).

Architecture context: Multi-tenant isolated via activeShop().code. Hardware operations (receipts, Z-reports, spoilage slips, shelf labels via TSPL) route through BridgeService to port 18080.

Current task: I am now configuring and testing store devices (printers, scanners, cash drawer, scale/POS bridge). Help me troubleshoot connections, payloads, and end-to-end flow."