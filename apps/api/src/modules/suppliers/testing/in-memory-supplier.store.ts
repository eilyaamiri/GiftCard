import Decimal from 'decimal.js';
import type { SupplierAvailability } from '@barat/suppliers';

import type { SupplierOfferView, SupplierStore, SupplierView } from '../suppliers.types';

type SupplierRow = Omit<SupplierView, 'hasProvider'>;

export interface SeedSupplierStore {
  readonly suppliers?: readonly SupplierRow[];
  readonly offers?: readonly SupplierOfferView[];
}

/**
 * In-memory `SupplierStore` for the supplier orchestration tests.
 *
 * `findOffersForSku` reproduces the ordering the real query guarantees — cheapest
 * cost first, then `priority` as a deterministic tie-breaker — because offer
 * selection depends on it. The comparison uses decimal.js so even ordering never
 * converts a money value through a binary float (AGENTS.md rule 2).
 */
export class InMemorySupplierStore implements SupplierStore {
  readonly suppliers: SupplierRow[];
  readonly offers: SupplierOfferView[];
  readonly availabilityChecks: { offerId: string; availability: SupplierAvailability }[] = [];

  constructor(seed: SeedSupplierStore = {}) {
    this.suppliers = [...(seed.suppliers ?? [])];
    this.offers = [...(seed.offers ?? [])];
  }

  async listSuppliers(): Promise<readonly SupplierRow[]> {
    return this.suppliers;
  }

  async findSupplierByCode(code: string): Promise<SupplierRow | null> {
    return this.suppliers.find((supplier) => supplier.code === code) ?? null;
  }

  async findOffersForSku(skuId: string): Promise<readonly SupplierOfferView[]> {
    return this.offers
      .filter((offer) => offer.skuId === skuId && offer.isActive)
      .sort((a, b) => {
        const byCost = new Decimal(a.costAmount).comparedTo(new Decimal(b.costAmount));
        return byCost !== 0 ? byCost : a.priority - b.priority;
      });
  }

  async findOfferById(offerId: string): Promise<SupplierOfferView | null> {
    return this.offers.find((offer) => offer.id === offerId) ?? null;
  }

  async recordAvailabilityCheck(input: {
    offerId: string;
    availability: SupplierAvailability;
    checkedAt: Date;
  }): Promise<void> {
    this.availabilityChecks.push({ offerId: input.offerId, availability: input.availability });
    const index = this.offers.findIndex((offer) => offer.id === input.offerId);
    if (index >= 0) {
      const existing = this.offers[index];
      if (existing !== undefined) {
        this.offers[index] = {
          ...existing,
          availability: input.availability,
          lastCheckedAt: input.checkedAt,
        };
      }
    }
  }
}
