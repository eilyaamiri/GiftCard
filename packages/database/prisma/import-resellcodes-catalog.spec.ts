import { describe, expect, it } from 'vitest';

import { faceValueFromName, planImport, type RawCatalog } from './import-resellcodes-catalog';

/*
 * The import decides what one card costs us (`costAmount`) and which card a
 * purchase reaches (`providerSku`). It must also never merge a ReSellCodes card
 * into an existing product: every id it plans carries its own prefix.
 */

function raw(overrides: Partial<RawCatalog> = {}): RawCatalog {
  return {
    categories: [{ data: [{ category_id: '12', name: 'Steam', image: 'https://img/steam.png' }] }],
    cards: {
      '12': [
        {
          offers: [
            { card_id: '99', name: 'Steam $10', price_usd: '9.7500', stock: 5 },
            { card_id: '100', name: 'Steam $20', price_usd: '19.5000', stock: 0 },
          ],
        },
      ],
    },
    brands: [],
    ...overrides,
  };
}

describe('planImport', () => {
  it('plans one product per category and one SKU per card, all under its own prefix', () => {
    const plan = planImport(raw());

    expect(plan.skipped).toEqual([]);
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0]).toMatchObject({
      id: 'rsc_p_12',
      slug: 'rsc-steam-12',
      title: 'Steam',
      imageUrl: 'https://img/steam.png',
    });
    expect(plan.skus.map((sku) => sku.skuId)).toEqual(['rsc_s_12_99', 'rsc_s_12_100']);
    expect(plan.skus.map((sku) => sku.providerSku)).toEqual(['12:99', '12:100']);
  });

  it('takes the cost from price_usd exactly, and the face value from the name', () => {
    const [ten] = planImport(raw()).skus;

    expect(ten?.costAmount.toString()).toBe('9.75');
    expect(ten?.faceValue.toString()).toBe('10');
    expect(ten?.currency).toBe('USD');
    expect(ten?.faceValueFromName).toBe(true);
  });

  it('keeps a decimal cost free of float artifacts', () => {
    const plan = planImport(
      raw({ cards: { '12': [{ offers: [{ card_id: '1', name: 'Steam $5', price_usd: '0.3000' }] }] } }),
    );
    expect(plan.skus[0]?.costAmount.toString()).toBe('0.3');
  });

  it('marks a card with no stock unavailable, and a missing stock figure available', () => {
    const plan = planImport(
      raw({
        cards: {
          '12': [
            {
              offers: [
                { card_id: '1', name: 'Steam $5', price_usd: '5.0000', stock: 0 },
                { card_id: '2', name: 'Steam $10', price_usd: '10.0000' },
              ],
            },
          ],
        },
      }),
    );
    expect(plan.skus.map((sku) => sku.availability)).toEqual(['UNAVAILABLE', 'AVAILABLE']);
  });

  it('skips and names a card without a usable price instead of guessing one', () => {
    const plan = planImport(
      raw({
        cards: {
          '12': [{ offers: [{ card_id: '1', name: 'x', price_usd: null }, { card_id: '2', name: 'Steam $1', price_usd: '1.0000' }] }],
        },
      }),
    );
    expect(plan.skus.map((sku) => sku.skuId)).toEqual(['rsc_s_12_2']);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toContain('12:1');
  });

  it('falls back to the cost as face value and flags the product when the name states none', () => {
    const plan = planImport(
      raw({ cards: { '12': [{ offers: [{ card_id: '7', name: 'Steam Wallet Code', price_usd: '4.2000' }] }] } }),
    );
    expect(plan.skus[0]?.faceValue.toString()).toBe('4.2');
    expect(plan.skus[0]?.faceValueFromName).toBe(false);
    expect(plan.products[0]?.needsReview).toBe(true);
  });

  it('skips a second card that reads as the same face value (unique per product)', () => {
    const plan = planImport(
      raw({
        cards: {
          '12': [
            {
              offers: [
                { card_id: '1', name: 'Steam $10', price_usd: '9.7500' },
                { card_id: '2', name: 'Steam 10 USD', price_usd: '9.8000' },
              ],
            },
          ],
        },
      }),
    );
    expect(plan.skus).toHaveLength(1);
    expect(plan.skipped[0]).toContain('same face value');
  });

  it('drops a category with no usable card, and reads the region from /gift-cards/brands', () => {
    const plan = planImport(
      raw({
        categories: [{ data: [{ category_id: '12', name: 'Steam US' }, { category_id: '13', name: 'Empty' }] }],
        brands: [{ data: [{ brand: 'Steam', subcategories: [{ category_id: '12', region: 'us' }] }] }],
      }),
    );
    expect(plan.products.map((product) => product.id)).toEqual(['rsc_p_12']);
    expect(plan.skus[0]?.region).toBe('US');
    expect(plan.skipped).toContain('13 "Empty": no usable card');
  });

  it('refuses a non-https image', () => {
    const plan = planImport(raw({ categories: [{ data: [{ category_id: '12', name: 'Steam', image: 'javascript:alert(1)' }] }] }));
    expect(plan.products[0]?.imageUrl).toBeNull();
    expect(plan.products[0]?.needsReview).toBe(true);
  });

  it('makes venue ids safe for our ids and SKU codes', () => {
    const plan = planImport(
      raw({
        categories: [{ data: [{ category_id: 'a/b c', name: 'Odd' }] }],
        cards: { 'a/b c': [{ offers: [{ card_id: 'x.1', name: '$5', price_usd: '5.0000' }] }] },
      }),
    );
    expect(plan.skus[0]?.skuId).toBe('rsc_s_a_b_c_x_1');
    expect(plan.skus[0]?.code).toBe('RSC-a_b_c-x_1');
    expect(plan.skus[0]?.providerSku).toBe('a/b c:x.1');
  });
});

describe('faceValueFromName', () => {
  it.each([
    ['Steam $10', '10', 'USD'],
    ['Steam 10$', '10', 'USD'],
    ['Google Play €25', '25', 'EUR'],
    ['PSN 50 GBP', '50', 'GBP'],
    ['Netflix TRY 200', '200', 'TRY'],
    ['Amazon 12.50 usd', '12.5', 'USD'],
  ])('%s -> %s %s', (name, amount, currency) => {
    const result = faceValueFromName(name);
    expect(result?.amount.toString()).toBe(amount);
    expect(result?.currency).toBe(currency);
  });

  it('returns null for a name with no value, or with two different ones', () => {
    expect(faceValueFromName('Steam Wallet')).toBeNull();
    expect(faceValueFromName('Bundle $10 + $20')).toBeNull();
  });
});
