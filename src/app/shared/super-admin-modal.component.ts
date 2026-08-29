import { Component, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantConfigService } from '../core/services/tenant-config.service';

@Component({
  selector: 'app-super-admin-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div class="bg-slate-900 border border-slate-700 w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center relative">
        
        <!-- Header Icon -->
        <div class="w-14 h-14 bg-indigo-500/20 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl border border-indigo-500/30">
          ⚡
        </div>

        <h3 class="text-white font-bold text-lg mb-1">Master Unlock</h3>
        <p class="text-xs text-slate-400 mb-5">Enter Super-Admin Master PIN to enable store management</p>

        <!-- PIN Display Input -->
        <form (ngSubmit)="submitPin()">
          <div class="relative mb-4">
            <input
              type="password"
              maxlength="8"
              [(ngModel)]="pin"
              name="masterPin"
              placeholder="••••"
              readonly
              class="w-full bg-slate-950 border border-slate-800 text-center text-2xl tracking-[0.5em] text-indigo-400 font-mono py-3 rounded-2xl focus:border-indigo-500 focus:outline-none"
            />
          </div>

          @if (errorMessage()) {
            <div class="p-2 mb-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs font-semibold animate-shake">
              {{ errorMessage() }}
            </div>
          }

          <!-- On-Screen Numpad for Touch / Tablet -->
          <div class="grid grid-cols-3 gap-2 mb-4">
            @for (num of ['1', '2', '3', '4', '5', '6', '7', '8', '9']; track num) {
              <button
                type="button"
                (click)="appendDigit(num)"
                class="h-12 bg-slate-800/80 hover:bg-slate-700 active:bg-indigo-600 text-white font-mono text-lg font-bold rounded-xl border border-slate-700/60 transition cursor-pointer">
                {{ num }}
              </button>
            }
            <button
              type="button"
              (click)="clearPin()"
              class="h-12 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 font-bold rounded-xl border border-rose-900/40 text-xs transition cursor-pointer">
              CLEAR
            </button>
            <button
              type="button"
              (click)="appendDigit('0')"
              class="h-12 bg-slate-800/80 hover:bg-slate-700 active:bg-indigo-600 text-white font-mono text-lg font-bold rounded-xl border border-slate-700/60 transition cursor-pointer">
              0
            </button>
            <button
              type="button"
              (click)="deleteDigit()"
              class="h-12 bg-slate-800/80 hover:bg-slate-700 active:bg-indigo-600 text-slate-300 font-bold rounded-xl border border-slate-700/60 text-base transition cursor-pointer">
              ⌫
            </button>
          </div>

          <!-- Action Buttons -->
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              (click)="close.emit()"
              class="py-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer">
              Cancel
            </button>
            <button
              type="submit"
              [disabled]="pin.length === 0"
              class="py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-indigo-600/30 cursor-pointer">
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  `
})
export class SuperAdminModalComponent {
  private tenantConfig = inject(TenantConfigService);

  public pin = '';
  public errorMessage = signal<string>('');
  public close = output<void>();

  public appendDigit(digit: string): void {
    if (this.pin.length < 8) {
      this.pin += digit;
      this.errorMessage.set('');
    }
  }

  public deleteDigit(): void {
    this.pin = this.pin.slice(0, -1);
    this.errorMessage.set('');
  }

  public clearPin(): void {
    this.pin = '';
    this.errorMessage.set('');
  }

  public async submitPin(): Promise<void> {
    const success = await this.tenantConfig.unlockSuperAdmin(this.pin);
    if (success) {
      this.close.emit();
    } else {
      this.errorMessage.set('Invalid Master PIN');
      this.pin = '';
    }
  }
}