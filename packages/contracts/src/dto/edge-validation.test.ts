import { describe, expect, it } from 'vitest';

import { createPaymentRequestSchema, verifyPaymentRequestSchema } from './payment';
import { simulateQuoteRequestSchema } from './pricing';
import {
  createQuoteRequestSchema,
  QUOTE_FIELD_KEY_MAX_LENGTH,
  QUOTE_FIELD_MAP_MAX_KEYS,
  QUOTE_FIELD_VALUE_MAX_LENGTH,
} from './quote';

/**
 * Edge validation tightened by the security review: each case here used to be
 * accepted by the contract and left to a service (or to nobody) to refuse.
 */

const KEY = 'k'.repeat(24);

describe('createPaymentRequestSchema.returnPath', () => {
  const parse = (returnPath: string) =>
    createPaymentRequestSchema.safeParse({ orderId: 'order_1', idempotencyKey: KEY, returnPath });

  it('accepts a site-relative path', () => {
    expect(parse('/orders/BP-1?tab=receipt').success).toBe(true);
  });

  it('refuses a protocol-relative URL that would leave the site', () => {
    expect(parse('//evil.example/phish').success).toBe(false);
    expect(parse('//').success).toBe(false);
  });

  it('refuses an absolute URL and a backslash trick', () => {
    expect(parse('https://evil.example').success).toBe(false);
    expect(parse('/\\evil.example').success).toBe(false);
  });
});

describe('verifyPaymentRequestSchema.provider', () => {
  it('caps the provider name', () => {
    const base = { idempotencyKey: KEY, paymentId: 'pay_1' };
    expect(verifyPaymentRequestSchema.safeParse({ ...base, provider: 'zarinpal' }).success).toBe(true);
    expect(verifyPaymentRequestSchema.safeParse({ ...base, provider: 'x'.repeat(33) }).success).toBe(false);
  });
});

describe('createQuoteRequestSchema', () => {
  it('has no currency default, so the catalog decides', () => {
    const result = createQuoteRequestSchema.safeParse({ skuId: 'sku_gbp' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.currency).toBeUndefined();
  });

  it('refuses a zero requested amount at the edge', () => {
    expect(createQuoteRequestSchema.safeParse({ serviceId: 's', requestedAmountForeign: '0' }).success).toBe(false);
    expect(createQuoteRequestSchema.safeParse({ serviceId: 's', requestedAmountForeign: '0.00' }).success).toBe(false);
    expect(createQuoteRequestSchema.safeParse({ serviceId: 's', requestedAmountForeign: '12.5' }).success).toBe(true);
  });

  it('bounds the free-form field maps', () => {
    const fields = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, 'v']));
    const parse = (serviceFields: Record<string, string>) =>
      createQuoteRequestSchema.safeParse({ serviceId: 's', serviceFields }).success;

    expect(parse(fields(QUOTE_FIELD_MAP_MAX_KEYS))).toBe(true);
    expect(parse(fields(QUOTE_FIELD_MAP_MAX_KEYS + 1))).toBe(false);
    expect(parse({ ['k'.repeat(QUOTE_FIELD_KEY_MAX_LENGTH)]: 'v' })).toBe(true);
    expect(parse({ ['k'.repeat(QUOTE_FIELD_KEY_MAX_LENGTH + 1)]: 'v' })).toBe(false);
    expect(parse({ note: 'v'.repeat(QUOTE_FIELD_VALUE_MAX_LENGTH) })).toBe(true);
    expect(parse({ note: 'v'.repeat(QUOTE_FIELD_VALUE_MAX_LENGTH + 1) })).toBe(false);
  });

  it('applies the same bounds to top-up account fields', () => {
    expect(
      createQuoteRequestSchema.safeParse({
        topUpOfferId: 'o',
        topUpAccountFields: { player_id: 'p'.repeat(QUOTE_FIELD_VALUE_MAX_LENGTH + 1) },
      }).success,
    ).toBe(false);
  });
});

describe('simulateQuoteRequestSchema.customerForeignAmount', () => {
  const base = {
    skuId: null,
    serviceId: null,
    supplierOfferId: null,
    quantity: 1,
    supplierCostForeign: '96.50',
    supplierCostCurrency: 'USD',
    marketFxRate: '1920000',
    rule: {
      id: 'rule',
      name: 'rule',
      version: 1,
      fxSpreadBps: 0,
      fxRiskBufferBps: 0,
      serviceFeeBps: 0,
      serviceFeeFixedIrr: '0',
      operationalFeeIrr: '0',
      targetMarginBps: 0,
      minimumMarginIrr: '0',
      paymentFeeBps: 0,
      paymentFeeFixedIrr: '0',
      quoteTtlSeconds: 600,
      roundingStepIrr: '10000',
      maxSupplierCostToleranceBps: 0,
    },
  };

  it('is optional and must be greater than zero when given', () => {
    expect(simulateQuoteRequestSchema.safeParse(base).success).toBe(true);
    expect(simulateQuoteRequestSchema.safeParse({ ...base, customerForeignAmount: '100' }).success).toBe(true);
    expect(simulateQuoteRequestSchema.safeParse({ ...base, customerForeignAmount: '0' }).success).toBe(false);
  });
});
