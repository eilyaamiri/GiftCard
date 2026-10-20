import { describe, expect, it, vi } from 'vitest';

import {
  DeliveryRetryClientError,
  type DeliveryRetryClient,
  type DeliveryRetryOutcome,
} from '../clients/delivery-retry.client';
import { DeliveryRetryHandler } from './delivery-retry.handler';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const OLD = new Date('2026-10-20T09:00:00.000Z'); // well past the 15-minute cool-down

interface AssetRow {
  id: string;
  status: string;
  updatedAt: Date;
}

/** Just enough of `giftCardAsset` / `deliveryAttempt` for the handler. */
function fakeDb(assets: AssetRow[], attempts: Record<string, number> = {}) {
  const matches = (
    row: AssetRow,
    where: { id?: string; status: string; updatedAt: { lte: Date } },
  ) =>
    (where.id === undefined || row.id === where.id) &&
    row.status === where.status &&
    row.updatedAt.getTime() <= where.updatedAt.lte.getTime();

  return {
    giftCardAsset: {
      findMany: vi.fn(async ({ where }: { where: { status: string; updatedAt: { lte: Date } } }) =>
        assets.filter((row) => matches(row, where)).map((row) => ({ id: row.id })),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; status: string; updatedAt: { lte: Date } } }) => {
          const row = assets.find((r) => matches(r, where));
          return row === undefined ? null : { id: row.id };
        },
      ),
    },
    deliveryAttempt: {
      count: vi.fn(
        async ({ where }: { where: { giftCardAssetId: string } }) =>
          attempts[where.giftCardAssetId] ?? 0,
      ),
    },
  };
}

function outcome(assetId: string, delivered: boolean): DeliveryRetryOutcome {
  return { assetId, delivered, attemptNumber: 2, failureCode: delivered ? null : 'X' };
}

function handlerFor(db: ReturnType<typeof fakeDb>, client: DeliveryRetryClient) {
  return new DeliveryRetryHandler(db as never, client);
}

describe('DeliveryRetryHandler', () => {
  it('skips an asset that was re-attempted after the batch was read (cool-down applies again)', async () => {
    const assets: AssetRow[] = [
      { id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD },
      { id: 'a2', status: 'DELIVERY_FAILED', updatedAt: OLD },
    ];
    const db = fakeDb(assets);
    const retry = vi.fn(async (assetId: string) => {
      if (assetId === 'a1') {
        // While a1 was being retried, an operator pressed "retry" on a2 and it
        // failed again a moment ago.
        assets[1] = { id: 'a2', status: 'DELIVERY_FAILED', updatedAt: NOW };
      }
      return outcome(assetId, false);
    });

    const result = await handlerFor(db, { retry }).handle({ now: NOW.toISOString() });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith('a1');
    expect(result.details).toMatchObject({ superseded: 1, stillFailing: 1 });
  });

  it('skips an asset another dispatch has moved to SENDING or SENT', async () => {
    const assets: AssetRow[] = [{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD }];
    const db = fakeDb(assets);
    db.giftCardAsset.findMany.mockImplementationOnce(async () => {
      const ids = [{ id: 'a1' }];
      assets[0] = { id: 'a1', status: 'SENDING', updatedAt: OLD };
      return ids;
    });
    const retry = vi.fn();
    const result = await handlerFor(db, { retry }).handle({ now: NOW.toISOString() });
    expect(retry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ changed: 0, skipped: 1 });
  });

  it('fails the job loudly when the API refuses the internal credentials', async () => {
    const db = fakeDb([
      { id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD },
      { id: 'a2', status: 'DELIVERY_FAILED', updatedAt: OLD },
    ]);
    const retry = vi.fn(async () => {
      throw new DeliveryRetryClientError('retry-delivery rejected for asset a1', 401);
    });

    await expect(handlerFor(db, { retry }).handle({ now: NOW.toISOString() })).rejects.toThrow(
      /refused the internal service credentials \(HTTP 401\)/,
    );
    // Aborted on the first refusal instead of hammering the API with the rest.
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('treats 403 (token unset on the API) the same way', async () => {
    const db = fakeDb([{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD }]);
    const retry = vi.fn(async () => {
      throw new DeliveryRetryClientError('x', 403);
    });
    await expect(handlerFor(db, { retry }).handle({ now: NOW.toISOString() })).rejects.toThrow(
      /HTTP 403/,
    );
  });

  it('keeps going past a per-asset transport error or a 409 conflict', async () => {
    const db = fakeDb([
      { id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD },
      { id: 'a2', status: 'DELIVERY_FAILED', updatedAt: OLD },
      { id: 'a3', status: 'DELIVERY_FAILED', updatedAt: OLD },
    ]);
    const retry = vi.fn(async (assetId: string) => {
      if (assetId === 'a1') throw new Error('socket hang up');
      if (assetId === 'a2') throw new DeliveryRetryClientError('busy', 409);
      return outcome(assetId, true);
    });

    const result = await handlerFor(db, { retry }).handle({ now: NOW.toISOString() });
    expect(result.changed).toBe(1);
    expect(result.details).toMatchObject({ stillFailing: 1, conflicts: 1 });
  });

  it('never counts a delivery of a different asset as this asset being delivered', async () => {
    const db = fakeDb([{ id: 'a2', status: 'DELIVERY_FAILED', updatedAt: OLD }]);
    const retry = vi.fn(async () => outcome('a1', true));

    const result = await handlerFor(db, { retry }).handle({ now: NOW.toISOString() });
    expect(result.changed).toBe(0);
    expect(result.details).toMatchObject({ mismatched: 1, stillFailing: 1 });
  });

  it('leaves an asset at the attempt cap alone', async () => {
    const db = fakeDb([{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD }], { a1: 5 });
    const retry = vi.fn();
    const result = await handlerFor(db, { retry }).handle({ now: NOW.toISOString() });
    expect(retry).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ exhausted: 1 });
  });

  describe('payload overrides may only make the sweep more conservative', () => {
    const db = fakeDb([]);
    const handler = handlerFor(db, { retry: vi.fn() });

    it('rejects raising the attempt cap', async () => {
      await expect(handler.handle({ maxAttempts: 1_000_000 })).rejects.toThrow(
        /invalid job payload \(maxAttempts\)/,
      );
    });

    it('rejects shortening the cool-down', async () => {
      await expect(handler.handle({ minRetryDelayMinutes: 0 })).rejects.toThrow(
        /minRetryDelayMinutes/,
      );
    });

    it('rejects a non-integer or negative batch size', async () => {
      await expect(handler.handle({ batchSize: -1 })).rejects.toThrow(/batchSize/);
      await expect(handler.handle({ batchSize: 1.5 })).rejects.toThrow(/batchSize/);
    });

    it('rejects a pinned clock in the future', async () => {
      const future = new Date(Date.now() + 3_600_000).toISOString();
      await expect(handler.handle({ now: future })).rejects.toThrow(/may not be in the future/);
    });

    it('accepts lowering the cap and lengthening the cool-down', async () => {
      await expect(
        handler.handle({ maxAttempts: 2, minRetryDelayMinutes: 60, batchSize: 10 }),
      ).resolves.toMatchObject({ changed: 0 });
    });
  });
});
