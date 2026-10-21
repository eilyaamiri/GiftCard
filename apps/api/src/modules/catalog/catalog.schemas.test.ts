import { describe, expect, it } from 'vitest';
import { DELIVERY_TIME_PRESETS, deliveryTimeLabelFa } from '@barat/contracts';

import {
  createProductSchema,
  updateInternationalServiceSchema,
  updateProductSchema,
  updateSkuSchema,
  updateSupplierOfferSchema,
  updateTopUpGameSchema,
} from './catalog.schemas';

/**
 * The delivery time is a promise shown to a customer before they pay, so an
 * operator may only set one of the presets the storefront knows how to word.
 */
describe('deliveryMinutes on admin writes', () => {
  const schemas = [
    ['product', updateProductSchema],
    ['top-up game', updateTopUpGameSchema],
    ['international service', updateInternationalServiceSchema],
  ] as const;

  it.each(schemas)('accepts every preset and null on a %s', (_name, schema) => {
    for (const { minutes } of DELIVERY_TIME_PRESETS) {
      expect(schema.parse({ deliveryMinutes: minutes })).toMatchObject({ deliveryMinutes: minutes });
    }
    expect(schema.parse({ deliveryMinutes: null })).toMatchObject({ deliveryMinutes: null });
  });

  it.each(schemas)('refuses a value that is not a preset on a %s', (_name, schema) => {
    for (const bad of [45, -1, 1.5, 99_999]) {
      expect(schema.safeParse({ deliveryMinutes: bad }).success).toBe(false);
    }
  });

  it.each(schemas)('leaves the stored value alone when a %s patch omits it', (_name, schema) => {
    /* A patch must carry at least one field, so change something else. */
    expect(schema.parse({ sortOrder: 3 })).not.toHaveProperty('deliveryMinutes');
  });

  it('is optional when creating a product', () => {
    const parsed = createProductSchema.parse({
      slug: 'x',
      title: 'X',
      titleFa: 'ایکس',
      brandId: 'c'.repeat(25),
      categoryId: 'c'.repeat(25),
    });
    expect(parsed.deliveryMinutes).toBeUndefined();
  });
});

describe('deliveryTimeLabelFa', () => {
  it('words every preset and shows nothing for an unset value', () => {
    expect(deliveryTimeLabelFa(0)).toBe('آنی');
    expect(deliveryTimeLabelFa(60)).toBe('حدود ۱ ساعت');
    expect(deliveryTimeLabelFa(null)).toBeNull();
    expect(deliveryTimeLabelFa(undefined)).toBeNull();
  });

  it('shows nothing rather than inventing wording for a non-preset value', () => {
    expect(deliveryTimeLabelFa(45)).toBeNull();
  });
});

/** ORD-8: a zero face value or supplier cost is never a real price. */
describe('zero prices on admin writes', () => {
  it('refuses a zero supplier cost and a zero face value, on create and on patch', () => {
    expect(updateSupplierOfferSchema.safeParse({ costAmount: '0' }).success).toBe(false);
    expect(updateSupplierOfferSchema.safeParse({ costAmount: '0.000000' }).success).toBe(false);
    expect(updateSupplierOfferSchema.safeParse({ costAmount: '0.01' }).success).toBe(true);
    expect(updateSkuSchema.safeParse({ faceValue: '0' }).success).toBe(false);
    expect(updateSkuSchema.safeParse({ faceValue: '25' }).success).toBe(true);
  });
});
