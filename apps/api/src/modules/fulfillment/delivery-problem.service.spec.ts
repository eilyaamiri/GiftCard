import { describe, expect, it, vi } from 'vitest';

import type { AlertInput, AlertLogger } from '../../common/alert/alert-logger';
import {
  DeliveryProblemService,
  STUCK_SENDING_AFTER_MS,
  type DeliveryProblemDatabase,
} from './delivery-problem.service';

const NOW = new Date('2026-10-21T10:00:00.000Z');
const LONG_AGO = new Date(NOW.getTime() - STUCK_SENDING_AFTER_MS - 60_000);

interface AssetRow {
  id: string;
  orderId: string;
  fulfillmentId: string | null;
  status: string;
  updatedAt: Date;
  supersededAt: Date | null;
}

interface IssueRow {
  giftCardAssetId: string;
  type: string;
  openDedupeKey: string;
  details: Record<string, unknown>;
  severity: string;
}

function harness(asset: Partial<AssetRow> | null, options: { systemAttempts?: number } = {}) {
  const row: AssetRow | null =
    asset === null
      ? null
      : {
          id: 'asset-1',
          orderId: 'order-1',
          fulfillmentId: 'ful-1',
          status: 'SENDING',
          updatedAt: LONG_AGO,
          supersededAt: null,
          ...asset,
        };
  const issues: IssueRow[] = [];
  const alerts: AlertInput[] = [];

  const db = {
    giftCardAsset: {
      findUnique: vi.fn(async () =>
        row === null ? null : { ...row, order: { orderNumber: 'BP-2026-000201' } },
      ),
    },
    deliveryAttempt: {
      count: vi.fn(async ({ where }: { where: { initiatedByStaffId?: null } }) =>
        where.initiatedByStaffId === null ? (options.systemAttempts ?? 0) : 99,
      ),
    },
    reconciliationIssue: {
      findFirst: vi.fn(
        async ({ where }: { where: { giftCardAssetId: string; type: string } }) =>
          issues.find(
            (issue) => issue.giftCardAssetId === where.giftCardAssetId && issue.type === where.type,
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: IssueRow }) => {
        if (issues.some((issue) => issue.openDedupeKey === data.openDedupeKey)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        issues.push(data);
        return data;
      }),
    },
  };
  const alertLogger = { log: (input: AlertInput) => alerts.push(input) } as unknown as AlertLogger;
  const service = new DeliveryProblemService(db as unknown as DeliveryProblemDatabase, alertLogger);
  return { service, db, issues, alerts };
}

describe('DeliveryProblemService', () => {
  it('opens one issue and pages once for an asset stuck in SENDING', async () => {
    const h = harness({ status: 'SENDING' });

    await expect(
      h.service.report({ assetId: 'asset-1', problem: 'SENDING_STUCK' }, NOW),
    ).resolves.toEqual({ reported: true });
    await expect(
      h.service.report({ assetId: 'asset-1', problem: 'SENDING_STUCK' }, NOW),
    ).resolves.toEqual({ reported: false });

    expect(h.issues).toHaveLength(1);
    expect(h.issues[0]).toMatchObject({
      type: 'gift_card_entered_not_sent',
      severity: 'HIGH',
      openDedupeKey: 'asset-1:SENDING_STUCK',
    });
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toMatchObject({ severity: 'ERROR', source: 'ORDER' });
    expect(h.alerts[0]?.message).toContain('BP-2026-000201');
  });

  it('reports exhausted retries with the count of automatic attempts only', async () => {
    const h = harness({ status: 'DELIVERY_FAILED' }, { systemAttempts: 5 });

    await h.service.report({ assetId: 'asset-1', problem: 'RETRIES_EXHAUSTED' }, NOW);

    expect(h.issues[0]).toMatchObject({
      type: 'delivery_failed',
      details: { problem: 'RETRIES_EXHAUSTED', automaticAttempts: 5 },
    });
    expect(h.alerts[0]?.message).toContain('after 5 automatic attempts');
  });

  it('never puts a code, PIN or recipient in the issue or the page', async () => {
    const h = harness({ status: 'DELIVERY_FAILED' });
    await h.service.report({ assetId: 'asset-1', problem: 'RETRIES_EXHAUSTED' }, NOW);

    const select = (
      h.db.giftCardAsset.findUnique.mock.calls[0] as unknown as [
        { select: Record<string, unknown> },
      ]
    )[0].select;
    for (const secret of ['encryptedCode', 'encryptedPin', 'recipientEmail', 'deliveryUrl']) {
      expect(select).not.toHaveProperty(secret);
    }
    expect(Object.keys(h.alerts[0]?.context ?? {}).sort()).toEqual([
      'assetId',
      'automaticAttempts',
      'orderId',
      'problem',
    ]);
  });

  it('refuses a SENDING asset that is merely in flight', async () => {
    const h = harness({ status: 'SENDING', updatedAt: new Date(NOW.getTime() - 60_000) });
    await expect(
      h.service.report({ assetId: 'asset-1', problem: 'SENDING_STUCK' }, NOW),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.issues).toHaveLength(0);
    expect(h.alerts).toHaveLength(0);
  });

  it.each([
    ['delivered since', { status: 'SENT' }, 'RETRIES_EXHAUSTED'],
    [
      'replaced by a manager',
      { status: 'DELIVERY_FAILED', supersededAt: NOW },
      'RETRIES_EXHAUSTED',
    ],
    ['no longer sending', { status: 'DELIVERY_FAILED' }, 'SENDING_STUCK'],
  ] as const)('refuses an asset %s', async (_label, asset, problem) => {
    const h = harness(asset);
    await expect(h.service.report({ assetId: 'asset-1', problem }, NOW)).rejects.toMatchObject({
      status: 409,
    });
    expect(h.alerts).toHaveLength(0);
  });

  it('answers 404 for an unknown asset', async () => {
    const h = harness(null);
    await expect(
      h.service.report({ assetId: 'nope', problem: 'SENDING_STUCK' }, NOW),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('does not page twice when a concurrent report won the insert', async () => {
    const h = harness({ status: 'SENDING' });
    h.issues.push({
      giftCardAssetId: 'other',
      type: 'x',
      openDedupeKey: 'asset-1:SENDING_STUCK',
      details: {},
      severity: 'HIGH',
    });

    await expect(
      h.service.report({ assetId: 'asset-1', problem: 'SENDING_STUCK' }, NOW),
    ).resolves.toEqual({ reported: false });
    expect(h.alerts).toHaveLength(0);
  });
});
