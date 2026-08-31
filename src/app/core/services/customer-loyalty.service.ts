import { Injectable, signal } from '@angular/core';
import { marketDb } from '../db/market-db';
import { Customer } from '../models/market.models';

@Injectable({ providedIn: 'root' })
export class CustomerLoyaltyService {
  public activeCustomer = signal<Customer | null>(null);
  public pointDiscountValue = 0.05; // 1 Point = €0.05 (100 points = €5.00 discount)
  public pointsPerEuro = 1;         // 1 Euro spent = 1 Point earned

  /**
   * Search customers by phone, AFM (Tax ID), or Name
   */
  public async searchCustomers(query: string): Promise<Customer[]> {
    const clean = query.trim().toLowerCase();
    if (!clean) return [];

    const all = await marketDb.customers.toArray();
    return all
      .filter(c => 
        (c.phone && c.phone.includes(clean)) ||
        (c.afm && c.afm.includes(clean)) ||
        (c.name && c.name.toLowerCase().includes(clean))
      )
      .slice(0, 8);
  }

  /**
   * Quick search backward compatibility
   */
  public async searchByPhone(query: string): Promise<Customer[]> {
    return this.searchCustomers(query);
  }

  /**
   * Register or fetch an existing customer on the fly
   */
  public async quickRegisterCustomer(
    phone: string, 
    name: string, 
    afm?: string
  ): Promise<Customer> {
    const cleanPhone = phone.trim();
    const cleanAfm = afm ? afm.trim() : undefined;

    if (cleanPhone) {
      const existing = await marketDb.customers.where('phone').equals(cleanPhone).first();
      if (existing) {
        this.activeCustomer.set(existing);
        return existing;
      }
    }

    if (cleanAfm) {
      const existingByAfm = await marketDb.customers.where('afm').equals(cleanAfm).first();
      if (existingByAfm) {
        this.activeCustomer.set(existingByAfm);
        return existingByAfm;
      }
    }

    const newCustomer: Customer = {
      id: `CUST-${Date.now().toString(36).toUpperCase()}`,
      phone: cleanPhone,
      afm: cleanAfm || '',
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
    const validAmount = Number(amount) || 0;
    return Math.floor(validAmount * this.pointsPerEuro);
  }

  /**
   * Convert points to cash discount equivalent
   */
  public convertPointsToDiscount(points: number): number {
    const validPoints = Math.max(0, Number(points) || 0);
    return Number((validPoints * this.pointDiscountValue).toFixed(2));
  }

  /**
   * Deduct or add points after checkout and update customer stats in Dexie
   */
  public async processPostSale(
    customer: Customer,
    grandTotal: number,
    pointsRedeemed: number = 0
  ): Promise<{ pointsEarned: number; newBalance: number }> {
    const validTotal = Number(grandTotal) || 0;
    const pointsEarned = this.calculatePointsEarned(validTotal);
    const validRedeemed = Math.min(customer.loyaltyPoints || 0, Math.max(0, pointsRedeemed));
    const newBalance = Math.max(0, (customer.loyaltyPoints || 0) - validRedeemed + pointsEarned);

    const updatedCustomer: Customer = {
      ...customer,
      loyaltyPoints: newBalance,
      totalSpent: Number(((customer.totalSpent || 0) + validTotal).toFixed(2)),
      totalVisits: (customer.totalVisits || 0) + 1,
      lastVisit: new Date().toISOString()
    };

    await marketDb.customers.put(updatedCustomer);
    this.activeCustomer.set(null); // Reset after successful sale

    return { pointsEarned, newBalance };
  }

  public selectCustomer(customer: Customer): void {
    this.activeCustomer.set(customer);
  }

  public clearActiveCustomer(): void {
    this.activeCustomer.set(null);
  }
}