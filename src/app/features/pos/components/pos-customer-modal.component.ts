import { Component, input, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Customer } from '../../../core/models';

@Component({
  selector: 'app-pos-customer-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
        <div class="bg-slate-900 border-2 border-slate-700 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
          
          <div class="flex justify-between items-center pb-2 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <span class="text-lg">👤</span>
              <h3 class="text-sm font-black text-amber-400 uppercase tracking-wider">Πρόγραμμα Πιστότητας &amp; Πελάτες</h3>
            </div>
            <button type="button" (click)="close.emit()" class="text-slate-400 hover:text-slate-100 font-mono text-lg cursor-pointer">✕</button>
          </div>

          <div class="space-y-1.5">
            <label class="text-[11px] font-bold text-slate-400 uppercase">Τηλέφωνο Πελάτη</label>
            <input 
              type="tel" 
              placeholder="π.χ. 6971234567..."
              [(ngModel)]="phone"
              (ngModelChange)="onSearchChange($event)"
              class="w-full h-12 bg-slate-950 border-2 border-slate-700 focus:border-amber-500 rounded-xl px-4 font-mono font-bold text-base text-slate-100 focus:outline-none"
            />
          </div>

          @if (searchResults().length > 0) {
            <div class="space-y-1.5 max-h-48 overflow-y-auto">
              @for (cust of searchResults(); track cust.id) {
                <button 
                  type="button"
                  (click)="selectCustomer.emit(cust)"
                  class="w-full p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl flex items-center justify-between text-left transition cursor-pointer"
                >
                  <div>
                    <span class="text-xs font-black text-slate-100 block">{{ cust.name }}</span>
                    <span class="text-[11px] font-mono text-slate-400">{{ cust.phone }}</span>
                  </div>
                  <span class="text-xs font-mono font-black text-amber-400 bg-amber-950/40 px-2 py-1 rounded-lg border border-amber-800/60">
                    {{ cust.loyaltyPoints || 0 }} pts
                  </span>
                </button>
              }
            </div>
          }

          @if (phone().length >= 5 && searchResults().length === 0) {
            <div class="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
              <span class="text-[11px] font-bold text-amber-400 block uppercase">Εγγραφή Νέου Πελάτη</span>
              <input 
                type="text" 
                placeholder="Ονοματεπώνυμο (προαιρετικό)..."
                [(ngModel)]="newName"
                class="w-full h-10 bg-slate-900 border border-slate-700 rounded-xl px-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              />
              <button 
                type="button"
                (click)="onQuickAdd()"
                class="w-full h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer shadow-md"
              >
                + ΑΜΕΣΗ ΕΓΓΡΑΦΗ &amp; ΣΥΝΔΕΣΗ
              </button>
            </div>
          }

          <button 
            type="button"
            (click)="close.emit()"
            class="w-full h-10 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
          >
            Κλείσιμο
          </button>

        </div>
      </div>
    }
  `
})
export class PosCustomerModalComponent {
  isOpen = input<boolean>(false);
  searchResults = input<Customer[]>([]);

  searchChange = output<string>();
  selectCustomer = output<Customer>();
  registerNew = output<{ phone: string; name: string }>();
  close = output<void>();

  phone = signal<string>('');
  newName = signal<string>('');

  onSearchChange(val: string): void {
    this.phone.set(val);
    this.searchChange.emit(val);
  }

  onQuickAdd(): void {
    if (!this.phone().trim()) return;
    this.registerNew.emit({
      phone: this.phone().trim(),
      name: this.newName().trim() || `Πελάτης ${this.phone()}`
    });
    this.phone.set('');
    this.newName.set('');
  }
}