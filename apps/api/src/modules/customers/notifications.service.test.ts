import { describe, expect, it, vi } from 'vitest';

import type { CustomersDatabase } from './customers.tokens';
import { NotificationsService } from './notifications.service';

interface Seed {
  readonly orders?: readonly Record<string, unknown>[];
  readonly refunds?: readonly Record<string, unknown>[];
  readonly replies?: readonly Record<string, unknown>[];
}

interface Rig {
  readonly service: NotificationsService;
  readonly orderArgs: Record<string, unknown>[];
  readonly refundArgs: Record<string, unknown>[];
  readonly replyArgs: Record<string, unknown>[];
}

function buildRig(seed: Seed = {}): Rig {
  const orderArgs: Record<string, unknown>[] = [];
  const refundArgs: Record<string, unknown>[] = [];
  const replyArgs: Record<string, unknown>[] = [];

  const database = {
    order: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        orderArgs.push(args);
        return seed.orders ?? [];
      }),
    },
    refund: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        refundArgs.push(args);
        return seed.refunds ?? [];
      }),
    },
    supportMessage: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        replyArgs.push(args);
        return seed.replies ?? [];
      }),
    },
  } as unknown as CustomersDatabase;

  return { service: new NotificationsService(database), orderArgs, refundArgs, replyArgs };
}

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    orderNumber: 'BP-2026-000001',
    status: 'FULFILLED',
    placedAt: null,
    paidAt: null,
    fulfilledAt: null,
    cancelledAt: null,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('NotificationsService / scoping', () => {
  it('filters every source by the session customer id', async () => {
    const rig = buildRig();

    await rig.service.list('customer-7');

    expect(rig.orderArgs[0]?.['where']).toMatchObject({ customerId: 'customer-7' });
    expect(rig.refundArgs[0]?.['where']).toEqual({ order: { customerId: 'customer-7' } });
    expect(rig.replyArgs[0]?.['where']).toEqual({
      authorType: 'STAFF',
      ticket: { workItem: { customerId: 'customer-7' } },
    });
  });

  it('leaves draft orders out of the feed', async () => {
    const rig = buildRig();

    await rig.service.list('customer-7');

    expect(rig.orderArgs[0]?.['where']).toEqual({
      customerId: 'customer-7',
      status: { not: 'DRAFT' },
    });
  });

  it('never asks the database for a support message body', async () => {
    const rig = buildRig();

    await rig.service.list('customer-7');

    const select = rig.replyArgs[0]?.['select'] as Record<string, unknown>;
    expect(select).not.toHaveProperty('body');
  });
});

describe('NotificationsService / order events', () => {
  it('turns one order into one line per milestone it reached, newest first', async () => {
    const rig = buildRig({
      orders: [
        order({
          placedAt: new Date('2026-09-01T10:00:00.000Z'),
          paidAt: new Date('2026-09-01T10:05:00.000Z'),
          fulfilledAt: new Date('2026-09-01T10:40:00.000Z'),
        }),
      ],
    });

    const feed = await rig.service.list('customer-7');

    expect(feed.items.map((item) => item.kind)).toEqual([
      'ORDER_DELIVERED',
      'ORDER_PAID',
      'ORDER_PLACED',
    ]);
    expect(feed.items[0]).toMatchObject({
      id: 'order:order-1:delivered',
      title: 'سفارش BP-2026-000001 تحویل شد',
      href: '/account/orders/order-1',
      createdAt: '2026-09-01T10:40:00.000Z',
    });
  });

  it('announces an order that failed, dated by its last write', async () => {
    const rig = buildRig({
      orders: [
        order({
          status: 'FAILED',
          placedAt: new Date('2026-09-01T10:00:00.000Z'),
          updatedAt: new Date('2026-09-01T10:12:00.000Z'),
        }),
      ],
    });

    const feed = await rig.service.list('customer-7');

    expect(feed.items[0]).toMatchObject({
      id: 'order:order-1:failed',
      kind: 'ORDER_FAILED',
      createdAt: '2026-09-01T10:12:00.000Z',
    });
  });

  it('says nothing about an order that has not been placed yet', async () => {
    const rig = buildRig({ orders: [order({ status: 'AWAITING_PAYMENT' })] });

    const feed = await rig.service.list('customer-7');

    expect(feed.items).toEqual([]);
  });
});

describe('NotificationsService / refund events', () => {
  const requested = {
    id: 'refund-1',
    orderId: 'order-1',
    requestedAt: new Date('2026-09-02T08:00:00.000Z'),
    order: { orderNumber: 'BP-2026-000001' },
  };

  it('stays silent while a refund is only approved', async () => {
    const rig = buildRig({
      refunds: [{ ...requested, status: 'APPROVED', processedAt: null }],
    });

    const feed = await rig.service.list('customer-7');

    expect(feed.items.map((item) => item.kind)).toEqual(['REFUND_REQUESTED']);
  });

  it('adds an outcome line once the money has moved', async () => {
    const rig = buildRig({
      refunds: [
        {
          ...requested,
          status: 'COMPLETED',
          processedAt: new Date('2026-09-03T09:30:00.000Z'),
        },
      ],
    });

    const feed = await rig.service.list('customer-7');

    expect(feed.items.map((item) => item.kind)).toEqual(['REFUND_COMPLETED', 'REFUND_REQUESTED']);
    expect(feed.items[0]).toMatchObject({
      id: 'refund:refund-1:completed',
      href: '/account/orders/order-1',
      createdAt: '2026-09-03T09:30:00.000Z',
    });
  });
});

describe('NotificationsService / support replies', () => {
  it('carries the ticket subject and links to the conversation', async () => {
    const rig = buildRig({
      replies: [
        {
          id: 'message-9',
          ticketId: 'ticket-3',
          createdAt: new Date('2026-09-04T12:00:00.000Z'),
          ticket: { workItem: { title: 'پیگیری کد گیفت‌کارت' } },
        },
      ],
    });

    const feed = await rig.service.list('customer-7');

    expect(feed.items[0]).toEqual({
      id: 'support:message-9',
      kind: 'SUPPORT_REPLY',
      title: 'پاسخ جدید پشتیبانی',
      body: 'پیگیری کد گیفت‌کارت',
      href: '/account/support/ticket-3',
      createdAt: '2026-09-04T12:00:00.000Z',
    });
  });
});

describe('NotificationsService / merge', () => {
  it('interleaves the three sources by time and caps the list at twenty', async () => {
    const rig = buildRig({
      orders: Array.from({ length: 12 }, (_, index) =>
        order({
          id: `order-${index}`,
          orderNumber: `BP-2026-00${index}`,
          status: 'PAID',
          placedAt: new Date(Date.UTC(2026, 8, 1, index)),
          paidAt: new Date(Date.UTC(2026, 8, 1, index, 30)),
        }),
      ),
      replies: [
        {
          id: 'message-1',
          ticketId: 'ticket-1',
          createdAt: new Date('2026-09-01T11:15:00.000Z'),
          ticket: { workItem: { title: 'سؤال دربارهٔ سفارش' } },
        },
      ],
    });

    const feed = await rig.service.list('customer-7');

    expect(feed.items).toHaveLength(20);
    const timestamps = feed.items.map((item) => item.createdAt);
    expect([...timestamps].sort().reverse()).toEqual(timestamps);
    /* The reply is newer than most of the order events, so the cap must not be
     * able to drop it just because it came from a different query. */
    expect(feed.items.some((item) => item.kind === 'SUPPORT_REPLY')).toBe(true);
    expect(feed.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('gives the same event the same id on every request', async () => {
    const seed: Seed = {
      orders: [order({ paidAt: new Date('2026-09-01T10:05:00.000Z'), status: 'PAID' })],
    };

    const first = await buildRig(seed).service.list('customer-7');
    const second = await buildRig(seed).service.list('customer-7');

    expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
  });
});
