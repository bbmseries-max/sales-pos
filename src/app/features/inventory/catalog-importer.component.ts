import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CatalogImportService, ImportParsedRow } from '../../core/services/catalog-import.service'

@Component({
  selector: 'app-catalog-importer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './catalog-importer.component.html'
})
export class CatalogImporterComponent {
  public importService = inject(CatalogImportService);

  public rawText = signal<string>('');
  public parsedRows = signal<ImportParsedRow[]>([]);
  public importMode = signal<'UPSERT' | 'REPLACE'>('UPSERT');
  public isProcessing = signal<boolean>(false);
  public statusMessage = signal<string>('');
  public isDragOver = signal<boolean>(false);
  private router = inject(Router);


  public validCount = computed(() => this.parsedRows().filter(r => r.isValid).length);
  public invalidCount = computed(() => this.parsedRows().filter(r => !r.isValid).length);

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.readFile(input.files[0]);
    }
  }

  public onFileDropped(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.readFile(event.dataTransfer.files[0]);
    }
  }
  public navigateTo(path: string): void {
    this.router.navigate([path]);
  }

  public readFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      this.rawText.set(text);
      this.parseContent();
    };
    reader.readAsText(file, 'UTF-8');
  }

  public parseContent(): void {
    const text = this.rawText().trim();
    if (!text) {
      this.parsedRows.set([]);
      return;
    }
    const rows = this.importService.parseCsvText(text);
    this.parsedRows.set(rows);
    this.statusMessage.set(`Αναλύθηκαν ${rows.length} εγγραφές (${this.validCount()} έγκυρες, ${this.invalidCount()} με σφάλμα).`);
  }

  public downloadTemplate(): void {
    const csvContent = this.importService.generateSampleCsv();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'maranth_catalog_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  public async executeImport(): Promise<void> {
    if (this.validCount() === 0) return;

    this.isProcessing.set(true);
    try {
      const res = await this.importService.commitImport(this.parsedRows(), this.importMode());
      this.statusMessage.set(`✔ Επιτυχής εισαγωγή! Προστέθηκαν: ${res.added}, Ενημερώθηκαν: ${res.updated}`);
      this.rawText.set('');
      this.parsedRows.set([]);
    } catch (err: any) {
      this.statusMessage.set(`⛔ Σφάλμα κατά την εισαγωγή: ${err.message}`);
    } finally {
      this.isProcessing.set(false);
    }
  }
}