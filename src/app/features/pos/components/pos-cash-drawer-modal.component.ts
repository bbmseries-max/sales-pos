import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface CashLogEvent {
  type: 'IN' | 'OUT' | 'FLOAT' | 'DROP';
  amount: number;
  reason: string;
}

@Component({
  selector: 'app-pos-cash-drawer-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
        <div class="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
          
          <div class="flex justify-between items-center pb-3 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full" [class.bg-emerald-400]="logType() === 'IN' || logType() === 'FLOAT'" [class.bg-red-400]="logType() === 'OUT' || logType() === 'DROP'"></span>
              <h3 class="text-sm font-black text-slate-100 uppercase tracking-wider">Κίνηση Συρταριού Ταμείου</h3>
            </div>
            <button type="button" (click)="cancel.emit()" class="text-slate-400 hover:text-slate-100 font-mono text-lg cursor-pointer">✕</button>
          </div>

          <div class="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800">
            <button 
              type="button"
              (click)="setType('IN')"
              [class.bg-emerald-600]="logType() === 'IN' || logType() === 'FLOAT'"
              [class.text-white]="logType() === 'IN' || logType() === 'FLOAT'"
              [class.text-slate-400]="logType() !== 'IN' && logType() !== 'FLOAT'"
              class="h-10 rounded-xl font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>📥 ΕΙΣΡΟΗ (+)</span>
            </button>
            
            <button 
              type="button"
              (click)="setType('OUT')"
              [class.bg-red-600]="logType() === 'OUT' || logType() === 'DROP'"
              [class.text-white]="logType() === 'OUT' || logType() === 'DROP'"
              [class.text-slate-400]="logType() !== 'OUT' && logType() !== 'DROP'"
              class="h-10 rounded-xl font-black text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>📤 ΕΚΡΟΗ (-)</span>
            </button>
          </div>

          <div class="space-y-2">
            <label class="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Ποσό Μετρητών (€)</label>
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-mono font-bold text-slate-500">€</span>
              <input 
                type="number" 
                step="0.50"
                min="0"
                [(ngModel)]="amount"
                class="w-full h-14 bg-slate-950 border-2 border-slate-700 rounded-2xl pl-10 pr-4 font-mono font-black text-2xl text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div class="grid grid-cols-4 gap-2 pt-1">
              @for (preset of [20, 50, 100, 200]; track preset) {
                <button 
                  type="button"
                  (click)="amount.set(preset)"
                  class="h-8 bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-mono font-bold text-slate-300 rounded-lg border border-slate-700 transition cursor-pointer"
                >
                  €{{ preset }}
                </button>
              }
            </div>
          </div>

          <div class="space-y-2">
            <label class="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Αιτιολογία Κίνησης</label>
            <div class="space-y-1.5">
              @for (r of (logType() === 'IN' ? inReasons : outReasons); track r) {
                <button 
                  type="button"
                  (click)="reason.set(r)"
                  [class.border-emerald-500]="logType() === 'IN' && reason() === r"
                  [class.bg-emerald-950/30]="logType() === 'IN' && reason() === r"
                  [class.border-red-500]="logType() === 'OUT' && reason() === r"
                  [class.bg-red-950/30]="logType() === 'OUT' && reason() === r"
                  class="w-full h-9 px-3 text-left text-xs font-medium bg-slate-950 border border-slate-800 rounded-xl text-slate-200 hover:border-slate-700 transition flex items-center justify-between cursor-pointer"
                >
                  <span>{{ r }}</span>
                  @if (reason() === r) {
                    <span [class.text-emerald-400]="logType() === 'IN'" [class.text-red-400]="logType() === 'OUT'" class="font-bold">✔</span>
                  }
                </button>
              }
            </div>

            <input 
              type="text" 
              placeholder="Ή πληκτρολογήστε άλλη αιτιολογία..."
              [(ngModel)]="reason"
              class="w-full h-10 bg-slate-950 border border-slate-800 rounded-xl px-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500 font-mono mt-1"
            />
          </div>

          <div class="pt-2 border-t border-slate-800 grid grid-cols-2 gap-3">
            <button 
              type="button"
              (click)="cancel.emit()"
              class="h-12 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 font-bold text-xs rounded-xl cursor-pointer transition"
            >
              Ακύρωση
            </button>

            <button 
              type="button"
              (click)="onSubmit()"
              [class.bg-emerald-600]="logType() === 'IN' || logType() === 'FLOAT'"
              [class.hover:bg-emerald-500]="logType() === 'IN' || logType() === 'FLOAT'"
              [class.bg-red-600]="logType() === 'OUT' || logType() === 'DROP'"
              [class.hover:bg-red-500]="logType() === 'OUT' || logType() === 'DROP'"
              class="h-12 text-white font-black text-xs rounded-xl active:scale-95 cursor-pointer transition shadow-lg flex items-center justify-center gap-1.5"
            >
              <span>💾 ΚΑΤΑΧΩΡΗΣΗ &amp; ΑΝΟΙΓΜΑ</span>
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class PosCashDrawerModalComponent {
  isOpen = input<boolean>(false);
  submitLog = output<CashLogEvent>();
  cancel = output<void>();

  logType = signal<'IN' | 'OUT' | 'FLOAT' | 'DROP'>('IN');
  amount = signal<number>(50);
  reason = signal<string>('Εισαγωγή Ψιλών (Change Float)');

  inReasons = ['Εισαγωγή Ψιλών (Change Float)', 'Επιστροφή Μετρητών', 'Προσθήκη Ταμείου'];
  outReasons = ['Πληρωμή Προμηθευτή', 'Ανάληψη / Safe Drop', 'Έξοδα Καταστήματος'];

  setType(type: 'IN' | 'OUT'): void {
    this.logType.set(type);
    this.reason.set(type === 'IN' ? this.inReasons[0] : this.outReasons[0]);
  }

  onSubmit(): void {
    if (this.amount() <= 0) return;
    this.submitLog.emit({
      type: this.logType(),
      amount: Number(this.amount()),
      reason: this.reason() || 'Κίνηση Ταμείου'
    });
  }
}