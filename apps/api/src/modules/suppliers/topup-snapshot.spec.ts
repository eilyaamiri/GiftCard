import { describe, expect, it } from 'vitest';

import { readTopUpSnapshot } from './topup-snapshot';

/**
 * The shape `quoteTargetSnapshot` writes for a top-up quote: the supplier sits
 * inside `target`, next to `topUp`. A production sweep failed on every paid
 * top-up because the reader looked for it at the top level instead.
 */
function quoteSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target: {
      kind: 'TOP_UP',
      topUp: {
        offerId: 'offer-1',
        providerOfferId: '500',
        providerSku: 'telegram:stars:500',
        costAmount: '4.750000',
        costCurrency: 'USD',
        game: { id: 'game-1', slug: 'telegram-stars-resellcodes' },
      },
      supplier: { id: 'sup-1', code: 'resellcodes-telegram' },
    },
    topUpAccountFields: { telegram_username: 'player_one' },
    ...overrides,
  };
}

describe('readTopUpSnapshot', () => {
  it('reads the supplier from where the quote writes it, inside target', () => {
    expect(readTopUpSnapshot(quoteSnapshot())).toEqual({
      providerSku: 'telegram:stars:500',
      supplierId: 'sup-1',
      supplierCode: 'resellcodes-telegram',
      costAmount: '4.750000',
      costCurrency: 'USD',
      accountFields: { telegram_username: 'player_one' },
    });
  });

  it('still accepts a top-level supplier on an older row', () => {
    const snapshot = quoteSnapshot();
    delete (snapshot['target'] as Record<string, unknown>)['supplier'];
    snapshot['supplier'] = { id: 'sup-2', code: 'fazercards-telegram' };

    expect(readTopUpSnapshot(snapshot)).toMatchObject({
      supplierId: 'sup-2',
      supplierCode: 'fazercards-telegram',
    });
  });

  it('returns null rather than a partial target when the supplier is missing', () => {
    const snapshot = quoteSnapshot();
    delete (snapshot['target'] as Record<string, unknown>)['supplier'];

    expect(readTopUpSnapshot(snapshot)).toBeNull();
  });

  it('returns null when the account fields are missing or not all strings', () => {
    expect(readTopUpSnapshot(quoteSnapshot({ topUpAccountFields: undefined }))).toBeNull();
    expect(readTopUpSnapshot(quoteSnapshot({ topUpAccountFields: { id: 5 } }))).toBeNull();
  });

  it('returns null for a value that is not an object', () => {
    expect(readTopUpSnapshot(null)).toBeNull();
    expect(readTopUpSnapshot('x')).toBeNull();
    expect(readTopUpSnapshot([])).toBeNull();
  });
});
