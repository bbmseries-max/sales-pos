import { Component, input, output, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ExternalProductMatch } from '../../../core/services/market-catalog.service';

export interface QuickRegisterConfirmEvent {
  barcode: string;
  name: string;
  categoryName: string;
  price: number;
  vatRate: number;
  imageUrl?: string;
}

@Component({
  selector: 'app-pos-quick-register-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen() && productMatch(); as item) {
      <div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-in fade-in">
        <div class="bg-slate-900 border-2 border-emerald-500/60 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
          
          <div class="flex justify-between items-center pb-2 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <h3 class="text-sm font-black text-emerald-400 uppercase tracking-wider">🌐 Νέο Προϊόν (Open Catalog)</h3>
            </div>
            <button type="button" (click)="onCancel()" class="text-slate-400 hover:text-slate-100 font-mono text-lg cursor-pointer">✕</button>
          </div>

          <div class="flex items-center gap-3.5 p-3.5 bg-slate-950 rounded-2xl border border-slate-800">
            <div class="w-14 h-14 rounded-xl bg-slate-900 border border-slate-800 p-1 flex items-center justify-center shrink-0 overflow-hidden">
              <img [src]="item.imageUrl || defaultImg" alt="" class="w-full h-full object-contain" />
            </div>
            <div class="min-w-0 flex-1 font-mono">
              <span class="text-[10px] text-slate-500 uppercase block">Barcode: {{ item.barcode }}</span>
              <input 
                type="text" 
                [(ngModel)]="name" 
                placeholder="Περιγραφή είδους"
                class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-100 focus:outline-none focus:border-emerald-500 mt-1"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 font-mono">
            <div>
              <label class="text-[11px] font-bold text-slate-300 uppercase block mb-1">Τιμή Λιανικής (€)</label>
              <div class="relative">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-500">€</span>
                <input 
                  type="number" 
                  step="0.05"
                  min="0.05"
                  [(ngModel)]="price"
                  class="w-full h-12 bg-slate-950 border-2 border-emerald-500/80 rounded-xl pl-8 pr-3 font-black text-xl text-emerald-400 focus:outline-none text-center"
                />
              </div>
            </div>
            <div>
              <label class="text-[11px] font-bold text-slate-300 uppercase block mb-1">Συντελεστής ΦΠΑ</label>
              <select 
                [(ngModel)]="vatRate"
                class="w-full h-12 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 font-bold text-xs text-slate-200"
              >
                <option [ngValue]="13">13% (Τρόφιμα)</option>
                <option [ngValue]="24">24% (Ποτά/Καθαριστικά)</option>
                <option [ngValue]="6">6% (Φάρμακα/Τύπος)</option>
                <option [ngValue]="0">0% (Τσιγάρα-Κάρτες-Καπνικά)</option>
              </select>
            </div>
          </div>

          <div class="pt-2 border-t border-slate-800 grid grid-cols-2 gap-3 font-mono">
            <button 
              type="button"
              (click)="onCancel()" 
              class="h-11 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer transition"
            >
              Ακύρωση
            </button>
            <button 
              type="button"
              (click)="onConfirm()" 
              class="h-11 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>🛒 ΑΠΟΘΗΚΕΥΣΗ &amp; ΠΡΟΣΘΗΚΗ</span>
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class PosQuickRegisterModalComponent {
  // --- Inputs ---
  public isOpen = input<boolean>(false);
  public productMatch = input<ExternalProductMatch | null>(null);

  // --- Outputs ---
  public confirmed = output<QuickRegisterConfirmEvent>();
  public cancelled = output<void>();

  // --- State Signals ---
  public name = signal<string>('');
  public price = signal<number>(1.50);
  public vatRate = signal<number>(13);

  public defaultImg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%2364748b" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';

  constructor() {
    effect(() => {
      const match = this.productMatch();
      if (match) {
        this.name.set(match.name || '');
        this.price.set(match.suggestedPrice || 1.50);
        this.vatRate.set(match.suggestedVatRate || 13);
      }
    });
  }

  public onConfirm(): void {
    const match = this.productMatch();
    if (!match || this.price() <= 0) return;

    this.confirmed.emit({
      barcode: match.barcode,
      name: this.name().trim() || match.name,
      categoryName: match.categoryName || 'General',
      price: Number(this.price()),
      vatRate: Number(this.vatRate()),
      imageUrl: match.imageUrl
    });
  }

  public onCancel(): void {
    this.cancelled.emit();
  }
}