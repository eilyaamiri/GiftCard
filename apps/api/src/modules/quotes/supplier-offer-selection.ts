import Decimal from 'decimal.js';

import { BPS_DENOMINATOR } from '@barat/contracts';

/**
 * The subset of a `SupplierOffer` the selection rule needs.
 *
 * Deliberately structural: the selector is a pure function so the "which
 * supplier do we buy from" decision is unit-testable without a database, and so
 * supplier identity never leaks past this module boundary by accident.
 */
export interface SelectableOffer {
  readonly id: string;
  readonly supplierId: string;
  readonly costCurrency: string;
  /** Decimal string — never a JS float (AGENTS.md rule 2). */
  readonly costAmount: string;
  /** Supplier discount off the listed cost, in integer basis points. */
  readonly discountBps: number;
  readonly availability: string;
  readonly isActive: boolean;
  readonly priority: number;
  readonly supplierIsActive: boolean;
}

export interface OfferSelection<T extends SelectableOffer> {
  readonly offer: T;
  /** costAmount x (1 - discountBps / 10_000), as an exact decimal string. */
  readonly effectiveCost: string;
}

/** `costAmount` after the supplier's own discount. Exact decimal arithmetic. */
export function effectiveOfferCost(offer: SelectableOffer): Decimal {
  const gross = new Decimal(offer.costAmount);
  const retained = new Decimal(BPS_DENOMINATOR - offer.discountBps).div(BPS_DENOMINATOR);
  return gross.mul(retained);
}

/**
 * Pick the offer we should actually buy from.
 *
 * Rules, in order:
 *   1. Only active offers, marked AVAILABLE, from an active supplier.
 *   2. Only offers priced in the requested currency — the pricing engine takes a
 *      single FX pair, so silently mixing currencies would misprice the quote.
 *   3. Lowest effective cost wins.
 *   4. Ties break on `priority` (lower first), then on `id` so the choice is
 *      deterministic and a replay of the same inputs yields the same supplier.
 */
export function selectBestOffer<T extends SelectableOffer>(
  offers: readonly T[],
  currency: string,
): OfferSelection<T> | null {
  const candidates = offers.filter(
    (offer) =>
      offer.isActive &&
      offer.supplierIsActive &&
      offer.availability === 'AVAILABLE' &&
      offer.costCurrency === currency,
  );
  if (candidates.length === 0) {
    return null;
  }

  const [first, ...remaining] = candidates;
  if (first === undefined) {
    return null;
  }

  let best = first;
  let bestCost = effectiveOfferCost(best);

  for (const candidate of remaining) {
    const cost = effectiveOfferCost(candidate);
    const cheaper = cost.lt(bestCost);
    const tied = cost.eq(bestCost);
    if (
      cheaper ||
      (tied && candidate.priority < best.priority) ||
      (tied && candidate.priority === best.priority && candidate.id < best.id)
    ) {
      best = candidate;
      bestCost = cost;
    }
  }

  return { offer: best, effectiveCost: bestCost.toFixed(Math.min(bestCost.decimalPlaces(), 6)) };
}
