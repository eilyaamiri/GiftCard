import { describe, expect, it } from 'vitest';

import { planImport, type ReloadlyProduct } from './import-reloadly-catalog';

/*
 * The import decides two things that cost money: what one card costs us
 * (`costAmount`, in the supplier's currency) and which product a purchase will
 * actually reach (`providerSku`). Everything else it writes is a label.
 *
 * Reloadly quotes prices as JSON numbers, so the tests below are written
 * against the values that break naive arithmetic — a 0.1 + 0.2 pair, a price
 * that is not the denomination times the rate, an encoder artifact — rather
 * than against round dollars that would pass either way.
 */

/** An ACTIVE fixed-denomination product, priced in the sender's currency. */
function product(overrides: Partial<ReloadlyProduct> = {}): ReloadlyProduct {
  return {
    productId: 14971,
    productName: 'Google Play Italy',
    status: 'ACTIVE',
    denominationType: 'FIXED',
    recipientCurrencyCode: 'EUR',
    senderCurrencyCode: 'USD',
    fixedRecipientDenominations: [25],
    fixedRecipientToSenderDenominationsMap: { '25': 30.426375 },
    recipientCurrencyToSenderCurrencyExchangeRate: 1.217055,
    discountPercentage: 0,
    brand: { brandName: 'Google play' },
    category: { name: 'Entertainment' },
    country: { isoName: 'IT', name: 'Italy' },
    ...overrides,
  };
}

function onlySku(overrides: Partial<ReloadlyProduct> = {}) {
  const plan = planImport([product(overrides)]);
  expect(plan.skipped).toEqual([]);
  const sku = plan.skus[0];
  if (sku === undefined) {
    throw new Error('the product produced no SKU');
  }
  return sku;
}

describe('cost', () => {
  it("takes Reloadly's own sender price, not the exchange rate", () => {
    // The two disagree by a cent per card: the map is what Reloadly bills.
    const sku = onlySku({
      fixedRecipientToSenderDenominationsMap: { '25': 30.44 },
      recipientCurrencyToSenderCurrencyExchangeRate: 1.217055,
    });

    expect(sku.costAmount.toString()).toBe('30.44');
    expect(sku.costCurrency).toBe('USD');
  });

  it('matches the map entry by value, not by how it is spelled', () => {
    // Reloadly keys the map inconsistently: `25`, `25.0`, `25.00` all occur.
    const sku = onlySku({
      fixedRecipientDenominations: [25],
      fixedRecipientToSenderDenominationsMap: { '25.00': 30.44 },
    });

    expect(sku.costAmount.toString()).toBe('30.44');
  });

  it('falls back to the exchange rate only when the map has no entry', () => {
    const sku = onlySku({
      denominationType: 'RANGE',
      fixedRecipientDenominations: null,
      fixedRecipientToSenderDenominationsMap: null,
      minRecipientDenomination: 5,
      recipientCurrencyToSenderCurrencyExchangeRate: 1.217055,
    });

    expect(sku.costAmount.toString()).toBe('6.085275');
  });

  it('multiplies the rate exactly, without float error', () => {
    const sku = onlySku({
      denominationType: 'RANGE',
      fixedRecipientDenominations: null,
      fixedRecipientToSenderDenominationsMap: null,
      minRecipientDenomination: 0.1,
      recipientCurrencyToSenderCurrencyExchangeRate: 0.2,
    });

    // 0.1 * 0.2 is 0.020000000000000004 in JS. Decimal makes it 0.02.
    expect(sku.costAmount.toString()).toBe('0.02');
  });

  it("rounds the artifact out of Reloadly's own price", () => {
    // Reloadly computes the sender price server-side and ships the float it
    // gets: 25 * 1.217055 arrives as 30.426374999999997.
    const sku = onlySku({ fixedRecipientToSenderDenominationsMap: { '25': 30.426374999999997 } });

    expect(sku.costAmount.toString()).toBe('30.426375');
  });

  it('skips a product it cannot price rather than inventing a cost', () => {
    const plan = planImport([
      product({
        denominationType: 'RANGE',
        fixedRecipientDenominations: null,
        fixedRecipientToSenderDenominationsMap: null,
        minRecipientDenomination: 5,
        recipientCurrencyToSenderCurrencyExchangeRate: null,
      }),
    ]);

    expect(plan.skus).toEqual([]);
    expect(plan.skipped[0]).toContain('exchange rate');
  });

  it('records the discount as basis points, separate from the cost', () => {
    const sku = onlySku({ discountPercentage: 7.55 });

    // AGENTS.md rule 13: an integer, never 0.0755. And the cost stays gross, so
    // what we pay and what we get back remain two auditable numbers.
    expect(sku.discountBps).toBe(755);
    expect(sku.costAmount.toString()).toBe('30.426375');
  });

  it('has no discount when Reloadly states none', () => {
    expect(onlySku({ discountPercentage: null }).discountBps).toBe(0);
  });
});

describe('provider SKU', () => {
  it('is the productId and the denomination the supplier knows', () => {
    expect(onlySku().providerSku).toBe('14971:25');
  });

  it('drops the encoder artifact from the denomination', () => {
    // A €25 card can arrive as 24.999999999999996. `24.999999999999996` is not
    // a price Reloadly will accept back, and it is not a face value either.
    const sku = onlySku({
      fixedRecipientDenominations: [24.999999999999996],
      fixedRecipientToSenderDenominationsMap: { '25': 30.44 },
    });

    expect(sku.providerSku).toBe('14971:25');
    expect(sku.faceValue.toString()).toBe('25');
    expect(sku.skuId).toBe('rlx_s_14971_25');
    // And the sender price still matches: the map is looked up by value.
    expect(sku.costAmount.toString()).toBe('30.44');
  });

  it('keeps a genuinely fractional denomination', () => {
    const sku = onlySku({
      fixedRecipientDenominations: [89.9],
      fixedRecipientToSenderDenominationsMap: { '89.9': 109.41 },
    });

    expect(sku.providerSku).toBe('14971:89.9');
    expect(sku.skuId).toBe('rlx_s_14971_89_9');
  });

  it('agrees with the SKU face value it is stored next to', () => {
    const plan = planImport([product({ fixedRecipientDenominations: [10, 25, 50] })]);

    for (const sku of plan.skus) {
      expect(sku.providerSku).toBe(`14971:${sku.faceValue.toString()}`);
    }
  });
});

describe('rows', () => {
  it('gives every denomination its own SKU under one product', () => {
    const plan = planImport([product({ fixedRecipientDenominations: [10, 25, 50] })]);

    expect(plan.products).toHaveLength(1);
    expect(plan.skus.map((sku) => sku.skuId)).toEqual([
      'rlx_s_14971_10',
      'rlx_s_14971_25',
      'rlx_s_14971_50',
    ]);
    expect(new Set(plan.skus.map((sku) => sku.productRowId))).toEqual(new Set(['rlx_p_14971']));
  });

  it('keeps one SKU when Reloadly lists a denomination twice', () => {
    // `@@unique([productId, region, faceValue, currency])` would reject both.
    const plan = planImport([product({ fixedRecipientDenominations: [25, 25.0, 50] })]);

    expect(plan.skus.map((sku) => sku.skuId)).toEqual(['rlx_s_14971_25', 'rlx_s_14971_50']);
  });

  it('gives a range product exactly one SKU, at its minimum', () => {
    // Picking a saleable amount out of a range is a pricing decision, and an
    // import is not where pricing decisions get made.
    const plan = planImport([
      product({
        denominationType: 'RANGE',
        fixedRecipientDenominations: null,
        fixedRecipientToSenderDenominationsMap: null,
        minRecipientDenomination: 5,
      }),
    ]);

    expect(plan.skus).toHaveLength(1);
    expect(plan.skus[0]?.faceValue.toString()).toBe('5');
  });

  it('plans a repeated product once', () => {
    // Reloadly lists a product under every country it sells in, and its paged
    // endpoint repeats rows across pages; a catalog read either way arrives
    // with duplicates in it.
    const plan = planImport([product(), product(), product({ productId: 5 })]);

    expect(plan.products.map((row) => row.id)).toEqual(['rlx_p_14971', 'rlx_p_5']);
    expect(plan.skus).toHaveLength(2);
  });

  it('gives each product a distinct slug even when the names collide', () => {
    const plan = planImport([
      product({ productId: 7, productName: 'Amazon' }),
      product({ productId: 8, productName: 'Amazon' }),
    ]);

    expect(plan.products.map((row) => row.slug)).toEqual(['amazon-7', 'amazon-8']);
  });

  it('carries the catalog through unchanged', () => {
    const plan = planImport([product()]);

    expect(plan.products[0]).toMatchObject({
      id: 'rlx_p_14971',
      brand: 'Google play',
      title: 'Google Play Italy',
      category: 'Entertainment',
    });
    expect(plan.skus[0]).toMatchObject({
      code: 'RLX-14971-25',
      region: 'IT',
      currency: 'EUR',
      denominationLabel: '25 EUR',
      availability: 'AVAILABLE',
    });
  });

  it('imports an inactive product, but marks the offer unavailable', () => {
    // Reloadly turns products off and on; the row is worth keeping either way.
    expect(onlySku({ status: 'INACTIVE' }).availability).toBe('UNAVAILABLE');
  });

  it('names what it skips instead of failing the whole catalog', () => {
    const plan = planImport([
      product({ productId: 1, recipientCurrencyCode: undefined }),
      product({ productId: 2, country: null }),
      product({ productId: 3, denominationType: 'FIXED', fixedRecipientDenominations: [] }),
      product({ productId: 4 }),
    ]);

    expect(plan.products.map((row) => row.id)).toEqual(['rlx_p_4']);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.skipped.join(' ')).toMatch(/currency.*country.*no usable denomination/su);
  });
});
