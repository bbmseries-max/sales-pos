import { Component, input, output, signal, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TenantConfigService } from '../../../core/services/tenant-config.service';

@Component({
  selector: 'app-pos-lock-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isLocked()) {
      <div class="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-50 flex flex-col items-center justify-center p-4 select-none">
        
        <div class="w-full max-w-sm space-y-6 text-center animate-in fade-in zoom-in-95">
          
          <!-- Brand Logo Header -->
          <div class="flex flex-col items-center justify-center space-y-1">
            @if (!hasLogoError()) {
              <img
                src="icons/maranth-lock.png"
                alt="Maranth"
                (error)="hasLogoError.set(true)"
                class="h-14 w-auto object-contain drop-shadow-[0_4px_16px_rgba(16,185,129,0.25)] mb-1"
              />
            } @else {
              <span class="text-4xl block mb-1">🔒</span>
            }

            <h2 class="text-lg font-black tracking-widest text-slate-100 uppercase">
              {{ tenantConfig.activeShop().name }}
            </h2>
            <p class="text-xs font-mono text-emerald-400 uppercase tracking-wider">
              Είσοδος Ταμεία • PIN
            </p>
          </div>

          <!-- PIN Progress Dots -->
          <div class="flex justify-center gap-3.5 py-1">
            @for (dot of [0, 1, 2, 3]; track dot) {
              <div 
                class="w-4 h-4 rounded-full border-2 transition-all duration-200"
                [class.bg-emerald-400]="pin().length > dot"
                [class.border-emerald-400]="pin().length > dot"
                [class.shadow-lg]="pin().length > dot"
                [class.shadow-emerald-500/50]="pin().length > dot"
                [class.border-slate-700]="pin().length <= dot"
                [class.bg-slate-900]="pin().length <= dot"
              ></div>
            }
          </div>

          @if (errorMessage()) {
            <p class="text-xs font-mono text-red-400 font-bold animate-bounce">{{ errorMessage() }}</p>
          }

          <!-- Numpad Grid -->
          <div class="grid grid-cols-3 gap-2.5">
            @for (num of ['1', '2', '3', '4', '5', '6', '7', '8', '9']; track num) {
              <button 
                type="button"
                (click)="enterDigit(num)"
                class="h-14 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/60 hover:bg-slate-850 active:scale-95 text-xl font-mono font-bold text-slate-100 transition duration-150 cursor-pointer shadow-md"
              >
                {{ num }}
              </button>
            }
            <button 
              type="button" 
              (click)="clearPin()"
              class="h-14 rounded-2xl bg-slate-900 border border-slate-800 hover:border-red-500/60 hover:text-red-400 active:scale-95 text-xs font-mono font-bold text-slate-400 transition cursor-pointer"
            >
              CLEAR
            </button>
            <button 
              type="button"
              (click)="enterDigit('0')"
              class="h-14 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/60 hover:bg-slate-850 active:scale-95 text-xl font-mono font-bold text-slate-100 transition duration-150 cursor-pointer shadow-md"
            >
              0
            </button>
            <button 
              type="button"
              (click)="backspace()"
              class="h-14 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 active:scale-95 text-xl font-mono font-bold text-slate-400 transition cursor-pointer"
            >
              ⌫
            </button>
          </div>

        </div>
      </div>
    }
  `
})
export class PosLockScreenComponent {
  public tenantConfig = inject(TenantConfigService);

  isLocked = input<boolean>(false);
  cashiers = input<any[]>([]);
  errorMessage = input<string>('');

  pinSubmit = output<string>();

  pin = signal<string>('');
  hasLogoError = signal<boolean>(false);

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    if (!this.isLocked()) return;

    if (event.key >= '0' && event.key <= '9') {
      event.preventDefault();
      event.stopPropagation();
      this.enterDigit(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.backspace();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.clearPin();
    }
  }

  enterDigit(d: string): void {
    if (this.pin().length < 4) {
      const next = this.pin() + d;
      this.pin.set(next);
      console.log('[LOCK-SCREEN] Digit entered:', d, 'Current PIN buffer:', next);
      
      if (next.length === 4) {
        console.log('[LOCK-SCREEN] 4 Digits reached, emitting pinSubmit:', next);
        this.pinSubmit.emit(next);
        this.clearPin();
      }
    }
  }

  clearPin(): void {
    this.pin.set('');
  }

  backspace(): void {
    this.pin.set(this.pin().slice(0, -1));
  }
}