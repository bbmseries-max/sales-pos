import { Injectable, signal } from '@angular/core';
import { marketDb } from '../db/market-db';
import { Customer } from '../models/market.models';

@Injectable({ providedIn: 'root' })
export class CustomerLoyaltyService {
  public activeCustomer = signal<Customer | null>(null);
  public pointDiscountValue = 0.05; // 1 Point = €0.05 (100 points = €5.00 discount)
  public pointsPerEuro = 1;         // 1 Euro spent = 1 Point earned

  /**
   * Search customers by phone (exact or partial match)
   */
  public async searchByPhone(query: string): Promise<Customer[]> {
    const clean = query.trim();
    if (!clean) return [];

    const all = await marketDb.customers.toArray();
    return all.filter(c => c.phone.includes(clean) || c.name.toLowerCase().includes(clean.toLowerCase())).slice(0, 8);
  }

  /**
   * Get or register a quick customer on the fly
   */
  public async quickRegisterCustomer(phone: string, name: string): Promise<Customer> {
    const cleanPhone = phone.trim();
    const existing = await marketDb.customers.where('phone').equals(cleanPhone).first();
    if (existing) {
      this.activeCustomer.set(existing);
      return existing;
    }

    const newCustomer: Customer = {
      id: 'CUST-' + Date.now().toString(36).toUpperCase(),
      phone: cleanPhone,
      name: name.trim() || 'Πελάτης Λιανικής',
      loyaltyPoints: 10, // 10 Welcome points
      totalSpent: 0,
      totalVisits: 0,
      createdAt: new Date().toISOString(),
      lastVisit: new Date().toISOString()
    };

    await marketDb.customers.add(newCustomer);
    this.activeCustomer.set(newCustomer);
    return newCustomer;
  }

  /**
   * Calculate point rewards for checkout amount
   */
  public calculatePointsEarned(amount: number): number {
    return Math.floor(amount * this.pointsPerEuro);
  }

  /**
   * Deduct or add points after checkout and update customer stats
   */
  public async processPostSale(
    customer: Customer,
    grandTotal: number,
    pointsRedeemed: number = 0
  ): Promise<{ pointsEarned: number; newBalance: number }> {
    const pointsEarned = this.calculatePointsEarned(grandTotal);
    const newBalance = Math.max(0, customer.loyaltyPoints - pointsRedeemed + pointsEarned);

    const updatedCustomer: Customer = {
      ...customer,
      loyaltyPoints: newBalance,
      totalSpent: Number((customer.totalSpent + grandTotal).toFixed(2)),
      totalVisits: customer.totalVisits + 1,
      lastVisit: new Date().toISOString()
    };

    await marketDb.customers.put(updatedCustomer);
    this.activeCustomer.set(null); // Reset active customer for next sale

    return { pointsEarned, newBalance };
  }

  public clearActiveCustomer(): void {
    this.activeCustomer.set(null);
  }
}