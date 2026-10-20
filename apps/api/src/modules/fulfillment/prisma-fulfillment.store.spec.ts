import { afterEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';

/*
 * The Prisma store's concurrency guards, against a recorded client.
 *
 * These cannot be proved against an in-memory double — the bug they close is
 * what the database does between two transactions — so the assertions are on
 * the statements issued: the order row is locked before the asset count, the
 * count decides, and every status write is conditional on the state it moves
 * from.
 */

interface Call {
  readonly op: string;
  readonly args: unknown;
}

async function storeWith(prismaDouble: unknown) {
  vi.resetModules();
  vi.doMock('@barat/database', () => ({
    prisma: prismaDouble,
    Prisma: { Decimal },
  }));
  const { PrismaFulfillmentStore } = await import('./prisma-fulfillment.store');
  return new PrismaFulfillmentStore();
}

afterEach(() => {
  vi.doUnmock('@barat/database');
  vi.resetModules();
});

const ASSET_INPUT = {
  orderId: 'order-1',
  fulfillmentId: 'fulfillment-1',
  skuId: null,
  assetType: 'CODE' as const,
  encryptedCode: 'v1.iv.tag.ct',
  encryptedPin: null,
  maskedCode: 'ABCD-XXXX-XXXX-8271',
  serialNumber: null,
  deliveryUrl: null,
  recipientEmail: null,
  expiryDate: null,
  supplierReference: null,
  actualSupplierCost: '10.00',
  actualSupplierCurrency: 'USD',
  enteredByUserId: null,
  enteredAt: new Date('2026-10-20T10:00:00.000Z'),
};

function assetTx(existingAssets: number, calls: Call[]) {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: 'queryRaw', args: { sql: strings.join('?'), values } });
      return [{ id: 'order-1' }];
    },
    giftCardAsset: {
      count: async (args: unknown) => {
        calls.push({ op: 'count', args });
        return existingAssets;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.push({ op: 'create', args });
        return {
          id: 'asset-1',
          orderId: args.data['orderId'],
          fulfillmentId: args.data['fulfillmentId'],
          skuId: null,
          assetType: 'CODE',
          maskedCode: args.data['maskedCode'],
          serialNumber: null,
          deliveryUrl: null,
          recipientEmail: null,
          expiryDate: null,
          supplierReference: null,
          status: 'READY',
          enteredByUserId: null,
          enteredAt: args.data['enteredAt'],
          sentAt: null,
          accessCount: 0,
          lastAccessedAt: null,
        };
      },
    },
  };
}

describe('PrismaFulfillmentStore.createAsset', () => {
  it('locks the order row, then counts, then creates', async () => {
    const calls: Call[] = [];
    const store = await storeWith({
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(assetTx(0, calls)),
    });

    const view = await store.createAsset(ASSET_INPUT);

    expect(view.id).toBe('asset-1');
    expect(calls.map((call) => call.op)).toEqual(['queryRaw', 'count', 'create']);
    const lock = calls[0]?.args as { sql: string; values: unknown[] };
    expect(lock.sql).toContain('FOR UPDATE');
    expect(lock.values).toEqual(['order-1']);
  });

  it('refuses a second asset for the order instead of writing a duplicate', async () => {
    const calls: Call[] = [];
    const store = await storeWith({
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(assetTx(1, calls)),
    });

    await expect(store.createAsset(ASSET_INPUT)).rejects.toThrow();
    expect(calls.some((call) => call.op === 'create')).toBe(false);
  });
});

describe('PrismaFulfillmentStore status writes are conditional', () => {
  function recordingDb(calls: Call[]) {
    const updateMany = (model: string) => async (args: unknown) => {
      calls.push({ op: `${model}.updateMany`, args });
      return { count: 1 };
    };
    return {
      order: { updateMany: updateMany('order') },
      giftCardAsset: { updateMany: updateMany('giftCardAsset') },
    };
  }

  it('marks an order FULFILLED only from a deliverable status', async () => {
    const calls: Call[] = [];
    const store = await storeWith(recordingDb(calls));

    await store.markOrderFulfilled('order-1', new Date());

    const where = (calls[0]?.args as { where: { id: string; status: { in: string[] } } }).where;
    expect(calls[0]?.op).toBe('order.updateMany');
    expect(where.id).toBe('order-1');
    expect(where.status.in).toEqual(['PAID', 'FULFILLMENT_PENDING', 'FULFILLING']);
    expect(where.status.in).not.toContain('REFUND_PENDING');
  });

  it('settles an asset only out of SENDING', async () => {
    const calls: Call[] = [];
    const store = await storeWith(recordingDb(calls));

    await store.markAssetSent('asset-1', new Date());
    await store.markAssetDeliveryFailed('asset-1');

    for (const call of calls) {
      expect(call.op).toBe('giftCardAsset.updateMany');
      expect((call.args as { where: { status: string } }).where.status).toBe('SENDING');
    }
    expect(calls).toHaveLength(2);
  });
});
