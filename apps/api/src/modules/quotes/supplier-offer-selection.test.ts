import { describe, expect, it } from 'vitest';

import {
  effectiveOfferCost,
  selectBestOffer,
  type SelectableOffer,
} from './supplier-offer-selection';

function offer(overrides: Partial<SelectableOffer> = {}): SelectableOffer {
  return {
    id: 'offer-1',
    supplierId: 'supplier-1',
    costCurrency: 'USD',
    costAmount: '10',
    discountBps: 0,
    availability: 'AVAILABLE',
    isActive: true,
    priority: 100,
    supplierIsActive: true,
    ...overrides,
  };
}

describe('effectiveOfferCost', () => {
  it('applies the supplier discount in exact decimal arithmetic', () => {
    /* 12.34 x (1 - 7.5%) = 11.4145 exactly. A float would give 11.414499999... */
    expect(effectiveOfferCost(offer({ costAmount: '12.34', discountBps: 750 })).toString()).toBe(
      '11.4145',
    );
  });
});

describe('selectBestOffer', () => {
  it('picks the lowest effective cost, not the lowest listed cost', () => {
    const selection = selectBestOffer(
      [
        offer({ id: 'a', costAmount: '10', discountBps: 0 }),
        offer({ id: 'b', costAmount: '11', discountBps: 2_000 }),
      ],
      'USD',
    );

    expect(selection?.offer.id).toBe('b');
    expect(selection?.effectiveCost).toBe('8.8');
  });

  it.each([
    ['inactive offer', offer({ id: 'x', isActive: false, costAmount: '1' })],
    ['inactive supplier', offer({ id: 'x', supplierIsActive: false, costAmount: '1' })],
    ['unavailable offer', offer({ id: 'x', availability: 'UNAVAILABLE', costAmount: '1' })],
    ['foreign currency', offer({ id: 'x', costCurrency: 'EUR', costAmount: '1' })],
  ])('never selects an %s even when it is cheapest', (_label, excluded) => {
    const selection = selectBestOffer([excluded, offer({ id: 'ok', costAmount: '99' })], 'USD');
    expect(selection?.offer.id).toBe('ok');
  });

  it('returns null when nothing is purchasable', () => {
    expect(selectBestOffer([offer({ availability: 'UNAVAILABLE' })], 'USD')).toBeNull();
  });

  it('breaks ties deterministically on priority then id', () => {
    const byPriority = selectBestOffer(
      [offer({ id: 'b', priority: 5 }), offer({ id: 'a', priority: 9 })],
      'USD',
    );
    expect(byPriority?.offer.id).toBe('b');

    const byId = selectBestOffer(
      [offer({ id: 'zzz', priority: 5 }), offer({ id: 'aaa', priority: 5 })],
      'USD',
    );
    expect(byId?.offer.id).toBe('aaa');
  });

  it('is stable across a reordering of the same input', () => {
    const offers = [
      offer({ id: 'a', costAmount: '10' }),
      offer({ id: 'b', costAmount: '10' }),
      offer({ id: 'c', costAmount: '10' }),
    ];
    const forwards = selectBestOffer(offers, 'USD');
    const backwards = selectBestOffer([...offers].reverse(), 'USD');
    expect(forwards?.offer.id).toBe(backwards?.offer.id);
  });
});
