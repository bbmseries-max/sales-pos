import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pos-lock-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isLocked()) {
      <div class="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-50 flex flex-col items-center justify-center p-4 select-none">
        
        <div class="w-full max-w-sm space-y-6 text-center animate-in fade-in zoom-in-95">
          
          <div class="space-y-1">
            <span class="text-4xl block mb-2">🔒</span>
            <h2 class="text-xl font-black tracking-widest text-slate-100 uppercase">ΕΙΣΟΔΟΣ ΤΑΜΙΑ</h2>
            <p class="text-xs font-mono text-slate-400">Εισάγετε τον 4ψήφιο κωδικό PIN σας</p>
          </div>

          <div class="flex justify-center gap-3.5 py-2">
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

          <div class="grid grid-cols-3 gap-3">
            @for (num of ['1', '2', '3', '4', '5', '6', '7', '8', '9']; track num) {
              <button 
                type="button"
                (click)="enterDigit(num)"
                class="h-16 rounded-2xl bg-slate-900 border-2 border-slate-800 hover:border-emerald-500 hover:bg-slate-850 active:scale-90 text-xl font-mono font-black text-slate-100 transition duration-150 cursor-pointer shadow-md"
              >
                {{ num }}
              </button>
            }
            <button 
              type="button"
              (click)="clearPin()"
              class="h-16 rounded-2xl bg-slate-900 border-2 border-slate-800 hover:border-red-500/60 hover:text-red-400 active:scale-90 text-sm font-mono font-bold text-slate-400 transition cursor-pointer"
            >
              CLEAR
            </button>
            <button 
              type="button"
              (click)="enterDigit('0')"
              class="h-16 rounded-2xl bg-slate-900 border-2 border-slate-800 hover:border-emerald-500 hover:bg-slate-850 active:scale-90 text-xl font-mono font-black text-slate-100 transition duration-150 cursor-pointer shadow-md"
            >
              0
            </button>
            <button 
              type="button"
              (click)="backspace()"
              class="h-16 rounded-2xl bg-slate-900 border-2 border-slate-800 hover:border-slate-700 active:scale-90 text-xl font-mono font-bold text-slate-400 transition cursor-pointer"
            >
              ⌫
            </button>
          </div>

          @if (cashiers().length > 0) {
            <div class="pt-4 border-t border-slate-800">
              <span class="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-2">Γρήγοροι Ταμίες</span>
              <div class="flex justify-center flex-wrap gap-2">
                @for (c of cashiers(); track c.id) {
                  <span class="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400">
                    {{ c.name }} ({{ c.pin }})
                  </span>
                }
              </div>
            </div>
          }

        </div>
      </div>
    }
  `
})
export class PosLockScreenComponent {
  isLocked = input<boolean>(false);
  cashiers = input<any[]>([]);
  errorMessage = input<string>('');

  pinSubmit = output<string>();

  pin = signal<string>('');

  enterDigit(d: string): void {
    if (this.pin().length < 4) {
      const next = this.pin() + d;
      this.pin.set(next);
      if (next.length === 4) {
        this.pinSubmit.emit(next);
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