import { Component, inject, signal, OnInit, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CashierShiftService } from '../../../core/services/cashier-shift.service';
import { TenantConfigService } from '../../../core/services/tenant-config.service';
import { CashierRole } from '../../../core/models';
import { marketDb } from '../../../core/db/market-db';
import { Cashier, CashierShift } from '../../../core/models/market.models';

type ModalTab = 'shifts' | 'staff';

@Component({
  selector: 'app-employee-management-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 select-none">
      <div class="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        
        <!-- Header -->
        <div class="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-lg">
              👥
            </div>
            <div>
              <h3 class="text-sm font-black text-slate-100 uppercase tracking-wide">Διαχείριση Προσωπικού & Βαρδιών</h3>
              <p class="text-[11px] text-slate-400">Έλεγχος ωρών, ενεργών ταμείων και PIN ταμιών</p>
            </div>
          </div>
          <button 
            type="button" 
            (click)="close.emit()" 
            class="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-mono flex items-center justify-center cursor-pointer transition">
            ✕
          </button>
        </div>

        <!-- Tab Bar -->
        <div class="flex border-b border-slate-800 bg-slate-950/60 px-4 pt-2 gap-2">
          <button
            type="button"
            (click)="activeTab.set('shifts')"
            [class.border-indigo-500]="activeTab() === 'shifts'"
            [class.text-indigo-400]="activeTab() === 'shifts'"
            [class.border-transparent]="activeTab() !== 'shifts'"
            [class.text-slate-400]="activeTab() !== 'shifts'"
            class="px-4 py-2 border-b-2 text-xs font-bold font-mono transition cursor-pointer flex items-center gap-1.5"
          >
            <span>⏱️</span>
            <span>ΕΝΕΡΓΕΣ ΒΑΡΔΙΕΣ</span>
            <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px]">{{ activeShifts().length }}</span>
          </button>

          <button
            type="button"
            (click)="activeTab.set('staff')"
            [class.border-indigo-500]="activeTab() === 'staff'"
            [class.text-indigo-400]="activeTab() === 'staff'"
            [class.border-transparent]="activeTab() !== 'staff'"
            [class.text-slate-400]="activeTab() !== 'staff'"
            class="px-4 py-2 border-b-2 text-xs font-bold font-mono transition cursor-pointer flex items-center gap-1.5"
          >
            <span>👤</span>
            <span>ΠΡΟΣΩΠΙΚΟ (ΤΑΜΙΕΣ)</span>
            <span class="px-1.5 py-0.5 rounded bg-slate-800 text-[10px]">{{ cashiers().length }}</span>
          </button>
        </div>

        <!-- Body Area -->
        <div class="p-5 overflow-y-auto flex-1 space-y-4">
          
          <!-- TAB 1: ACTIVE SHIFTS & LIVE DURATION -->
          @if (activeTab() === 'shifts') {
            @if (activeShifts().length === 0) {
              <div class="p-12 text-center text-slate-500 font-mono text-xs">
                Δεν υπάρχουν ανοιχτές βάρδιες αυτή τη στιγμή στο κατάστημα.
              </div>
            } @else {
              <div class="space-y-3">
                @for (s of activeShifts(); track s.id) {
                  <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between gap-4 font-mono text-xs">
                    
                    <div class="space-y-1">
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-100 text-sm">{{ s.cashierName }}</span>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                          ΣΕ ΒΑΡΔΙΑ
                        </span>
                      </div>
                      <div class="text-slate-400 text-[11px]">
                        Έναρξη: <span class="text-slate-200">{{ s.startTime | date:'HH:mm (dd/MM)' }}</span>
                      </div>
                      <div class="text-slate-400 text-[11px]">
  Μαγιά: <span class="text-slate-200">€{{ (s.openingFloat || 0).toFixed(2) }}</span> | 
  Πωλήσεις: <span class="text-emerald-400 font-bold">€{{ (s.sales.total || 0).toFixed(2) }}</span>
  (Μετρητά: €{{ (s.sales.cash || 0).toFixed(2) }})
</div>
                    </div>

                    <div class="text-center bg-slate-900 border border-slate-800 px-3 py-2 rounded-xl">
                      <span class="text-[10px] text-slate-500 uppercase block font-bold">ΧΡΟΝΟΣ ΣΕ ΒΑΡΔΙΑ</span>
                      <span class="text-amber-400 font-black text-sm">
                        {{ shiftService.getShiftDurationFormatted(s.startTime) }}
                      </span>
                    </div>

                    <div>
                      <button
                        type="button"
                        (click)="handleForceClose(s)"
                        class="h-10 px-3.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <span>⛔</span>
                        <span>Κλείσιμο</span>
                      </button>
                    </div>

                  </div>
                }
              </div>
            }
          }

          <!-- TAB 2: STAFF LIST & ADD/EDIT CASHIERS -->
          @if (activeTab() === 'staff') {
            <!-- Add Cashier Card -->
            <div class="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex flex-wrap items-center gap-2">
              <input
                type="text"
                [(ngModel)]="newCashierName"
                placeholder="Όνομα Ταμία..."
                class="flex-1 min-w-[140px] h-10 bg-slate-900 border border-slate-700 rounded-xl px-3 text-xs text-slate-100 font-bold focus:border-indigo-500 outline-none"
              />
              <input
                type="password"
                maxlength="6"
                inputmode="numeric"
                [(ngModel)]="newCashierPin"
                placeholder="PIN (4 ψηφία)"
                class="w-28 h-10 bg-slate-900 border border-slate-700 rounded-xl px-2 text-center text-xs font-mono font-bold text-slate-100 focus:border-indigo-500 outline-none"
              />
              <select
                [(ngModel)]="newCashierRole"
                class="h-10 bg-slate-900 border border-slate-700 rounded-xl px-2 text-xs font-bold text-slate-200 focus:border-indigo-500 outline-none cursor-pointer"
              >
                <option value="CASHIER">CASHIER (Ταμίας)</option>
                <option value="ADMIN">ADMIN (Διαχειριστής)</option>
              </select>
              <button
                type="button"
                (click)="handleAddCashier()"
                class="h-10 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                + Προσθήκη
              </button>
            </div>

            <!-- Cashier Table -->
            <div class="space-y-2">
              @for (c of cashiers(); track c.id) {
                <div class="p-3 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between text-xs font-mono">
                  <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-slate-300">
                      {{ c.name.charAt(0) }}
                    </div>
                    <div>
                      <div class="font-bold text-slate-100">{{ c.name }}</div>
                      <div class="text-[10px] text-slate-500">ID: {{ c.id }}</div>
                    </div>
                  </div>

                  <div class="flex items-center gap-3">
                    <span 
                      class="px-2 py-0.5 rounded text-[10px] font-bold"
                      [class.bg-indigo-950]="c.role === 'ADMIN'"
                      [class.text-indigo-400]="c.role === 'ADMIN'"
                      [class.border]="c.role === 'ADMIN'"
                      [class.border-indigo-800]="c.role === 'ADMIN'"
                      [class.bg-slate-800]="c.role !== 'ADMIN'"
                      [class.text-slate-300]="c.role !== 'ADMIN'"
                    >
                      {{ c.role }}
                    </span>

                    <button
                      type="button"
                      (click)="toggleCashierActive(c)"
                      class="px-2.5 py-1 rounded-lg border text-[11px] font-bold transition cursor-pointer"
                      [class.bg-emerald-950]="c.isActive"
                      [class.text-emerald-400]="c.isActive"
                      [class.border-emerald-800]="c.isActive"
                      [class.bg-rose-950]="!c.isActive"
                      [class.text-rose-400]="!c.isActive"
                      [class.border-rose-800]="!c.isActive"
                    >
                      {{ c.isActive ? 'ΕΝΕΡΓΟΣ' : 'ΑΝΕΝΕΡΓΟΣ' }}
                    </button>
                  </div>
                </div>
              }
            </div>
          }

        </div>

      </div>
    </div>
  `
})
export class EmployeeManagementModalComponent implements OnInit {
  public shiftService = inject(CashierShiftService);
  public tenantConfig = inject(TenantConfigService);

  public activeTab = signal<ModalTab>('shifts');
  public activeShifts = signal<CashierShift[]>([]);
  public cashiers = signal<Cashier[]>([]);
  public close = output<void>();

  public newCashierName = '';
  public newCashierPin = '';
  public newCashierRole: CashierRole = 'CASHIER';

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const storeCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    
    // Load active shifts
    const shifts = await marketDb.shifts
      .where('storeId')
      .equals(storeCode)
      .and(s => s.status === 'OPEN')
      .toArray();
    this.activeShifts.set(shifts);

    // Load store cashiers
    const all = await marketDb.cashiers.toArray();
    this.cashiers.set(all.filter(c => !c.storeId || c.storeId === storeCode));
  }

  async handleForceClose(shift: CashierShift): Promise<void> {
    const ok = confirm(`Θέλετε να κλείσετε αναγκαστικά τη βάρδια του ταμία "${shift.cashierName}";`);
    if (!ok) return;

    await this.shiftService.forceCloseShift(shift.id, 'Εξαναγκαστικό κλείσιμο από Αποθήκη / Υπεύθυνο');
    await this.refresh();
  }

  async handleAddCashier(): Promise<void> {
    const name = this.newCashierName.trim();
    const pin = this.newCashierPin.trim();
    if (!name || pin.length < 4) {
      alert('Εισάγετε όνομα και PIN τουλάχιστον 4 ψηφίων.');
      return;
    }

    const storeCode = this.tenantConfig.activeShop()?.code || 'mar-market';
    const newCashier: Cashier = {
      id: `CASH-${Date.now().toString(36).toUpperCase()}`,
      name,
      pin,
      role: this.newCashierRole,
      storeId: storeCode,
      isActive: true
    };

    await marketDb.cashiers.put(newCashier);
    this.newCashierName = '';
    this.newCashierPin = '';
    await this.refresh();
    await this.shiftService.loadAllCashiers();
  }

  async toggleCashierActive(cashier: Cashier): Promise<void> {
    const updated: Cashier = { ...cashier, isActive: !cashier.isActive };
    await marketDb.cashiers.put(updated);
    await this.refresh();
    await this.shiftService.loadAllCashiers();
  }
}