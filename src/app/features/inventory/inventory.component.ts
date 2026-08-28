import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { marketDb } from '../../core/db/market-db';
import { MarketCatalogService } from '../../core/services/market-catalog.service';
import { TenantConfigService } from '../../core/services/tenant-config.service';
import { 
  Product, 
  Category,
  SUPERMARKET_DEPARTMENTS, 
  MasterCategory
} from '../../core/models/market.models';

export interface CategoryTab {
  id: string;
  name: string;
  count: number;
}

export type FilterTab = 'all' | 'low-stock' | 'expiring' | 'pinned';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './inventory.component.html'
})
export class InventoryComponent implements OnInit {
  public catalogService = inject(MarketCatalogService);
  public tenantConfig = inject(TenantConfigService);
  private router = inject(Router);

  // Single Source of Truth for Departments
  public masterDepartments: MasterCategory[] = SUPERMARKET_DEPARTMENTS;

  // State Signals
  public allProducts = signal<Product[]>([]);
  public selectedTab = signal<FilterTab>('all');
  public selectedCategoryId = signal<string>('all');
  public searchQuery = signal<string>('');

  // Header Summary Counts
  public totalCount = signal<number>(0);
  public lowStockCount = signal<number>(0);
  public expiringCount = signal<number>(0);
  public pinnedCount = signal<number>(0);

  // Active editing item modal & feedback
  public editingProduct = signal<Product | null>(null);
  public feedbackMsg = signal<string | null>(null);

  // 1. DYNAMIC CATEGORIES: Extracts categories & counts directly from items in DB
  public categories = computed(() => {
    const prods = this.allProducts();
    const countMap = new Map<string, number>();

    for (const p of prods) {
      let catId = p.categoryId || 'cat-pantry';
      if (catId === 'cat-Ζοοτροφές' || catId === 'cat-zootrofes') {
        catId = 'cat-pets';
      }
      countMap.set(catId, (countMap.get(catId) || 0) + 1);
    }

    const tabs: CategoryTab[] = [
      { id: 'all', name: '📦 Όλα τα Είδη', count: prods.length }
    ];

    for (const dept of SUPERMARKET_DEPARTMENTS) {
      tabs.push({
        id: dept.id,
        name: `${dept.icon} ${dept.name}`,
        count: countMap.get(dept.id) || 0
      });
    }

    return tabs;
  });

  // 2. FILTERED PRODUCTS: Provides reactive list to the template
  public products = computed<Product[]>(() => {
    let items = this.allProducts();
    const term = this.searchQuery().trim().toLowerCase();
    const catId = this.selectedCategoryId();
    const tab = this.selectedTab();

    // Search query filter
    if (term.length > 0) {
      items = items.filter(p =>
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.brand && p.brand.toLowerCase().includes(term)) ||
        (p.id && String(p.id).toLowerCase().includes(term))
      );
    }

    // Department category filter
    if (catId !== 'all') {
      items = items.filter(p => 
        p.categoryId === catId || 
        p.categoryName === catId ||
        (p.categoryName && `cat-${p.categoryName}` === catId)
      );
    }

    // Status tab filter
    if (tab === 'low-stock') {
      items = items.filter(p => (p.stockQuantity ?? 0) <= (p.minStockWarning ?? 5));
    } else if (tab === 'pinned') {
      items = items.filter(p => !!p.isPinned);
    } else if (tab === 'expiring') {
      const now = new Date();
      const future30 = new Date();
      future30.setDate(now.getDate() + 30);
      items = items.filter(p => {
        const exp = (p as any).statusDate || (p as any).expireDate || (p as any).expire;
        if (!exp) return false;
        const d = new Date(exp);
        return !isNaN(d.getTime()) && d <= future30;
      });
    }

    // Cap at 150 items for smooth 60fps view on wide unfiltered lists
    if (!term && catId === 'all' && tab === 'all') {
      return items.slice(0, 150);
    }

    return items;
  });

  async ngOnInit(): Promise<void> {
    await this.loadAllInventory();
  }

/**
 * Loads inventory, supporting both multi-tenant storeId and legacy unassigned products
 */
public async loadAllInventory(): Promise<void> {
  const currentStoreId = this.tenantConfig.activeShop().code || 'SHOP-01';
  
  // 1. Fetch all items from DB
  const all = await marketDb.products.toArray();

  // 2. Match current store OR unassigned legacy items, and filter out soft-deleted items
  const activeOnly = (all || []).filter(p => 
    p.isActive !== false && 
    (!p.storeId || p.storeId === currentStoreId)
  );

  this.allProducts.set(activeOnly);

  // 3. Update Header Counts
  this.totalCount.set(activeOnly.length);
  this.lowStockCount.set(activeOnly.filter(p => (p.stockQuantity ?? 0) <= (p.minStockWarning ?? 5)).length);
  this.pinnedCount.set(activeOnly.filter(p => !!p.isPinned).length);

  const future30 = new Date();
  future30.setDate(new Date().getDate() + 30);

  this.expiringCount.set(
    activeOnly.filter(p => {
      const exp = (p as any).statusDate || (p as any).expireDate || (p as any).expire;
      if (!exp) return false;
      const d = new Date(exp);
      return !isNaN(d.getTime()) && d <= future30;
    }).length
  );
}

  public onCategoryChange(newCatId: string): void {
    const current = this.editingProduct();
    if (!current) return;

    const found = this.masterDepartments.find(d => d.id === newCatId);
    this.editingProduct.set({
      ...current,
      categoryId: newCatId,
      categoryName: found ? found.name : 'Παντοπωλείο & Τρόφιμα'
    });
  }

  public setTab(tab: FilterTab): void {
    this.selectedTab.set(tab);
  }

  public selectCategory(catId: string): void {
    this.selectedCategoryId.set(catId);
  }

  public onSearchChange(term: string): void {
    this.searchQuery.set(term);
  }

  public async promptRenameCategory(cat: Category | CategoryTab): Promise<void> {
    const newName = prompt(`Εισάγετε νέο όνομα για την κατηγορία:`, cat.name);
    if (newName && newName.trim() !== '') {
      await this.catalogService.updateCategoryName(cat.id, newName.trim());
      await this.loadAllInventory();
      this.showToast(`Η κατηγορία μετονομάστηκε σε "${newName.trim()}"`);
    }
  }

  public onExpireDateChange(dateValue: string): void {
    const current = this.editingProduct();
    if (!current) return;

    this.editingProduct.set({
      ...current,
      expire: dateValue || undefined,
      statusDate: dateValue || undefined
    });
  }

  public async softDeleteProduct(product: Product): Promise<void> {
    const targetId = product.id;
    if (targetId === undefined || targetId === null) return;

    const confirmed = confirm(`Θέλετε να απενεργοποιήσετε το είδος "${product.name}"; Το προϊόν δεν θα εμφανίζεται στο ταμείο.`);
    if (!confirmed) return;

    this.closeEditModal();

    const idToUpdate = typeof targetId === 'string' && !isNaN(Number(targetId)) ? Number(targetId) : targetId;

    await marketDb.products.update(idToUpdate as any, {
      isActive: false,
      deletedAt: new Date().toISOString()
    });

    await this.loadAllInventory();
    await this.catalogService.loadInitialCatalog();
    this.showToast(`Το προϊόν "${product.name}" τέθηκε σε αρχειοθέτηση.`);
  }

  public async restoreProduct(product: Product): Promise<void> {
    const targetId = product.id;
    if (!targetId) return;

    const idToUpdate = typeof targetId === 'string' && !isNaN(Number(targetId)) ? Number(targetId) : targetId;

    await marketDb.products.update(idToUpdate as any, {
      isActive: true,
      deletedAt: undefined
    });

    await this.loadAllInventory();
    await this.catalogService.loadInitialCatalog();
    this.showToast(`Το προϊόν "${product.name}" επανήλθε σε ενεργή κατάσταση.`);
  }

  public async updateInlineStock(product: Product, delta: number): Promise<void> {
    const current = product.stockQuantity ?? 0;
    const newQty = Math.max(0, parseFloat((current + delta).toFixed(3)));
    product.stockQuantity = newQty;
    
    if (product.id) {
      const idToUpdate = typeof product.id === 'string' && !isNaN(Number(product.id)) ? Number(product.id) : product.id;
      await marketDb.products.update(idToUpdate as any, { stockQuantity: newQty });
    }
    await this.loadAllInventory();
    await this.catalogService.loadInitialCatalog();
  }

  public async saveProductChanges(): Promise<void> {
    const item = this.editingProduct();
    if (!item) return;

    item.storeId = item.storeId || this.tenantConfig.activeShop().code || 'SHOP-01';
    item.updatedAt = new Date().toISOString();
    
    await marketDb.products.put(item);

    this.closeEditModal();
    await this.loadAllInventory();
    await this.catalogService.loadInitialCatalog();
    this.showToast(`Ενημερώθηκε: "${item.name}"`);
  }

  public getCategoryName(categoryId?: string, categoryName?: string): string {
    if (categoryName && categoryName.trim() !== '') return categoryName;
    return this.catalogService.getCategoryName(categoryId);
  }

  public async togglePin(product: Product, event: Event): Promise<void> {
    event.stopPropagation();
    const newStatus = !product.isPinned;
    product.isPinned = newStatus;
    
    if (product.id) {
      const idToUpdate = typeof product.id === 'string' && !isNaN(Number(product.id)) ? Number(product.id) : product.id;
      await marketDb.products.update(idToUpdate as any, { isPinned: newStatus });
    }
    await this.loadAllInventory();
    this.showToast(newStatus ? `Καρφιτσώθηκε: "${product.name}"` : `Ξεκαρφιτσώθηκε: "${product.name}"`);
  }

  public navigateToImport(): void {
    this.router.navigate(['/import']);
  }

  public openEditModal(product: Product): void {
    this.editingProduct.set({ ...product });
  }

  public closeEditModal(): void {
    this.editingProduct.set(null);
  }

  public isItemExpired(expireDate?: string): boolean {
    if (!expireDate) return false;
    const d = new Date(expireDate);
    return !isNaN(d.getTime()) && d < new Date();
  }

  public navigateToPos(): void {
    this.router.navigate(['/']);
  }

  public onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="%23475569" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
  }

  private showToast(msg: string): void {
    this.feedbackMsg.set(msg);
    setTimeout(() => this.feedbackMsg.set(null), 2500);
  }
}