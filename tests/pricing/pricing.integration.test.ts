import { describe, expect, it } from 'vitest';
import Decimal from '../../apps/api/node_modules/decimal.js';

import { computeQuote } from '../../apps/api/src/modules/pricing/pricing.service';
import type {
  FxRateSnapshot,
  PricingRule,
  PricingInput,
} from '../../apps/api/src/modules/pricing/pricing.types';

const rule: PricingRule = {
  id: 'integration-rule',
  name: 'Integration rule',
  version: 1,
  fxSpreadBps: 150,
  fxRiskBufferBps: 100,
  serviceFeeBps: 200,
  serviceFeeFixedIrr: 0n,
  operationalFeeIrr: 0n,
  targetMarginBps: 300,
  minimumMarginIrr: 0n,
  paymentFeeBps: 100,
  paymentFeeFixedIrr: 0n,
  quoteTtlSeconds: 600,
  roundingStepIrr: 10_000n,
  maxSupplierCostToleranceBps: 500,
};

const fx: FxRateSnapshot = {
  id: 'integration-fx',
  pair: 'USD_IRR',
  buyRate: '1920000',
  sellRate: '1920000',
  midRate: '1920000',
  provider: 'mock',
  source: 'API',
  receivedAt: '2026-01-01T00:00:00.000Z',
  effectiveAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  isManualOverride: false,
  overrideReason: null,
  ageSeconds: 1,
  isStale: false,
};

describe('pricing integration contract', () => {
  it('computes an auditable IRR total using the real pricing engine', () => {
    const result = computeQuote(
      { supplierCostUsd: new Decimal('25'), quantity: 1 } satisfies PricingInput,
      rule,
      fx,
    );
    expect(result.finalAmountIrr % 10n).toBe(0n);
    expect(result.finalAmountIrr).toBeGreaterThan(result.supplierCostIrr);
    expect(result.components.map((line) => line.kind)).toEqual([
      'SUPPLIER_COST',
      'FX_SPREAD',
      'FX_RISK_BUFFER',
      'PAYMENT_FEE',
      'SERVICE_FEE',
      'OPERATIONAL_FEE',
      'MARGIN',
      'DISCOUNT',
      'ROUNDING',
    ]);
  });

  it('is deterministic for repeated identical inputs', () => {
    const input = { supplierCostUsd: new Decimal('10.50'), quantity: 2 };
    expect(computeQuote(input, rule, fx)).toEqual(computeQuote(input, rule, fx));
  });
});
