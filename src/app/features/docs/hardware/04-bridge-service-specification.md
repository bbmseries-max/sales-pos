# Hardware Daemon: Bridge Service Specification (`bridge.service.ts`)

## 1. Daemon Specs
- **Process:** `maranth-bridge.exe`
- **Loopback Address:** `http://127.0.0.1:18080`
- **Supported Capabilities:**
  - Raw ESC/POS Thermal Printing (`/api/printer/raw`)
  - Electronic Cash Drawer Trigger (`/api/printer/open-drawer`)
  - Interconnected EFT/POS Payment Terminals (`/api/eft/charge`)

---

## 2. API Contract

### Health Endpoint
- **Route:** `GET /health`
- **Response:**
  ```json
  {
    "status": "ready",
    "version": "1.2.0",
    "printerConnected": true,
    "eftConnected": true
  }