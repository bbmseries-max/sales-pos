/// <reference types="vitest/globals" />
import 'fake-indexeddb/auto';

import { TestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { TenantConfigService, DEFAULT_SHOPS } from './tenant-config.service';
import { CashierShiftService } from './cashier-shift.service';
import { sha256Pin } from '../utils/crypto.utils';
import { ShopInfo } from '../../core/services/tenant-config.service'; // Adjust import if declared in tenant-config.service

// Initialize Angular Test Platform once for Vitest
try {
  TestBed.initTestEnvironment(
    BrowserTestingModule,
    platformBrowserTesting()
  );
} catch {
  // Already initialized
}

describe('Store PIN Authentication & Hash Integrity', () => {
  const STORE_PIN_MAP: Record<string, string> = {
    'mar-market': '2435',
    'ftest': '5564',
    'parnasos': '1978',
  };

  // 1. Static cryptographic hash verification (No TestBed needed)
  describe('Static Hash Integrity', () => {
    DEFAULT_SHOPS.forEach((shop: ShopInfo) => {
      it(`verifies PIN hash for shop: ${shop.code}`, async () => {
        const expectedPin = STORE_PIN_MAP[shop.code];
        expect(expectedPin).toBeDefined();

        const salt = shop.adminPinSalt || shop.code;
        const computedHash = await sha256Pin(expectedPin, salt);

        expect(computedHash).toBe(shop.adminPinHash);
      });
    });
  });

  // 2. Angular Service Integration
  describe('CashierShiftService Login Flow', () => {
    let tenantConfig: TenantConfigService;
    let shiftService: CashierShiftService;

    beforeEach(() => {
      localStorage.clear();

      TestBed.configureTestingModule({
        providers: [
          TenantConfigService,
          CashierShiftService,
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
        ],
      });

      tenantConfig = TestBed.inject(TenantConfigService);
      shiftService = TestBed.inject(CashierShiftService);
    });

    afterEach(() => {
      localStorage.clear();
      TestBed.resetTestingModule();
    });

    it('authenticates mar-market with correct PIN', async () => {
      const shop = DEFAULT_SHOPS.find((s: ShopInfo) => s.code === 'mar-market');
      expect(shop).toBeDefined();

      if (typeof (tenantConfig as any).switchShop === 'function') {
        (tenantConfig as any).switchShop(shop!.code);
      } else if (typeof (tenantConfig.activeShop as any)?.set === 'function') {
        (tenantConfig.activeShop as any).set(shop!);
      }

      const result = await shiftService.loginWithPin('2435');
      expect(result.success).toBe(true);
    });

    it('rejects an invalid PIN', async () => {
      const result = await shiftService.loginWithPin('0000');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Λάθος PIN. Δοκιμάστε ξανά.');
    });
  });
});