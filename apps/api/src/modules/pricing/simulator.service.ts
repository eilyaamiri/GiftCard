import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

import type {
  DecimalString,
  FxRateSnapshot,
  SimulateQuoteRequest,
  SimulateQuoteResponse,
} from '@barat/contracts';

import { PricingService } from './pricing.service';
import type { PricingInput, PricingRule } from './pricing.types';

/**
 * The admin Quote Simulator.
 *
 * It contains NO arithmetic. Every number it returns comes from
 * `PricingService.computeQuote` — the same method the customer quote endpoint
 * calls. A second copy of the formula here would be worse than no simulator at
 * all: finance would tune a rule against numbers the shop never charges.
 *
 * Its only real job is adaptation: wire strings -> Decimal/bigint, and an
 * explicit "what if the rate were X" FX snapshot when the admin is exploring a
 * hypothetical rate rather than the live one.
 */
@Injectable()
export class SimulatorService {
  /*
   * The token is named explicitly rather than left to `design:paramtypes`, for
   * the same reason PricingController does it: the engine dependency has to
   * survive an `import type` refactor. A type-only import would erase the
   * emitted metadata and Nest would inject `Object`, and the simulator would
   * fail at the first request instead of at build time.
   */
  constructor(@Inject(PricingService) private readonly pricingService: PricingService) {}

  simulate(
    request: SimulateQuoteRequest,
    suppliedFxSnapshot?: FxRateSnapshot,
  ): SimulateQuoteResponse {
    if (request.supplierCostCurrency !== 'USD') {
      throw new RangeError('Only USD supplier costs are supported by this pricing engine');
    }

    const fx = suppliedFxSnapshot ?? buildSimulatorFxSnapshot(request.marketFxRate);
    const input: PricingInput = {
      supplierCostUsd: new Decimal(request.supplierCostForeign),
      quantity: request.quantity,
      ...(request.discountIrr === undefined
        ? {}
        : { discountIrr: BigInt(request.discountIrr) }),
    };
    const rule = contractRuleToEngineRule(request.rule);
    const breakdown = this.pricingService.computeQuote(input, rule, fx);

    return {
      breakdown: this.pricingService.toWirePricingBreakdown(breakdown),
      fx,
    };
  }
}

/** Wire rule snapshot -> engine rule. IRR strings become bigint exactly here. */
export function contractRuleToEngineRule(rule: SimulateQuoteRequest['rule']): PricingRule {
  return Object.freeze({
    id: rule.id,
    name: rule.name,
    version: rule.version,
    fxSpreadBps: rule.fxSpreadBps,
    fxRiskBufferBps: rule.fxRiskBufferBps,
    serviceFeeBps: rule.serviceFeeBps,
    serviceFeeFixedIrr: BigInt(rule.serviceFeeFixedIrr),
    operationalFeeIrr: BigInt(rule.operationalFeeIrr),
    targetMarginBps: rule.targetMarginBps,
    minimumMarginIrr: BigInt(rule.minimumMarginIrr),
    paymentFeeBps: rule.paymentFeeBps,
    paymentFeeFixedIrr: BigInt(rule.paymentFeeFixedIrr),
    quoteTtlSeconds: rule.quoteTtlSeconds,
    roundingStepIrr: BigInt(rule.roundingStepIrr),
    maxSupplierCostToleranceBps: rule.maxSupplierCostToleranceBps,
  });
}

/**
 * A hypothetical rate the admin typed in.
 *
 * Marked `isManualOverride` and attributed to `admin-simulator` so that if one
 * of these snapshots ever appears attached to a real quote it is immediately
 * identifiable as a simulation artefact rather than an observed market rate.
 * `isStale: false` is correct: the value is not an aged observation, it is an
 * input the operator supplied in this request.
 */
function buildSimulatorFxSnapshot(marketFxRate: DecimalString): FxRateSnapshot {
  const now = new Date().toISOString();

  return {
    id: null,
    pair: 'USD_IRR',
    buyRate: marketFxRate,
    sellRate: marketFxRate,
    midRate: marketFxRate,
    provider: 'admin-simulator',
    source: 'MANUAL',
    receivedAt: now,
    effectiveAt: now,
    expiresAt: null,
    isManualOverride: true,
    overrideReason: 'Admin quote simulation input',
    ageSeconds: 0,
    isStale: false,
  };
}
