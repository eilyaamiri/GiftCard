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
  supersededAt?: Date | null;
  /** Defaults to FULFILLING. */
  orderStatus?: string;
}

interface AttemptCounts {
  /** Attempts the worker made (initiatedByStaffId NULL). */
  readonly system?: number;
  /** Attempts an operator made. */
  readonly staff?: number;
}

interface AssetWhere {
  id?: string | { notIn: string[] };
  status: string;
  supersededAt?: null;
  updatedAt: { lte: Date };
  order?: { status: { in: string[] } };
}

const orderStatusOf = (row: AssetRow) => row.orderStatus ?? 'FULFILLING';

/** Just enough of `giftCardAsset` / `deliveryAttempt` / `reconciliationIssue`. */
function fakeDb(
  assets: AssetRow[],
  attempts: Record<string, AttemptCounts> = {},
  issues: Array<{ giftCardAssetId: string; type: string }> = [],
) {
  const matches = (row: AssetRow, where: AssetWhere) =>
    (where.id === undefined ||
      (typeof where.id === 'string' ? row.id === where.id : !where.id.notIn.includes(row.id))) &&
    row.status === where.status &&
    (where.supersededAt === undefined || (row.supersededAt ?? null) === null) &&
    (where.order === undefined || where.order.status.in.includes(orderStatusOf(row))) &&
    row.updatedAt.getTime() <= where.updatedAt.lte.getTime();

  const countFor = (assetId: string, systemOnly: boolean) => {
    const counts = attempts[assetId] ?? {};
    return (counts.system ?? 0) + (systemOnly ? 0 : (counts.staff ?? 0));
  };

  return {
    giftCardAsset: {
      findMany: vi.fn(async ({ where }: { where: AssetWhere }) =>
        assets.filter((row) => matches(row, where)).map((row) => ({ id: row.id })),
      ),
      findFirst: vi.fn(async ({ where }: { where: AssetWhere }) => {
        const row = assets.find((r) => matches(r, where));
        return row === undefined ? null : { id: row.id };
      }),
    },
    deliveryAttempt: {
      count: vi.fn(
        async ({ where }: { where: { giftCardAssetId: string; initiatedByStaffId?: null } }) =>
          countFor(where.giftCardAssetId, where.initiatedByStaffId === null),
      ),
      groupBy: vi.fn(
        async ({ having }: { having: { giftCardAssetId: { _count: { gte: number } } } }) =>
          assets
            .filter(
              (row) =>
                row.status === 'DELIVERY_FAILED' &&
                (row.supersededAt ?? null) === null &&
                ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'].includes(orderStatusOf(row)),
            )
            .filter((row) => countFor(row.id, true) >= having.giftCardAssetId._count.gte)
            .map((row) => ({ giftCardAssetId: row.id })),
      ),
    },
    reconciliationIssue: {
      findMany: vi.fn(
        async ({ where }: { where: { giftCardAssetId: { in: string[] }; type: string } }) =>
          issues
            .filter(
              (issue) =>
                where.giftCardAssetId.in.includes(issue.giftCardAssetId) &&
                issue.type === where.type,
            )
            .map((issue) => ({ giftCardAssetId: issue.giftCardAssetId })),
      ),
    },
  };
}

function client(overrides: Partial<DeliveryRetryClient> = {}): DeliveryRetryClient {
  return {
    retry: vi.fn(),
    reportProblem: vi.fn(async () => ({ reported: true })),
    ...overrides,
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

    const result = await handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() });

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
    const result = await handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() });
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

    await expect(
      handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() }),
    ).rejects.toThrow(/refused the internal service credentials \(HTTP 401\)/);
    // Aborted on the first refusal instead of hammering the API with the rest.
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('treats 403 (token unset on the API) the same way', async () => {
    const db = fakeDb([{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD }]);
    const retry = vi.fn(async () => {
      throw new DeliveryRetryClientError('x', 403);
    });
    await expect(
      handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() }),
    ).rejects.toThrow(/HTTP 403/);
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

    const result = await handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() });
    expect(result.changed).toBe(1);
    expect(result.details).toMatchObject({ stillFailing: 1, conflicts: 1 });
  });

  it('never counts a delivery of a different asset as this asset being delivered', async () => {
    const db = fakeDb([{ id: 'a2', status: 'DELIVERY_FAILED', updatedAt: OLD }]);
    const retry = vi.fn(async () => outcome('a1', true));

    const result = await handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() });
    expect(result.changed).toBe(0);
    expect(result.details).toMatchObject({ mismatched: 1, stillFailing: 1 });
  });

  it('leaves an asset at the attempt cap alone and reports it to a human', async () => {
    const db = fakeDb([{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD }], {
      a1: { system: 5 },
    });
    const retry = vi.fn();
    const reportProblem = vi.fn(async () => ({ reported: true }));

    const result = await handlerFor(db, client({ retry, reportProblem })).handle({
      now: NOW.toISOString(),
    });

    expect(retry).not.toHaveBeenCalled();
    expect(reportProblem).toHaveBeenCalledWith('a1', 'RETRIES_EXHAUSTED');
    expect(result.details).toMatchObject({ exhausted: 1, problemsReported: 1 });
  });

  it('keeps exhausted assets out of the batch so newer failures still get retried', async () => {
    const db = fakeDb(
      [
        { id: 'old-1', status: 'DELIVERY_FAILED', updatedAt: new Date('2026-10-01T00:00:00Z') },
        { id: 'new-1', status: 'DELIVERY_FAILED', updatedAt: OLD },
      ],
      { 'old-1': { system: 5 } },
    );
    const retry = vi.fn(async (assetId: string) => outcome(assetId, true));

    const result = await handlerFor(db, client({ retry })).handle({
      now: NOW.toISOString(),
      batchSize: 1,
    });

    expect(retry).toHaveBeenCalledWith('new-1');
    expect(result.changed).toBe(1);
  });

  it('reports an exhausted asset only once across sweeps', async () => {
    const issues: Array<{ giftCardAssetId: string; type: string }> = [];
    const db = fakeDb(
      [{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD }],
      { a1: { system: 5 } },
      issues,
    );
    const reportProblem = vi.fn(async (assetId: string) => {
      issues.push({ giftCardAssetId: assetId, type: 'delivery_failed' });
      return { reported: true };
    });
    const handler = handlerFor(db, client({ reportProblem }));

    await handler.handle({ now: NOW.toISOString() });
    const second = await handler.handle({ now: NOW.toISOString() });

    expect(reportProblem).toHaveBeenCalledTimes(1);
    expect(second.details).toMatchObject({ exhausted: 1, problemsReported: 0 });
  });

  it("does not count an operator's resends towards the automatic cap", async () => {
    const db = fakeDb([{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD }], {
      a1: { system: 2, staff: 7 },
    });
    const retry = vi.fn(async (assetId: string) => outcome(assetId, false));

    const result = await handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() });

    expect(retry).toHaveBeenCalledWith('a1');
    expect(result.details).toMatchObject({ exhausted: 0 });
  });

  it('never retries an asset that a manager replaced', async () => {
    const db = fakeDb([
      { id: 'old-card', status: 'DELIVERY_FAILED', updatedAt: OLD, supersededAt: OLD },
    ]);
    const retry = vi.fn();

    const result = await handlerFor(db, client({ retry })).handle({ now: NOW.toISOString() });

    expect(retry).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({ examined: 0 });
  });

  it.each(['REFUNDED', 'REFUND_PENDING', 'CANCELLED', 'FULFILLED'])(
    'neither retries nor reports a failed card on a %s order',
    async (orderStatus) => {
      const db = fakeDb([{ id: 'a1', status: 'DELIVERY_FAILED', updatedAt: OLD, orderStatus }], {
        a1: { system: 5 },
      });
      const retry = vi.fn();
      const reportProblem = vi.fn();

      await handlerFor(db, client({ retry, reportProblem })).handle({ now: NOW.toISOString() });

      expect(retry).not.toHaveBeenCalled();
      expect(reportProblem).not.toHaveBeenCalled();
    },
  );

  it('reports an asset stuck in SENDING instead of re-sending it', async () => {
    const db = fakeDb([
      { id: 'stuck', status: 'SENDING', updatedAt: OLD },
      // Claimed a minute ago: an ordinary dispatch still in flight.
      { id: 'busy', status: 'SENDING', updatedAt: new Date(NOW.getTime() - 60_000) },
    ]);
    const retry = vi.fn();
    const reportProblem = vi.fn(async () => ({ reported: true }));

    const result = await handlerFor(db, client({ retry, reportProblem })).handle({
      now: NOW.toISOString(),
    });

    expect(retry).not.toHaveBeenCalled();
    expect(reportProblem).toHaveBeenCalledTimes(1);
    expect(reportProblem).toHaveBeenCalledWith('stuck', 'SENDING_STUCK');
    expect(result.details).toMatchObject({ stuckSending: 1, problemsReported: 1 });
  });

  it('does not ask the API again about a stuck asset it already reported', async () => {
    const db = fakeDb([{ id: 'stuck', status: 'SENDING', updatedAt: OLD }], {}, [
      { giftCardAssetId: 'stuck', type: 'gift_card_entered_not_sent' },
    ]);
    const reportProblem = vi.fn();

    await handlerFor(db, client({ reportProblem })).handle({ now: NOW.toISOString() });

    expect(reportProblem).not.toHaveBeenCalled();
  });

  it('counts a report the API refuses as moved-on (409) and keeps going', async () => {
    const db = fakeDb([
      { id: 's1', status: 'SENDING', updatedAt: OLD },
      { id: 's2', status: 'SENDING', updatedAt: OLD },
      { id: 's3', status: 'SENDING', updatedAt: OLD },
    ]);
    const reportProblem = vi.fn(async (assetId: string) => {
      if (assetId === 's1') throw new DeliveryRetryClientError('moved on', 409);
      if (assetId === 's2') throw new Error('socket hang up');
      return { reported: true };
    });

    const result = await handlerFor(db, client({ reportProblem })).handle({
      now: NOW.toISOString(),
    });

    expect(result.details).toMatchObject({
      problemsReported: 1,
      problemReportConflicts: 1,
      problemReportsFailed: 1,
    });
  });

  it('fails the sweep when a problem report is refused for credentials', async () => {
    const db = fakeDb([{ id: 's1', status: 'SENDING', updatedAt: OLD }]);
    const reportProblem = vi.fn(async () => {
      throw new DeliveryRetryClientError('nope', 401);
    });

    await expect(
      handlerFor(db, client({ reportProblem })).handle({ now: NOW.toISOString() }),
    ).rejects.toThrow(/HTTP 401/);
  });

  describe('payload overrides may only make the sweep more conservative', () => {
    const db = fakeDb([]);
    const handler = handlerFor(db, client());

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
