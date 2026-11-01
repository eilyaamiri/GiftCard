import { describe, expect, it, vi } from 'vitest';

import { QuoteExpiryHandler } from './quote-expiry.handler';

function fakeDb(ids: string[], updatedCount: number, databaseNow: Date = new Date()) {
  return {
    $queryRaw: vi.fn(async () => [{ now: databaseNow }]),
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
    await expect(new QuoteExpiryHandler(db as never).handle({})).resolves.toMatchObject({
      changed: 0,
      skipped: 0,
    });
    expect(db.quote.updateMany).not.toHaveBeenCalled();
  });

  it('expires against the database clock, not a worker clock that runs fast', async () => {
    // The worker host is 4.5 hours ahead; the database is right.
    const databaseNow = new Date(Date.now() - 4.5 * 3_600_000);
    const db = fakeDb(['q1'], 1, databaseNow);

    const result = await new QuoteExpiryHandler(db as never).handle({});

    expect(db.quote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', expiresAt: { lte: databaseNow } },
      }),
    );
    expect(db.quote.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['q1'] }, status: 'ACTIVE', expiresAt: { lte: databaseNow } },
      data: { status: 'EXPIRED' },
    });
    expect(result.details).toMatchObject({ clockSkewSeconds: 16_200 });
  });

  it('refuses a pinned clock ahead of the database clock', async () => {
    const databaseNow = new Date(Date.now() - 3_600_000);
    const db = fakeDb(['q1'], 1, databaseNow);

    // Not ahead of this process, but an hour ahead of the database.
    await expect(
      new QuoteExpiryHandler(db as never).handle({ now: new Date().toISOString() }),
    ).rejects.toThrow(/may not be in the future/);
    expect(db.quote.updateMany).not.toHaveBeenCalled();
  });

  it('fails the sweep when the database clock cannot be read', async () => {
    const db = fakeDb(['q1'], 1);
    db.$queryRaw.mockResolvedValueOnce([]);

    await expect(new QuoteExpiryHandler(db as never).handle({})).rejects.toThrow(
      /database clock unreadable/,
    );
    expect(db.quote.findMany).not.toHaveBeenCalled();
  });
});
