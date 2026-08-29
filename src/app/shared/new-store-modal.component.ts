import { Component, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantConfigService } from '../core/services/tenant-config.service';
import { StoreTenant } from '../core/models';

@Component({
  selector: 'app-new-store-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div class="bg-slate-900 border border-slate-700 w-full max-w-md rounded-3xl p-6 shadow-2xl text-left">
        
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <span class="text-2xl">🏪</span>
            <h3 class="text-white font-bold text-lg">Add New Store Tenant</h3>
          </div>
          <button (click)="close.emit()" class="text-slate-400 hover:text-white text-lg">✕</button>
        </div>

        <form (ngSubmit)="saveStore()" class="space-y-3">
          <div>
            <label class="block text-xs font-semibold text-slate-400 mb-1">Store Code (Unique Slug)</label>
            <input 
              type="text" 
              [(ngModel)]="storeData.code" 
              name="code" 
              required
              placeholder="e.g. shop-glyfada"
              class="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-400 mb-1">Store Name</label>
            <input 
              type="text" 
              [(ngModel)]="storeData.name" 
              name="name" 
              required
              placeholder="e.g. Mini Market Glyfada"
              class="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs font-semibold text-slate-400 mb-1">AFM / Tax ID</label>
              <input 
                type="text" 
                [(ngModel)]="storeData.afm" 
                name="afm" 
                placeholder="999888777"
                class="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-xs font-semibold text-slate-400 mb-1">DOY (Tax Office)</label>
              <input 
                type="text" 
                [(ngModel)]="storeData.doy" 
                name="doy" 
                placeholder="GLYFADAS"
                class="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-400 mb-1">Address</label>
            <input 
              type="text" 
              [(ngModel)]="storeData.address" 
              name="address" 
              placeholder="Leof. Poseidonos 12"
              class="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div class="grid grid-cols-2 gap-2 pt-2">
            <button 
              type="button" 
              (click)="close.emit()" 
              class="py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition">
              Cancel
            </button>
            <button 
              type="submit" 
              [disabled]="!storeData.code || !storeData.name"
              class="py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-indigo-600/30">
              Create & Switch
            </button>
          </div>
        </form>
      </div>
    </div>
  `
})
export class NewStoreModalComponent {
  private tenantConfig = inject(TenantConfigService);
  public close = output<void>();

  public storeData: StoreTenant = {
    code: '',
    name: '',
    afm: '',
    doy: '',
    address: '',
    phone: '',
    currency: 'EUR',
    createdAt: new Date().toISOString()
  };

  public saveStore(): void {
    if (!this.storeData.code || !this.storeData.name) return;
    
    // Normalize code to lowercase slug
    this.storeData.code = this.storeData.code.trim().toLowerCase().replace(/\s+/g, '-');
    this.storeData.createdAt = new Date().toISOString();

    this.tenantConfig.registerShop(this.storeData);
    this.close.emit();
  }
}