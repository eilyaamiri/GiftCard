import { describe, expect, it, vi } from 'vitest';

import { QuoteExpiryHandler } from './quote-expiry.handler';

function fakeDb(ids: string[], updatedCount: number) {
  return {
    quote: {
      findMany: vi.fn(async () => ids.map((id) => ({ id }))),
      updateMany: vi.fn(async () => ({ count: updatedCount })),
    },
  };
}

describe('QuoteExpiryHandler', () => {
  it('re-asserts ACTIVE + expiresAt in the write so an accepted (mid-payment) quote survives', async () => {
    const db = fakeDb(['q1', 'q2'], 1); // q2 was accepted between read and write
    const now = new Date(Date.now() - 1_000);

    const result = await new QuoteExpiryHandler(db as never).handle({ now: now.toISOString() });

    expect(db.quote.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['q1', 'q2'] }, status: 'ACTIVE', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    expect(result).toMatchObject({ changed: 1, skipped: 1 });
  });

  it('refuses a pinned clock in the future, which would expire quotes that are still valid', async () => {
    const db = fakeDb(['q1'], 1);
    const future = new Date(Date.now() + 2 * 3_600_000).toISOString();

    await expect(new QuoteExpiryHandler(db as never).handle({ now: future })).rejects.toThrow(
      /may not be in the future/,
    );
    expect(db.quote.findMany).not.toHaveBeenCalled();
    expect(db.quote.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid clock or batch size', async () => {
    const handler = new QuoteExpiryHandler(fakeDb([], 0) as never);
    await expect(handler.handle({ now: 'not-a-date' })).rejects.toThrow(
      /invalid job payload \(now\)/,
    );
    await expect(handler.handle({ batchSize: 0 })).rejects.toThrow(/batchSize/);
  });

  it('is a no-op on a second run', async () => {
    const db = fakeDb([], 0);
    await expect(new QuoteExpiryHandler(db as never).handle({})).resolves.toEqual({
      changed: 0,
      skipped: 0,
    });
    expect(db.quote.updateMany).not.toHaveBeenCalled();
  });
});
