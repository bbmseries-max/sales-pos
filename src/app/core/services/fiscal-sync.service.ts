import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FiscalTransaction, FiscalMode } from '../models/fiscal.model';
import { TenantConfigService } from './tenant-config.service';

@Injectable({
  providedIn: 'root'
})
export class FiscalSyncService {
  private http = inject(HttpClient);
  private tenantConfig = inject(TenantConfigService);

  public isOnline = signal<boolean>(navigator.onLine);
  public pendingCount = signal<number>(0);

  constructor() {
    window.addEventListener('online', () => {
      this.isOnline.set(true);
      this.flushQueue();
    });
    window.addEventListener('offline', () => {
      this.isOnline.set(false);
    });
  }

  /**
   * Primary entry point called when payment completes in the POS
   */
  public async processSale(transaction: Omit<FiscalTransaction, 'status' | 'retryCount'>): Promise<FiscalTransaction> {
    const activeShop = this.tenantConfig.activeShop();
    const mode: FiscalMode = activeShop?.fiscalMode || 'PROVIDER';

    const record: FiscalTransaction = {
      ...transaction,
      fiscalMode: mode,
      status: 'pending_fiscal',
      retryCount: 0
    };

    // Case A: Hardware ΦΗΜ (Works directly over local LAN/USB without internet)
    if (mode === 'FHM') {
  const endpoint = activeShop.fhmEndpoint || 'http://127.0.0.1:8080/api/fhm';
  try {
    const fhmResponse = await this.dispatchToLocalFhm(endpoint, record);
    record.status = 'completed';
    record.qrUrl = fhmResponse.qrUrl;
    record.mark = fhmResponse.signature;
    return record;
  } catch (err: any) {
    console.error('[ΦΗΜ Hardware Error]', err);
    record.errorMessage = err.message || 'ΦΗΜ connection failed';
    await this.enqueue(record);
    return record;
  }
}

    // Case B: Cloud Provider / myDATA API
    if (this.isOnline()) {
      try {
        const providerRes = await this.dispatchToProvider(record);
        record.status = 'completed';
        record.mark = providerRes.mark;
        record.uid = providerRes.uid;
        record.qrUrl = providerRes.qrUrl;
        return record;
      } catch (err) {
        console.warn('[Provider Offline/Error] Queuing for background sync');
        await this.enqueue(record);
        return record;
      }
    } else {
      // Offline fallback: store locally for batch sync upon reconnection
      await this.enqueue(record);
      return record;
    }
  }

  private async dispatchToLocalFhm(endpoint: string, record: FiscalTransaction): Promise<{ qrUrl: string; signature: string }> {
    return firstValueFrom(
      this.http.post<{ qrUrl: string; signature: string }>(endpoint, record, { timeout: 4000 })
    );
  }

  private async dispatchToProvider(record: FiscalTransaction): Promise<{ mark: string; uid: string; qrUrl: string }> {
    return firstValueFrom(
      this.http.post<{ mark: string; uid: string; qrUrl: string }>('/api/fiscal/issue-receipt', record)
    );
  }

  private async enqueue(record: FiscalTransaction): Promise<void> {
    const db = (window as any).activePosDb; // or inject your active Dexie instance
    if (db) {
      await db.fiscalQueue.add(record);
      const count = await db.fiscalQueue.where({ status: 'pending_fiscal' }).count();
      this.pendingCount.set(count);
    }
  }

  public async flushQueue(): Promise<void> {
    if (!this.isOnline()) return;
    const db = (window as any).activePosDb;
    if (!db) return;

    const pending = await db.fiscalQueue.where({ status: 'pending_fiscal' }).toArray();
    for (const item of pending) {
      try {
        const res = await this.dispatchToProvider(item);
        item.status = 'completed';
        item.mark = res.mark;
        item.qrUrl = res.qrUrl;
        await db.fiscalQueue.put(item);
      } catch (e) {
        item.retryCount = (item.retryCount || 0) + 1;
        await db.fiscalQueue.put(item);
        break; // Pause queue if network drops again
      }
    }
    const count = await db.fiscalQueue.where({ status: 'pending_fiscal' }).count();
    this.pendingCount.set(count);
  }
}