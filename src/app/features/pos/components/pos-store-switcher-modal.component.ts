import { Component, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantConfigService } from '../../../core/services/tenant-config.service';
import { StoreTenant } from '../../../core/models/store-tenant.model';

@Component({
  selector: 'app-pos-store-switcher-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-in fade-in">
        <div class="bg-slate-900 border-2 border-emerald-500/50 rounded-3xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
          
          <!-- Header -->
          <div class="flex justify-between items-center pb-2 border-b border-slate-800">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏪</span>
              <h3 class="text-sm font-black text-emerald-400 uppercase tracking-wider">Διαχείριση Καταστημάτων (Shops / Tenants)</h3>
            </div>
            <button type="button" (click)="close.emit()" class="text-slate-400 hover:text-slate-100 font-mono text-lg cursor-pointer">✕</button>
          </div>

          <!-- Add New Shop Accordion / Form -->
          <div class="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3 font-mono text-xs">
            <span class="text-[11px] font-bold text-amber-400 uppercase block font-sans">➕ Προσθήκη Νέου Καταστήματος</span>
            
            <div class="grid grid-cols-2 gap-2">
              <input type="text" [(ngModel)]="newCode" placeholder="Tenant Code (π.χ. mar-market-2)" class="h-9 bg-slate-900 border border-slate-700 rounded-xl px-2.5 text-slate-100 focus:outline-none focus:border-emerald-500" />
              <input type="text" [(ngModel)]="newName" placeholder="Επωνυμία (π.χ. Store Glyfada)" class="h-9 bg-slate-900 border border-slate-700 rounded-xl px-2.5 text-slate-100 focus:outline-none focus:border-emerald-500" />
            </div>

            <div class="grid grid-cols-2 gap-2">
              <input type="text" [(ngModel)]="newAfm" placeholder="ΑΦΜ" class="h-9 bg-slate-900 border border-slate-700 rounded-xl px-2.5 text-slate-100 focus:outline-none focus:border-emerald-500" />
              <input type="text" [(ngModel)]="newDoy" placeholder="ΔΟΥ" class="h-9 bg-slate-900 border border-slate-700 rounded-xl px-2.5 text-slate-100 focus:outline-none focus:border-emerald-500" />
            </div>

            <input type="text" [(ngModel)]="newAddress" placeholder="Διεύθυνση / Περιοχή" class="w-full h-9 bg-slate-900 border border-slate-700 rounded-xl px-2.5 text-slate-100 focus:outline-none focus:border-emerald-500" />

            <button 
              type="button" 
              (click)="onAddShop()" 
              class="w-full h-10 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-xl cursor-pointer transition"
            >
              Αποθήκευση &amp; Εναλλαγή
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class PosStoreSwitcherModalComponent {
  public isOpen = input<boolean>(false);
  public close = output<void>();

  public tenantService = inject(TenantConfigService);

  public newCode = signal<string>('mar-market');
  public newName = signal<string>('Maranth Market Hub');
  public newAfm = signal<string>('123456789');
  public newDoy = signal<string>('XALANDRIOU');
  public newAddress = signal<string>('Pentelis 45, Vrilissia');


  public onAddShop(): void {
    if (!this.newCode().trim() || !this.newName().trim()) return;

    this.tenantService.registerShop({
      code: this.newCode().trim().toLowerCase(),
      name: this.newName().trim(),
      afm: this.newAfm().trim() || '123456789',
      doy: this.newDoy().trim() || 'General',
      address: this.newAddress().trim() || 'Athens',
      phone: '210-0000000',
      currency: 'EUR',
      createdAt: new Date().toISOString()
    });

    this.close.emit();
  }
}