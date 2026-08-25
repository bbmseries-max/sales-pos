import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pos-shift-handover-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen() && shift(); as s) {
      <div class="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
        <div class="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-lg p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
          
          <div class="flex justify-between items-center pb-3 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <span class="text-xl">📄</span>
              <h3 class="text-sm font-black text-amber-400 uppercase tracking-wider">Παράδοση Βάρδιας &amp; Δελτίο "Χ"</h3>
            </div>
            <button type="button" (click)="close.emit()" class="text-slate-400 hover:text-slate-100 font-mono text-lg cursor-pointer">✕</button>
          </div>

          <div class="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2.5 font-mono text-xs">
            <div class="flex justify-between text-slate-400">
              <span>Ταμίας:</span>
              <span class="font-bold text-slate-200">{{ s.cashierName }}</span>
            </div>
            <div class="flex justify-between text-slate-400">
              <span>Αρχικό Ταμείο (Float):</span>
              <span class="text-slate-200">€{{ (s.openingFloat || 0).toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-slate-400">
              <span>Πωλήσεις Μετρητών:</span>
              <span class="text-emerald-400 font-bold">€{{ (s.sales?.cash || 0).toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-slate-400">
              <span>Πωλήσεις Καρτών (POS):</span>
              <span class="text-sky-400 font-bold">€{{ (s.sales?.card || 0).toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-slate-100 pt-2 border-t border-slate-800 text-sm font-bold">
              <span>Αναμενόμενα Μετρητά:</span>
              <span class="text-emerald-400">€{{ expectedCash().toFixed(2) }}</span>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-slate-300 uppercase block font-mono">Καταμέτρηση Μετρητών Συρταριού (€)</label>
            <input 
              type="number" 
              step="0.01"
              [(ngModel)]="countedCash"
              class="w-full h-12 bg-slate-950 border-2 border-slate-700 focus:border-amber-500 rounded-xl px-3 font-mono font-black text-lg text-emerald-400 focus:outline-none"
            />
          </div>

          <div class="p-3 rounded-xl border flex justify-between items-center text-xs font-mono"
               [class.bg-emerald-950]="diff() >= 0"
               [class.border-emerald-700]="diff() >= 0"
               [class.bg-rose-950]="diff() < 0"
               [class.border-rose-700]="diff() < 0">
            <span class="text-slate-300 font-bold">Διαφορά Ταμείου:</span>
            <span class="font-black text-sm" [class.text-emerald-400]="diff() >= 0" [class.text-rose-400]="diff() < 0">
              €{{ diff().toFixed(2) }}
            </span>
          </div>

          <div class="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            <button 
              type="button"
              (click)="printX.emit()"
              class="h-12 bg-slate-800 hover:bg-slate-750 text-amber-400 font-black text-xs rounded-xl transition cursor-pointer border border-amber-500/40"
            >
              🖨️ ΕΚΤΥΠΩΣΗ "Χ"
            </button>
            <button 
              type="button"
              (click)="confirmClose.emit(countedCash())"
              class="h-12 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
            >
              ✔ ΚΛΕΙΣΙΜΟ ΒΑΡΔΙΑΣ
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class PosShiftHandoverModalComponent {
  isOpen = input<boolean>(false);
  shift = input<any>(null);
  expectedCash = input<number>(0);

  printX = output<void>();
  confirmClose = output<number>();
  close = output<void>();

  countedCash = signal<number>(0);

  diff(): number {
    return Number(this.countedCash()) - Number(this.expectedCash());
  }
}