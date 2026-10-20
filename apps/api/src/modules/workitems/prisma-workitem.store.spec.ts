import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * `convertToRefundIfOwned` against a recorded transaction client.
 *
 * The scenario is two conversions of the same task racing. Both read the item
 * and the order before either commits, so both see REVIEW_REQUIRED; the second
 * one's conditional order UPDATE then matches nothing once the first commits.
 * What is asserted is that the loser stops there — no retype, no second Refund
 * row — rather than carrying on as it used to and paying the customer twice.
 */

interface Call {
  readonly op: string;
  readonly args: unknown;
}

function recordingTx(orderClaimCount: number, calls: Call[]) {
  return {
    workItem: {
      findUnique: async () => ({
        orderId: 'order-1',
        assignedToStaffId: 'staff-1',
        status: 'IN_PROGRESS',
        type: 'SUPPLIER_FOLLOWUP',
      }),
      update: async (args: unknown) => {
        calls.push({ op: 'workItem.update', args });
        return {};
      },
    },
    order: {
      findUnique: async () => ({ status: 'REVIEW_REQUIRED', totalAmountIrr: 1_000_000n }),
      updateMany: async (args: unknown) => {
        calls.push({ op: 'order.updateMany', args });
        return { count: orderClaimCount };
      },
    },
    refund: {
      create: async (args: unknown) => {
        calls.push({ op: 'refund.create', args });
        return { id: 'refund-1' };
      },
    },
    auditLog: {
      create: async (args: unknown) => {
        calls.push({ op: 'auditLog.create', args });
        return {};
      },
    },
  };
}

async function storeWith(orderClaimCount: number, calls: Call[]) {
  vi.resetModules();
  vi.doMock('@barat/database', () => ({
    prisma: {
      queue: { upsert: async () => ({ id: 'queue-refund' }) },
      // Like Prisma: a throw inside the callback rolls the whole thing back.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(recordingTx(orderClaimCount, calls)),
    },
  }));
  const { PrismaWorkItemStore } = await import('./prisma-workitem.store');
  return new PrismaWorkItemStore();
}

const INPUT = {
  workItemId: 'wi-1',
  staffId: 'staff-1',
  staffRole: 'OPERATOR',
  from: ['ASSIGNED', 'IN_PROGRESS'] as const,
  allowedTypes: ['SUPPLIER_FOLLOWUP', 'MANUAL_GIFT_CARD_FULFILLMENT'] as const,
  note: 'could not top up by hand',
  amountIrr: 500_000n,
  at: new Date('2026-10-20T10:00:00.000Z'),
};

afterEach(() => {
  vi.doUnmock('@barat/database');
  vi.resetModules();
});

describe('PrismaWorkItemStore.convertToRefundIfOwned', () => {
  it('the winner moves the order and creates exactly one refund', async () => {
    const calls: Call[] = [];
    const store = await storeWith(1, calls);

    const result = await store.convertToRefundIfOwned(INPUT);

    expect(result).toMatchObject({ changed: true, refundId: 'refund-1' });
    expect(calls.filter((call) => call.op === 'refund.create')).toHaveLength(1);
  });

  it('the loser of a concurrent conversion creates no refund and reports no change', async () => {
    const calls: Call[] = [];
    const store = await storeWith(0, calls);

    const result = await store.convertToRefundIfOwned(INPUT);

    expect(result.changed).toBe(false);
    expect(calls.some((call) => call.op === 'refund.create')).toBe(false);
    expect(calls.some((call) => call.op === 'workItem.update')).toBe(false);
  });
});
