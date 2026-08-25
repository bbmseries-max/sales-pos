import { Directive, ElementRef, HostListener, inject, AfterViewInit } from '@angular/core';

@Directive({
  selector: '[appAutoScanInput]',
  standalone: true
})
export class AutoScanInputDirective implements AfterViewInit {
  private el = inject(ElementRef<HTMLInputElement>);

  ngAfterViewInit(): void {
    // Focus immediately when modal/view mounts
    setTimeout(() => this.focusAndSelect(), 50);
  }

  @HostListener('keydown.enter')
  onEnter(): void {
    // When scanner fires Enter, select all text so next scan replaces it instantly
    setTimeout(() => this.focusAndSelect(), 0);
  }

  @HostListener('focus')
  onFocus(): void {
    this.el.nativeElement.select();
  }

  public focusAndSelect(): void {
    const input = this.el.nativeElement;
    input.focus();
    input.select();
  }
}