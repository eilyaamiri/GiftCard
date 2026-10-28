import { describe, expect, it } from 'vitest';

import { faceValueFromName, planImport, topUpReason, type RawCatalog } from './import-resellcodes-catalog';

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

  /*
   * The venue's `region` field also carries currency codes and a product's own
   * word. `Sku.region` is served as 2–8 characters, and "CONQUEROR" (9) made the
   * admin catalog and the offers list fail to load.
   */
  describe('region', () => {
    const regionOfCategory = (region: string) =>
      planImport(raw({ categories: [{ data: [{ category_id: '12', name: 'Steam', image: 'https://img/steam.png', region }] }] }));

    it.each(['US', 'gb', 'EU', 'global', 'CIS'])('reads %s as a region', (region) => {
      const plan = regionOfCategory(region);

      expect(plan.skus[0]?.region).toBe(region.toUpperCase());
      expect(plan.products[0]?.needsReview).toBe(false);
    });

    it.each([
      ['USD', 'USD'],
      ['robux', 'ROBUX'],
      ['BRL', 'BRL'],
      ['CONQUEROR', 'CONQUERO'],
      ['MINECOINS', 'MINECOIN'],
    ])('keeps what the venue wrote for %s (as %s) so a reviewer can see it, and holds the product', (written, stored) => {
      const plan = regionOfCategory(written);

      expect(plan.skus.every((sku) => sku.region === stored)).toBe(true);
      // Not a region we can read, so not an answer: the card may be locked to a country.
      expect(plan.products[0]?.needsReview).toBe(true);
    });

    it('falls back to GLOBAL, held for review, when the venue wrote something that is not letters', () => {
      const plan = regionOfCategory('12-34');

      expect(plan.skus.every((sku) => sku.region === 'GLOBAL')).toBe(true);
      expect(plan.products[0]?.needsReview).toBe(true);
    });

    it('keeps every region it stores within what the API serves', () => {
      for (const region of ['CONQUEROR', 'MINECOINS', 'ABCDEFGHIJKL', 'U', 'US']) {
        for (const sku of regionOfCategory(region).skus) {
          expect(sku.region.length).toBeGreaterThanOrEqual(2);
          expect(sku.region.length).toBeLessThanOrEqual(8);
        }
      }
    });

    it('does not hold a category for review when the brands feed supplies the region instead', () => {
      const plan = planImport(
        raw({
          categories: [{ data: [{ category_id: '12', name: 'Steam', image: 'https://img/steam.png', region: 'ROBUX' }] }],
          brands: [{ data: [{ brand: 'Steam', subcategories: [{ category_id: '12', region: 'us' }] }] }],
        }),
      );

      expect(plan.skus[0]?.region).toBe('US');
      expect(plan.products[0]?.needsReview).toBe(false);
    });
  });

  it('makes the venue\'s relative picture path absolute on the venue host, and nothing else', () => {
    const relative = planImport(raw({ categories: [{ data: [{ category_id: '12', name: 'Steam', image: '/api/media/steam.png' }] }] }));
    expect(relative.products[0]?.imageUrl).toBe('https://resell.codes/api/media/steam.png');

    const protocolRelative = planImport(raw({ categories: [{ data: [{ category_id: '12', name: 'Steam', image: '//evil.example/x.png' }] }] }));
    expect(protocolRelative.products[0]?.imageUrl).toBeNull();
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

  /*
   * `idSchema` is max(64). A SKU id built from two UUID-length venue ids is
   * about 80 characters, and one such row made the admin catalog and the offers
   * list fail to load for everyone.
   */
  describe('ids the API can serve', () => {
    const uuid = (n: number): string => `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-dddddddddddd`;
    const long = (): ReturnType<typeof planImport> =>
      planImport(
        raw({
          categories: [{ data: [{ category_id: uuid(1), name: 'Long' }] }],
          cards: {
            [uuid(1)]: [
              {
                offers: [
                  { card_id: uuid(2), name: '$5', price_usd: '5.0000' },
                  { card_id: uuid(3), name: '$10', price_usd: '10.0000' },
                ],
              },
            ],
          },
        }),
      );

    it('keeps every product id, SKU id and SKU code within 64 characters', () => {
      const plan = long();

      expect(plan.skus).toHaveLength(2);
      for (const value of [plan.products[0]?.id, ...plan.skus.flatMap((sku) => [sku.skuId, sku.code])]) {
        expect(value?.length).toBeLessThanOrEqual(64);
      }
    });

    it('still gives every card its own id, under its own prefix', () => {
      const plan = long();

      expect(new Set(plan.skus.map((sku) => sku.skuId)).size).toBe(2);
      expect(new Set(plan.skus.map((sku) => sku.code)).size).toBe(2);
      expect(plan.skus.every((sku) => sku.skuId.startsWith('rsc_s_'))).toBe(true);
      expect(plan.skus.every((sku) => sku.code.startsWith('RSC-'))).toBe(true);
    });

    it('derives the same ids on every run, so a re-run finds the rows it wrote', () => {
      expect(long().skus.map((sku) => sku.skuId)).toEqual(long().skus.map((sku) => sku.skuId));
    });

    it('leaves the real venue ids that were already short exactly as they were', () => {
      const plan = planImport(raw());

      expect(plan.skus.map((sku) => sku.skuId)).toEqual(['rsc_s_12_99', 'rsc_s_12_100']);
    });
  });
});

describe('game currency is left out of gift cards', () => {
  const mixed = raw({
    categories: [
      {
        data: [
          { category_id: '12', name: 'Steam' },
          { category_id: '40', name: 'League of Legends EU' },
          { category_id: '41', name: 'Some Game' },
        ],
      },
    ],
    cards: {
      '12': [{ offers: [{ card_id: '1', name: 'Steam $10', price_usd: '9.7500' }] }],
      '40': [{ offers: [{ card_id: '1', name: '11000 RP', price_usd: '80.0000' }] }],
      '41': [
        {
          offers: [
            { card_id: '1', name: '100 Diamonds', price_usd: '1.0000' },
            { card_id: '2', name: '500 Diamonds', price_usd: '5.0000' },
          ],
        },
      ],
    },
  });

  it('plans no product, SKU or map entry for a game-currency category, and lists it with a reason', () => {
    const plan = planImport(mixed);

    expect(plan.products.map((product) => product.id)).toEqual(['rsc_p_12']);
    expect(plan.skus.map((sku) => sku.skuId)).toEqual(['rsc_s_12_1']);
    expect(plan.topUps.map((row) => [row.categoryId, row.productId, row.cards])).toEqual([
      ['40', 'rsc_p_40', 1],
      ['41', 'rsc_p_41', 2],
    ]);
    expect(plan.topUps[0]?.reason).toBe('game-currency brand "League of Legends"');
    expect(plan.topUps[1]?.reason).toBe('2/2 cards named by a currency unit');
  });

  it('keeps a category as a gift card when told to', () => {
    const plan = planImport(mixed, { keepAsGiftCard: new Set(['41']) });
    expect(plan.products.map((product) => product.id)).toEqual(['rsc_p_12', 'rsc_p_41']);
    expect(plan.topUps.map((row) => row.categoryId)).toEqual(['40']);
  });

  it.each([
    ['Steam', ['Steam $10', 'Steam $20']],
    ['Razer Gold', ['Razer Gold $10', 'Razer Gold 50 USD']],
    ['PlayStation', ['PSN 50 GBP', 'PSN 10000 points', 'PSN 25 GBP']],
    ['Netflix', ['Netflix Gift Card']],
  ])('does not take the gift card %s for game currency', (name, cards) => {
    expect(topUpReason(name, cards)).toBeNull();
  });

  it.each([
    ['Roblox', []],
    ['Free Fire Global', []],
    ['PUBG Mobile', []],
    ['Unknown Shooter', ['60 UC', '325 UC', 'Bundle']],
  ])('takes %s for game currency', (name, cards) => {
    expect(topUpReason(name, cards)).not.toBeNull();
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
