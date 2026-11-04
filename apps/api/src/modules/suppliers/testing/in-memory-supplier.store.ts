import Decimal from 'decimal.js';
import type { SupplierAvailability } from '@barat/suppliers';

import type {
  AutoFulfillmentTarget,
  PendingPurchaseRecord,
  SupplierOfferView,
  SupplierPurchaseAttemptRecord,
  SupplierPurchaseAttemptStatus,
  SupplierStore,
  SupplierView,
} from '../suppliers.types';

type SupplierRow = Omit<SupplierView, 'hasProvider'>;

export interface SeedSupplierStore {
  readonly suppliers?: readonly SupplierRow[];
  readonly offers?: readonly SupplierOfferView[];
  readonly targets?: readonly AutoFulfillmentTarget[];
  /** Order ids that still carry an open UNKNOWN / PENDING purchase task. */
  readonly ambiguousOrderIds?: readonly string[];
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
  readonly targets: AutoFulfillmentTarget[];
  readonly availabilityChecks: { offerId: string; availability: SupplierAvailability }[] = [];
  readonly ambiguousOrderIds: Set<string>;
  readonly purchaseAttempts: SupplierPurchaseAttemptRecord[] = [];

  constructor(seed: SeedSupplierStore = {}) {
    this.suppliers = [...(seed.suppliers ?? [])];
    this.offers = [...(seed.offers ?? [])];
    this.targets = [...(seed.targets ?? [])];
    this.ambiguousOrderIds = new Set(seed.ambiguousOrderIds ?? []);
  }

  async findAutoFulfillmentTarget(workItemId: string): Promise<AutoFulfillmentTarget | null> {
    return this.targets.find((target) => target.workItemId === workItemId) ?? null;
  }

  async hasOpenPurchaseAmbiguity(orderId: string): Promise<boolean> {
    return this.ambiguousOrderIds.has(orderId);
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

  async latestPurchaseAttempt(orderId: string): Promise<SupplierPurchaseAttemptRecord | null> {
    const mine = this.purchaseAttempts.filter((attempt) => attempt.orderId === orderId);
    return mine.sort((a, b) => b.generation - a.generation)[0] ?? null;
  }

  /** Mirrors the two unique indexes: one unsettled attempt per order, one row per generation. */
  async openPurchaseAttempt(input: {
    orderId: string;
    supplierId: string;
    offerId: string;
    idempotencyKey: string;
    generation: number;
    requestedByStaffId: string | null;
  }): Promise<SupplierPurchaseAttemptRecord | null> {
    const clash = this.purchaseAttempts.some(
      (attempt) =>
        attempt.orderId === input.orderId &&
        (attempt.generation === input.generation || attempt.status === 'IN_FLIGHT' || attempt.status === 'UNKNOWN'),
    );
    if (clash || this.purchaseAttempts.some((attempt) => attempt.idempotencyKey === input.idempotencyKey)) {
      return null;
    }
    const record: SupplierPurchaseAttemptRecord = {
      id: `attempt-${this.purchaseAttempts.length + 1}`,
      orderId: input.orderId,
      supplierId: input.supplierId,
      offerId: input.offerId,
      idempotencyKey: input.idempotencyKey,
      generation: input.generation,
      status: 'IN_FLIGHT',
      providerReference: null,
      errorCode: null,
      requestedByStaffId: input.requestedByStaffId,
      startedAt: new Date(),
      settledAt: null,
    };
    this.purchaseAttempts.push(record);
    return record;
  }

  async settlePurchaseAttempt(input: {
    id: string;
    status: SupplierPurchaseAttemptStatus;
    providerReference?: string | null;
    errorCode?: string | null;
  }): Promise<void> {
    const index = this.purchaseAttempts.findIndex((attempt) => attempt.id === input.id);
    const existing = this.purchaseAttempts[index];
    if (existing === undefined) throw new Error(`No purchase attempt ${input.id}`);
    this.purchaseAttempts[index] = {
      ...existing,
      status: input.status,
      ...(input.providerReference === undefined ? {} : { providerReference: input.providerReference }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.status === 'SUCCEEDED' || input.status === 'FAILED' ? { settledAt: new Date() } : {}),
    };
  }

  async listPendingPurchases(input: { since: Date; limit: number }): Promise<readonly PendingPurchaseRecord[]> {
    const pending: PendingPurchaseRecord[] = [];
    for (const attempt of [...this.purchaseAttempts].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())) {
      const target = this.targets.find((candidate) => candidate.orderId === attempt.orderId);
      if (
        attempt.status !== 'IN_FLIGHT' ||
        attempt.providerReference === null ||
        attempt.offerId === null ||
        attempt.startedAt < input.since ||
        target === undefined
      ) {
        continue;
      }
      pending.push({
        attemptId: attempt.id,
        orderId: attempt.orderId,
        customerId: target.customerId,
        offerId: attempt.offerId,
        workItemId: target.workItemId,
        idempotencyKey: attempt.idempotencyKey,
        providerReference: attempt.providerReference,
        startedAt: attempt.startedAt,
      });
    }
    return pending.slice(0, input.limit);
  }

  /** Order status by id, seeded from the targets; moves only from a listed status. */
  readonly orderStatuses = new Map<string, string>();

  orderStatusOf(orderId: string): string | undefined {
    return (
      this.orderStatuses.get(orderId) ?? this.targets.find((target) => target.orderId === orderId)?.orderStatus
    );
  }

  async transitionOrder(input: { orderId: string; from: readonly string[]; to: string }): Promise<boolean> {
    const current = this.orderStatusOf(input.orderId);
    if (current === undefined || !input.from.includes(current)) {
      return false;
    }
    this.orderStatuses.set(input.orderId, input.to);
    return true;
  }
}
