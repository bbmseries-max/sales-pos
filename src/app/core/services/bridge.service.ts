import { Injectable, signal } from '@angular/core';
import { 
  BridgeHealthResponse, 
  PrintReceiptPayload, 
  EftChargeRequest, 
  EftChargeResponse 
} from '../models/bridge.model';

@Injectable({
  providedIn: 'root'
})
export class BridgeService {
  private readonly baseUrl = 'http://127.0.0.1:18080';
  public isBridgeAvailable = signal<boolean>(false);

  public async checkBridgeStatus(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      const data: BridgeHealthResponse = await res.json();
      const online = data.status === 'ready';
      this.isBridgeAvailable.set(online);
      return online;
    } catch {
      this.isBridgeAvailable.set(false);
      return false;
    }
  }

  constructor() {
    this.checkBridgeStatus();
  }

  public async printReceipt(payload: any): Promise<boolean> {
    if (!this.isBridgeAvailable()) {
      // Fallback: browser standard window.print()
      window.print();
      return true;
    }

    try {
      const res = await fetch(`${this.baseUrl}/api/printer/raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.ok;
    } catch (err) {
      console.error('Bridge printing failed:', err);
      return false;
    }
  }
}