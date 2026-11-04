import { describe, expect, it } from 'vitest';

import { TOMAN_DIRECT_PRICING_BASIS, isTomanDirectSnapshot } from './pricing-basis';

describe('isTomanDirectSnapshot', () => {
  it('recognises a quote priced from a toman supplier', () => {
    expect(isTomanDirectSnapshot({ pricingBasis: TOMAN_DIRECT_PRICING_BASIS })).toBe(true);
  });

  it('treats every other snapshot as dollars, including old ones with no basis at all', () => {
    for (const snapshot of [{ pricingBasis: 'USD_CROSS_RATE' }, {}, { pricingBasis: 'x' }, null, undefined, 'SUPPLIER_TOMAN_DIRECT', [], 7]) {
      expect(isTomanDirectSnapshot(snapshot)).toBe(false);
    }
  });
});
