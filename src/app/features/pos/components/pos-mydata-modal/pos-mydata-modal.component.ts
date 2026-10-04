import { Component, Input, Output, EventEmitter, signal, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface MyDataCredentialsForm {
  environment: 'sandbox' | 'production';
  issuerAfm: string;
  aadeUserId: string;
  subscriptionKey: string;
}

@Component({
  selector: 'app-pos-mydata-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './pos-mydata-modal.component.html'
})
export class PosMydataModalComponent implements OnChanges {
  @Input({ required: true }) isOpen = false;
  @Input({ required: true }) credentials!: MyDataCredentialsForm;

  @Output() close = new EventEmitter<void>();
  @Output() saveCredentials = new EventEmitter<MyDataCredentialsForm>();

  public form = signal<MyDataCredentialsForm>({
    environment: 'sandbox',
    issuerAfm: '',
    aadeUserId: '',
    subscriptionKey: ''
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['credentials'] && this.credentials) {
      this.form.set({ ...this.credentials });
    }
  }

  public handleSave(): void {
    this.saveCredentials.emit(this.form());
    this.close.emit();
  }
}