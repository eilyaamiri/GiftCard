import type {
  FxRateSnapshot,
  PricingBreakdown as WirePricingBreakdown,
  PricingRuleSnapshot,
} from '@barat/contracts';
import type { PrismaClient } from '@barat/database';

import type { PricingBreakdown, PricingInput, PricingRule } from '../pricing/pricing.types';

/* ============================================================================
 * Database port
 *
 * A narrow slice of the Prisma client. Quotes own `Quote` and `QuoteComponent`
 * and only read `CommerceSession`; anything else is somebody's else table.
 * ==========================================================================*/

export const QUOTES_DATABASE = Symbol('QUOTES_DATABASE');

export type QuotesDatabaseCore = Pick<PrismaClient, 'quote' | 'quoteComponent' | 'commerceSession'>;

export interface QuotesDatabase extends QuotesDatabaseCore {
  $transaction<T>(callback: (transaction: QuotesDatabaseCore) => Promise<T>): Promise<T>;
}

/* ============================================================================
 * Collaborator ports
 *
 * Quotes must never reach a concrete FX provider (AGENTS.md rule 6). It depends
 * on these interfaces; the composition root in `quotes.module.ts` binds them to
 * whatever the FX and pricing modules provide.
 * ==========================================================================*/

export const QUOTE_FX_AGGREGATOR = Symbol('QUOTE_FX_AGGREGATOR');
export interface QuoteFxAggregator {
  getRateSnapshot(pair: 'USD_IRR'): Promise<FxRateSnapshot>;
}

export const QUOTE_PRICING_SERVICE = Symbol('QUOTE_PRICING_SERVICE');
export interface QuotePricingService {
  computeQuote(input: PricingInput, rule: PricingRule, fx: FxRateSnapshot): PricingBreakdown;
  toWirePricingBreakdown(breakdown: PricingBreakdown): WirePricingBreakdown;
}

/** The engine rule, frozen into the quote so a later rule edit cannot alter it. */
export function ruleSnapshot(rule: PricingRule): PricingRuleSnapshot {
  return {
    id: rule.id,
    name: rule.name,
    version: rule.version,
    fxSpreadBps: rule.fxSpreadBps,
    fxRiskBufferBps: rule.fxRiskBufferBps,
    serviceFeeBps: rule.serviceFeeBps,
    serviceFeeFixedIrr:
      rule.serviceFeeFixedIrr.toString() as PricingRuleSnapshot['serviceFeeFixedIrr'],
    operationalFeeIrr:
      rule.operationalFeeIrr.toString() as PricingRuleSnapshot['operationalFeeIrr'],
    targetMarginBps: rule.targetMarginBps,
    minimumMarginIrr: rule.minimumMarginIrr.toString() as PricingRuleSnapshot['minimumMarginIrr'],
    paymentFeeBps: rule.paymentFeeBps,
    paymentFeeFixedIrr:
      rule.paymentFeeFixedIrr.toString() as PricingRuleSnapshot['paymentFeeFixedIrr'],
    quoteTtlSeconds: rule.quoteTtlSeconds,
    roundingStepIrr: rule.roundingStepIrr.toString() as PricingRuleSnapshot['roundingStepIrr'],
    maxSupplierCostToleranceBps: rule.maxSupplierCostToleranceBps,
  };
}
