import { Component, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantConfigService } from '../core/services/tenant-config.service';
import { StoreTenant, StoreHardwareSettings } from '../core/models';

@Component({
  selector: 'app-new-store-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div class="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl p-6 shadow-2xl text-left max-h-[90vh] overflow-y-auto">
        
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <span class="text-2xl">🏪</span>
            <h3 class="text-white font-bold text-lg">Add New Store Tenant</h3>
          </div>
          <button (click)="close.emit()" class="text-slate-400 hover:text-white text-lg">✕</button>
        </div>

        <form (ngSubmit)="saveStore()" class="space-y-4">
          <!-- Basic Tenant Details -->
          <div class="space-y-3">
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
          </div>

          <!-- Hardware & Thermal Printer Settings -->
          <div class="pt-3 border-t border-slate-800 space-y-3">
            <div class="flex items-center gap-1.5">
              <span class="text-sm">🖨️</span>
              <h4 class="text-xs font-bold text-indigo-400 uppercase tracking-wider">Printer & Hardware Profile</h4>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1">Printer Driver</label>
                <select 
                  [(ngModel)]="hardware.printerDriver" 
                  name="printerDriver"
                  class="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  <option value="browser">Browser / OS Driver</option>
                  <option value="escpos-usb">USB (WebUSB Direct)</option>
                  <option value="escpos-bluetooth">Bluetooth (Portable)</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-400 mb-1">Paper Roll</label>
                <select 
                  [(ngModel)]="hardware.paperWidth" 
                  name="paperWidth"
                  class="w-full bg-slate-950 border border-slate-700 text-white rounded-xl px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none"
                >
                  <option value="58mm">58mm (Small Roll)</option>
                  <option value="80mm">80mm (Standard POS)</option>
                </select>
              </div>
            </div>

            <div class="flex items-center justify-between pt-1">
              <label class="text-xs font-medium text-slate-300 flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  [(ngModel)]="hardware.printMyDataQr" 
                  name="printMyDataQr"
                  class="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 w-4 h-4"
                />
                Print AADE myDATA QR Code
              </label>

              <label class="text-xs font-medium text-slate-300 flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  [(ngModel)]="hardware.autoPrintReceipt" 
                  name="autoPrintReceipt"
                  class="rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-0 w-4 h-4"
                />
                Auto-Print on Checkout
              </label>
            </div>
          </div>

          <!-- Actions -->
          <div class="grid grid-cols-2 gap-2 pt-3 border-t border-slate-800">
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

  public hardware: StoreHardwareSettings = {
    printerDriver: 'browser',
    paperWidth: '58mm',
    autoPrintReceipt: true,
    printMyDataQr: true,
    footerNote: 'Ευχαριστούμε για την προτίμηση!'
  };

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

    this.storeData.code = this.storeData.code.trim().toLowerCase().replace(/\s+/g, '-');
    this.storeData.createdAt = new Date().toISOString();
    this.storeData.hardwareSettings = { ...this.hardware };

    this.tenantConfig.registerShop(this.storeData);
    this.close.emit();
  }
}