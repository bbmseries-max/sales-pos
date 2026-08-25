import { Injectable, signal } from '@angular/core';

export interface EftTransactionRequest {
  amount: number;       // e.g. 14.50
  txnId: string;        // Local reference ticket id
  terminalIp?: string;  // Local ECR terminal IP (e.g. 192.168.1.150)
  port?: number;        // Default 8080 or vendor port
}

export interface EftTransactionResult {
  success: boolean;
  txnId: string;
  authCode?: string;    // Bank authorization code
  terminalRrn?: string; // Retrieval Reference Number
  cardType?: string;    // VISA, MASTERCARD, etc.
  errorMessage?: string;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class EftTerminalService {
  public isProcessing = signal<boolean>(false);
  public lastStatusMessage = signal<string>('Ready');
  public terminalConfig = signal<{ ip: string; port: number; mode: 'automated' | 'manual' }>({
    ip: '127.0.0.1',
    port: 8080,
    mode: 'manual' // Default to fast manual validation until terminal hardware is linked
  });

  /**
   * Initiates payment handshake with EFT POS terminal (Cardlink / Viva / Generic ECR protocol)
   */
  public async chargeCard(req: EftTransactionRequest): Promise<EftTransactionResult> {
    this.isProcessing.set(true);
    this.lastStatusMessage.set(`Connecting to EFT Terminal for €${req.amount.toFixed(2)}...`);

    const config = this.terminalConfig();

    if (config.mode === 'manual') {
      // Fast manual cashier workflow: simulates instant authorization confirmation
      await new Promise(r => setTimeout(r, 600));
      this.isProcessing.set(false);
      this.lastStatusMessage.set('Payment Approved (Manual POS)');

      return {
        success: true,
        txnId: req.txnId,
        authCode: 'AUTH-' + Math.floor(100000 + Math.random() * 900000),
        terminalRrn: 'RRN-' + Date.now().toString().slice(-8),
        cardType: 'CONTACTLESS/CHIP',
        timestamp: new Date().toISOString()
      };
    }

    // Automated TCP/HTTP Bridge mode (ECR/AADE linked terminal)
    try {
      this.lastStatusMessage.set('Present or Tap Card on Terminal...');
      const targetUrl = `http://${config.ip}:${config.port}/api/charge`;

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: Math.round(req.amount * 100),
          referenceId: req.txnId,
          currency: 'EUR'
        }),
        signal: AbortSignal.timeout(45000) // 45s customer tap timeout
      });

      if (!response.ok) {
        throw new Error(`Terminal returned HTTP ${response.status}`);
      }

      const data = await response.json();
      this.isProcessing.set(false);
      this.lastStatusMessage.set('Payment Successful');

      return {
        success: data.success ?? true,
        txnId: req.txnId,
        authCode: data.authCode || 'MANUAL-OK',
        terminalRrn: data.rrn || '',
        cardType: data.cardBrand || 'CARD',
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      this.isProcessing.set(false);
      this.lastStatusMessage.set(`EFT Error: ${err.message || 'Timeout'}`);

      return {
        success: false,
        txnId: req.txnId,
        errorMessage: err.message || 'Terminal connection failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  /** Quick configuration switch */
  public setTerminalMode(mode: 'automated' | 'manual', ip = '127.0.0.1', port = 8080) {
    this.terminalConfig.set({ mode, ip, port });
  }
}