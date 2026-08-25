import { Component, input, output, signal, inject, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MarketCatalogService } from '../../../core/services/market-catalog.service';
import { Product } from '../../../core/models';

@Component({
  selector: 'app-pos-price-check-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in">
        <div class="bg-slate-900 border-2 border-sky-500/60 rounded-3xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
          
          <!-- Header -->
          <div class="flex justify-between items-center pb-2 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse"></span>
              <h3 class="text-sm font-black text-sky-400 uppercase tracking-wider">🔍 Έλεγχος Τιμής Προϊόντος</h3>
            </div>
            <button 
              type="button" 
              (click)="onClose()" 
              class="text-slate-400 hover:text-slate-100 font-mono text-lg cursor-pointer transition"
            >
              ✕
            </button>
          </div>

          <!-- Input Field -->
          <div class="space-y-1">
            <label class="text-[11px] font-bold text-slate-400 uppercase block font-mono">Σκανάρετε barcode ή πληκτρολογήστε κωδικό / όνομα:</label>
            <div class="relative">
              <input 
                #priceInput
                type="text" 
                [(ngModel)]="query"
                (keydown.enter)="onSearch()"
                placeholder="Barcode ή ονομασία..."
                autocomplete="off"
                spellcheck="false"
                class="w-full h-12 bg-slate-950 border-2 border-slate-700 focus:border-sky-500 rounded-xl px-4 text-sm font-mono text-slate-100 focus:outline-none transition shadow-inner"
              />
              <button 
                type="button"
                (click)="onSearch()"
                class="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-slate-950 font-bold font-mono text-xs rounded-lg cursor-pointer transition"
              >
                Έλεγχος
              </button>
            </div>
          </div>

          <!-- Result Display Card -->
          @if (matchedProduct(); as prod) {
            <div class="p-4 bg-slate-950 rounded-2xl border border-sky-500/40 space-y-3 font-mono animate-in fade-in">
              <div class="flex items-center gap-3">
                <div class="w-14 h-14 rounded-xl bg-slate-900 border border-slate-800 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                  <img [src]="catalogService.getProductImageUrl(prod)" alt="" class="w-full h-full object-contain" />
                </div>
                <div class="min-w-0 flex-1">
                  <h4 class="text-sm font-black text-slate-100 truncate">{{ prod.name }}</h4>
                  <div class="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                    <span>Barcode: {{ prod.barcode || '—' }}</span>
                    <span>•</span>
                    <span>Κατηγορία: {{ prod.categoryName || 'General' }}</span>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center">
                <div class="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                  <span class="text-[10px] text-slate-500 block uppercase">Τιμή Λιανικής</span>
                  <span class="text-xl font-black text-emerald-400">€{{ prod.price.toFixed(2) }}</span>
                </div>
                <div class="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                  <span class="text-[10px] text-slate-500 block uppercase">ΦΠΑ</span>
                  <span class="text-lg font-bold text-sky-400">{{ prod.vatRate || 13 }}%</span>
                </div>
                <div class="bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                  <span class="text-[10px] text-slate-500 block uppercase">Απόθεμα</span>
                  <span class="text-lg font-bold" [class.text-emerald-400]="(prod.stockQuantity || 0) > 5" [class.text-rose-400]="(prod.stockQuantity || 0) <= 5">
                    {{ prod.stockQuantity }}
                  </span>
                </div>
              </div>
            </div>
          } @else if (hasSearched()) {
            <div class="p-4 bg-rose-950/20 border border-rose-500/30 rounded-2xl text-center text-rose-300 font-mono text-xs">
              ⚠️ Δεν βρέθηκε προϊόν με κωδικό ή περιγραφή "{{ query() }}"
            </div>
          }

          <!-- Footer Actions -->
          <div class="pt-2 border-t border-slate-800 grid grid-cols-2 gap-3 font-mono">
            <button 
              type="button" 
              (click)="onClose()" 
              class="h-11 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer transition"
            >
              Κλείσιμο [ESC]
            </button>
            <button 
              type="button" 
              [disabled]="!matchedProduct()"
              (click)="onAddToCart()" 
              class="h-11 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 font-black text-xs rounded-xl shadow-lg transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              🛒 Προσθήκη στο Καλάθι
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class PosPriceCheckModalComponent {
  @ViewChild('priceInput') priceInputRef?: ElementRef<HTMLInputElement>;

  public isOpen = input<boolean>(false);
  public initialQuery = input<string>('');

  public close = output<void>();
  public addToCart = output<Product>();

  public catalogService = inject(MarketCatalogService);

  public query = signal<string>('');
  public matchedProduct = signal<Product | null>(null);
  public hasSearched = signal<boolean>(false);

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        const init = this.initialQuery();
        this.query.set(init || '');
        this.hasSearched.set(false);
        this.matchedProduct.set(null);

        if (init) {
          this.onSearch();
        }

        setTimeout(() => {
          this.priceInputRef?.nativeElement?.focus();
          this.priceInputRef?.nativeElement?.select();
        }, 50);
      }
    });
  }

  public onSearch(): void {
    const q = this.query().trim();
    if (!q) return;

    this.hasSearched.set(true);
    const prod = this.catalogService.getByBarcode(q) || this.catalogService.getProductByAnyIdentifier(q);
    this.matchedProduct.set(prod || null);
  }

  public onAddToCart(): void {
    const prod = this.matchedProduct();
    if (prod) {
      this.addToCart.emit(prod);
      this.onClose();
    }
  }

  public onClose(): void {
    this.matchedProduct.set(null);
    this.hasSearched.set(false);
    this.query.set('');
    this.close.emit();
  }
}