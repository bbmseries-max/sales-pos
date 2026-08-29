import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CatalogImportService, ImportParsedRow } from '../../core/services/catalog-import.service';

@Component({
  selector: 'app-catalog-importer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './catalog-importer.component.html'
})
export class CatalogImporterComponent {
  private router = inject(Router);
  private importService = inject(CatalogImportService);

  // State Signals
  public rawText = signal<string>('');
  public parsedRows = signal<ImportParsedRow[]>([]);
  public importMode = signal<'UPSERT' | 'REPLACE'>('UPSERT');
  public isProcessing = signal<boolean>(false);
  public isDragOver = signal<boolean>(false);
  public statusMessage = signal<string>('');

  // Computed Counts
  public validCount = computed(() => this.parsedRows().filter(r => r.isValid).length);
  public invalidCount = computed(() => this.parsedRows().filter(r => !r.isValid).length);

  public navigateTo(path: string): void {
    this.router.navigate([path]);
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
    URL.revokeObjectURL(url);
  }

  public parseContent(): void {
    const text = this.rawText().trim();
    if (!text) {
      this.parsedRows.set([]);
      return;
    }
    const rows = this.importService.parseCsvText(text);
    this.parsedRows.set(rows);
    this.statusMessage.set(`Αναγνωρίστηκαν ${rows.length} γραμμές.`);
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input?.files && input.files[0]) {
      this.readFile(input.files[0]);
    }
  }

  public onFileDropped(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      this.readFile(event.dataTransfer.files[0]);
    }
  }

  private readFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result as string) || '';
      this.rawText.set(content);
      this.parseContent();
    };
    reader.readAsText(file, 'UTF-8');
  }

  public async executeImport(): Promise<void> {
    if (this.validCount() === 0 || this.isProcessing()) return;

    this.isProcessing.set(true);
    this.statusMessage.set('Εκτέλεση εισαγωγής στη βάση δεδομένων...');

    try {
      const result = await this.importService.commitImport(this.parsedRows(), this.importMode());
      this.statusMessage.set(`Επιτυχία! Προστέθηκαν: ${result.added}, Ενημερώθηκαν: ${result.updated}`);
      
      // Auto-navigate to POS or Inventory after 1.5s
      setTimeout(() => {
        this.router.navigate(['/pos']);
      }, 1500);
    } catch (err: any) {
      console.error('[CatalogImporter] Import failed:', err);
      this.statusMessage.set(`Σφάλμα κατά την εισαγωγή: ${err?.message || 'Άγνωστο σφάλμα'}`);
    } finally {
      this.isProcessing.set(false);
    }
  }
}