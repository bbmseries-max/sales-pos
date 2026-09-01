import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface DenominationEntry {
  value: number;
  label: string;
  count: number;
  isCoin?: boolean;
}

@Component({
  selector: 'app-pos-denomination-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
        <div class="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[92vh] flex flex-col">
          
          <!-- Header -->
          <div class="flex justify-between items-center pb-3 border-b border-slate-800 shrink-0">
            <div class="flex items-center gap-2.5">
              <span class="text-xl">🧮</span>
              <div>
                <h3 class="text-sm font-black text-slate-100 uppercase tracking-wider">Καταμέτρηση Μετρητών</h3>
                <span class="text-[10px] font-mono text-slate-400">Αναλυτικός υπολογισμός χαρτονομισμάτων & κερμάτων</span>
              </div>
            </div>
            <button 
              type="button" 
              (click)="cancel.emit()" 
              class="text-slate-400 hover:text-slate-100 font-mono text-lg cursor-pointer transition">
              ✕
            </button>
          </div>

          <!-- Denomination Lists Scrollable Area -->
          <div class="overflow-y-auto space-y-4 pr-1 flex-1">
            
            <!-- Banknotes -->
            <div>
              <div class="flex justify-between items-center mb-2">
                <span class="text-[11px] font-mono font-bold text-emerald-400 uppercase tracking-wider">💶 ΧΑΡΤΟΝΟΜΙΣΜΑΤΑ</span>
                <span class="text-[11px] font-mono text-slate-400">Σύνολο: <strong class="text-emerald-300">€{{ banknotesSubtotal().toFixed(2) }}</strong></span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                @for (note of banknotes(); track note.value) {
                  <div class="bg-slate-950 border border-slate-800 rounded-2xl p-2.5 flex flex-col justify-between">
                    <div class="flex justify-between items-center mb-1.5">
                      <span class="font-mono font-black text-sm text-emerald-400">€{{ note.value }}</span>
                      <span class="font-mono text-xs font-bold text-slate-400">€{{ (note.value * (note.count || 0)).toFixed(2) }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <button 
                        type="button" 
                        (click)="adjustCount(note, -1)" 
                        class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-black text-sm flex items-center justify-center transition cursor-pointer">
                        -
                      </button>
                      <input 
                        type="number" 
                        min="0"
                        [(ngModel)]="note.count"
                        (ngModelChange)="onCountChange()"
                        class="w-full h-8 bg-slate-900 border border-slate-700 rounded-lg text-center font-mono font-black text-xs text-slate-100 focus:outline-none focus:border-emerald-500" 
                      />
                      <button 
                        type="button" 
                        (click)="adjustCount(note, 1)" 
                        class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-black text-sm flex items-center justify-center transition cursor-pointer">
                        +
                      </button>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Coins -->
            <div>
              <div class="flex justify-between items-center mb-2">
                <span class="text-[11px] font-mono font-bold text-amber-400 uppercase tracking-wider">🪙 ΚΕΡΜΑΤΑ</span>
                <span class="text-[11px] font-mono text-slate-400">Σύνολο: <strong class="text-amber-300">€{{ coinsSubtotal().toFixed(2) }}</strong></span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                @for (coin of coins(); track coin.value) {
                  <div class="bg-slate-950 border border-slate-800 rounded-2xl p-2 flex flex-col justify-between">
                    <div class="flex justify-between items-center mb-1">
                      <span class="font-mono font-bold text-xs text-amber-400">{{ coin.label }}</span>
                      <span class="font-mono text-[10px] text-slate-400">€{{ (coin.value * (coin.count || 0)).toFixed(2) }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <button 
                        type="button" 
                        (click)="adjustCount(coin, -1)" 
                        class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 font-bold text-xs flex items-center justify-center transition cursor-pointer">
                        -
                      </button>
                      <input 
                        type="number" 
                        min="0"
                        [(ngModel)]="coin.count"
                        (ngModelChange)="onCountChange()"
                        class="w-full h-7 bg-slate-900 border border-slate-700 rounded-lg text-center font-mono font-bold text-[11px] text-slate-100 focus:outline-none focus:border-amber-500" 
                      />
                      <button 
                        type="button" 
                        (click)="adjustCount(coin, 1)" 
                        class="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 font-bold text-xs flex items-center justify-center transition cursor-pointer">
                        +
                      </button>
                    </div>
                  </div>
                }
              </div>
            </div>

          </div>

          <!-- Modal Footer -->
          <div class="pt-3 border-t border-slate-800 flex items-center justify-between shrink-0">
            <button 
              type="button" 
              (click)="resetCounts()" 
              class="px-3.5 py-2.5 rounded-xl text-xs font-bold text-rose-400 hover:bg-rose-950/40 border border-rose-800/60 active:scale-95 transition cursor-pointer">
              Μηδενισμός
            </button>

            <div class="flex items-center gap-4">
              <div class="text-right">
                <span class="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">ΚΑΤΑΜΕΤΡΗΣΗ ΣΥΝΟΛΟΥ</span>
                <span class="text-2xl font-mono font-black text-emerald-400">€{{ grandTotal().toFixed(2) }}</span>
              </div>
              <button 
                type="button" 
                (click)="onConfirm()" 
                class="h-12 px-5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded-xl active:scale-95 transition shadow-lg flex items-center justify-center gap-1.5 cursor-pointer">
                <span>✔ ΕΦΑΡΜΟΓΗ ΣΤΟ ΤΑΜΕΙΟ</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    }
  `
})
export class PosDenominationModalComponent {
  isOpen = input<boolean>(false);
  confirmCount = output<number>();
  cancel = output<void>();

  banknotes = signal<DenominationEntry[]>([
    { value: 100, label: '100€', count: 0 },
    { value: 50, label: '50€', count: 0 },
    { value: 20, label: '20€', count: 0 },
    { value: 10, label: '10€', count: 0 },
    { value: 5, label: '5€', count: 0 }
  ]);

  coins = signal<DenominationEntry[]>([
    { value: 2.00, label: '2€', count: 0, isCoin: true },
    { value: 1.00, label: '1€', count: 0, isCoin: true },
    { value: 0.50, label: '50c', count: 0, isCoin: true },
    { value: 0.20, label: '20c', count: 0, isCoin: true },
    { value: 0.10, label: '10c', count: 0, isCoin: true },
    { value: 0.05, label: '5c', count: 0, isCoin: true },
    { value: 0.02, label: '2c', count: 0, isCoin: true },
    { value: 0.01, label: '1c', count: 0, isCoin: true }
  ]);

  banknotesSubtotal = computed(() => {
    return this.banknotes().reduce((sum, item) => sum + (item.value * (Number(item.count) || 0)), 0);
  });

  coinsSubtotal = computed(() => {
    return this.coins().reduce((sum, item) => sum + (item.value * (Number(item.count) || 0)), 0);
  });

  grandTotal = computed(() => {
    return Number((this.banknotesSubtotal() + this.coinsSubtotal()).toFixed(2));
  });

  adjustCount(item: DenominationEntry, delta: number): void {
    item.count = Math.max(0, (Number(item.count) || 0) + delta);
    this.onCountChange();
  }

  onCountChange(): void {
    this.banknotes.update(arr => [...arr]);
    this.coins.update(arr => [...arr]);
  }

  resetCounts(): void {
    this.banknotes.update(arr => arr.map(n => ({ ...n, count: 0 })));
    this.coins.update(arr => arr.map(c => ({ ...c, count: 0 })));
  }

  onConfirm(): void {
    this.confirmCount.emit(this.grandTotal());
  }
}