import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import type { GiftCardAssetService } from '../fulfillment/gift-card-asset.service';
import {
  CANCELLABLE_ORDER_STATUSES,
  LIVE_PAYMENT_STATUSES,
  PAYMENT_WINDOW_MS,
  paymentDeadline,
  paymentWindowElapsed,
} from './order-payment-window';
import { OrderPaymentWindowService } from './order-payment-window.service';
import { ALLOWED_TRANSITIONS, OrderStateMachine } from './order-state-machine';
import { OrdersService } from './orders.service';
import type { OrdersDatabase } from './orders.tokens';

/* ============================================================================
 * The payment window
 *
 * Two things are being protected here, and they pull in opposite directions:
 * an order nobody paid for must not stay open forever, and an order somebody
 * DID pay for must never be closed. Every test below is about one of the two.
 * ==========================================================================*/

const PLACED_AT = new Date('2026-09-20T10:00:00.000Z');
const AMOUNT = 1_234_500n;

/** The order shape the cancel guard selects, plus what the DTO mapper needs. */
function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    orderNumber: 'BP-2026-000001',
    customerId: 'customer-1',
    quoteId: 'quote-1',
    cartId: null,
    status: 'AWAITING_PAYMENT',
    totalAmountIrr: AMOUNT,
    displayAmountToman: AMOUNT / 10n,
    currency: 'IRR',
    failureReason: null,
    createdAt: PLACED_AT,
    placedAt: PLACED_AT,
    paidAt: null,
    fulfilledAt: null,
    cancelledAt: null,
    /* Narrowed to live sessions by the query, so a non-empty array means the
     * gateway may still report on this order. */
    payments: [],
    quote: {
      id: 'quote-1',
      skuId: 'sku-1',
      serviceId: null,
      quantity: 1,
      finalAmountIrr: AMOUNT,
      sku: { denominationLabel: '$50', region: 'US', product: { titleFa: 'گیفت‌کارت' } },
      service: null,
    },
    giftCardAssets: [],
    ...overrides,
  };
}

type Mock = ReturnType<typeof vi.fn>;

function harness(): {
  readonly service: OrdersService;
  readonly db: {
    order: {
      findFirst: Mock;
      findMany: Mock;
      findUnique: Mock;
      updateMany: Mock;
    };
    auditLog: { findMany: Mock; create: Mock };
  };
} {
  const db = {
    order: {
      findFirst: vi.fn().mockResolvedValue(orderRow()),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(orderRow()),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    quote: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
  const database = {
    ...db,
    $transaction: vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  } as unknown as OrdersDatabase;

  const audit = { record: vi.fn() } as unknown as AuditService;
  const assets = { readSecret: vi.fn() } as unknown as GiftCardAssetService;
  return {
    service: new OrdersService(database, new OrderStateMachine(database), audit, assets),
    db: db as never,
  };
}

const actor = { customerId: 'customer-1' } as const;

/* ============================================================================
 * The window itself
 * ==========================================================================*/

describe('payment window', () => {
  it('closes ten minutes after the order is placed', () => {
    expect(PAYMENT_WINDOW_MS).toBe(600_000);
    expect(paymentDeadline({ placedAt: PLACED_AT, createdAt: PLACED_AT })).toEqual(
      new Date('2026-09-20T10:10:00.000Z'),
    );
  });

  it('measures from creation while the order has not been placed yet', () => {
    /* `placedAt` is stamped by the AWAITING_PAYMENT transition, so a DRAFT row
     * read mid-creation has none. It must not be treated as "never expires". */
    expect(paymentDeadline({ placedAt: null, createdAt: PLACED_AT })).toEqual(
      new Date('2026-09-20T10:10:00.000Z'),
    );
  });

  it('has not elapsed one second before the deadline, and has one second after', () => {
    const order = { placedAt: PLACED_AT, createdAt: PLACED_AT };
    expect(paymentWindowElapsed(order, new Date('2026-09-20T10:09:59.000Z'))).toBe(false);
    expect(paymentWindowElapsed(order, new Date('2026-09-20T10:10:01.000Z'))).toBe(true);
  });

  it('only names statuses the order state machine can actually leave for CANCELLED', () => {
    /* If someone widens the cancellable set to a status the machine refuses,
     * the sweep would throw on every pass instead of cancelling anything. */
    for (const status of CANCELLABLE_ORDER_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toContain('CANCELLED');
    }
  });

  it('treats every pre-outcome payment status as live', () => {
    /* These are exactly the statuses from which a payment can still become
     * PAID. Dropping one would let an order be cancelled under a live session. */
    expect([...LIVE_PAYMENT_STATUSES].sort()).toEqual(['CREATED', 'PENDING', 'REDIRECTED']);
  });
});

/* ============================================================================
 * The customer's own cancel
 * ==========================================================================*/

describe('cancelOrderForCustomer', () => {
  it('cancels an order that is still awaiting payment', async () => {
    const rig = harness();
    await rig.service.cancelOrderForCustomer('BP-2026-000001', actor);

    expect(rig.db.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'AWAITING_PAYMENT' },
      data: expect.objectContaining({ status: 'CANCELLED', cancelledAt: expect.any(Date) }),
    });
  });

  it('records the customer as the actor on the audit row', async () => {
    const rig = harness();
    await rig.service.cancelOrderForCustomer('BP-2026-000001', actor);

    expect(rig.db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: 'customer-1',
        actorType: 'CUSTOMER',
        action: 'ORDER_STATUS_CHANGED',
        entity: 'Order',
        entityId: 'order-1',
      }),
    });
  });

  it('scopes the lookup to the session customer, never to the path', async () => {
    const rig = harness();
    await rig.service.cancelOrderForCustomer('BP-2026-000001', actor);

    expect(rig.db.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderNumber: 'BP-2026-000001', customerId: 'customer-1' },
      }),
    );
  });

  it("reports another customer's order as missing rather than forbidden", async () => {
    const rig = harness();
    rig.db.order.findFirst.mockResolvedValue(null);

    await expect(rig.service.cancelOrderForCustomer('BP-2026-000001', actor)).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    expect(rig.db.order.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel a paid order', async () => {
    const rig = harness();
    rig.db.order.findFirst.mockResolvedValue(
      orderRow({ status: 'PAID', paidAt: new Date('2026-09-20T10:05:00.000Z') }),
    );

    await expect(rig.service.cancelOrderForCustomer('BP-2026-000001', actor)).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
    expect(rig.db.order.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order that was paid but has not moved status yet', async () => {
    /* `paidAt` is written in the same transaction as the PAID status, but a
     * read that caught only one of them must still refuse. */
    const rig = harness();
    rig.db.order.findFirst.mockResolvedValue(
      orderRow({ status: 'PAYMENT_PENDING', paidAt: new Date('2026-09-20T10:05:00.000Z') }),
    );

    await expect(rig.service.cancelOrderForCustomer('BP-2026-000001', actor)).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
    expect(rig.db.order.updateMany).not.toHaveBeenCalled();
  });

  it('refuses while a payment session is live at the gateway', async () => {
    const rig = harness();
    rig.db.order.findFirst.mockResolvedValue(
      orderRow({ status: 'PAYMENT_PENDING', payments: [{ id: 'payment-1' }] }),
    );

    await expect(rig.service.cancelOrderForCustomer('BP-2026-000001', actor)).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
    expect(rig.db.order.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to cancel an order that is already being fulfilled', async () => {
    const rig = harness();
    rig.db.order.findFirst.mockResolvedValue(
      orderRow({ status: 'FULFILLING', paidAt: new Date('2026-09-20T10:05:00.000Z') }),
    );

    await expect(rig.service.cancelOrderForCustomer('BP-2026-000001', actor)).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
  });

  it('is a no-op on an order that is already cancelled', async () => {
    const rig = harness();
    rig.db.order.findFirst.mockResolvedValue(orderRow({ status: 'CANCELLED' }));

    await expect(
      rig.service.cancelOrderForCustomer('BP-2026-000001', actor),
    ).resolves.toBeDefined();
    /* No second transition, and therefore no second audit row, for a customer
     * who clicked the button twice. */
    expect(rig.db.order.updateMany).not.toHaveBeenCalled();
    expect(rig.db.auditLog.create).not.toHaveBeenCalled();
  });
});

/* ============================================================================
 * The sweep
 * ==========================================================================*/

describe('cancelExpiredOrders', () => {
  const now = new Date('2026-09-20T10:20:00.000Z');

  it('asks only for unpaid, cancellable orders past the deadline with no live payment', async () => {
    const rig = harness();
    await rig.service.cancelExpiredOrders({ now });

    const where = rig.db.order.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where['status']).toEqual({ in: ['AWAITING_PAYMENT', 'PAYMENT_PENDING'] });
    expect(where['paidAt']).toBeNull();
    expect(where['payments']).toEqual({
      none: { status: { in: ['CREATED', 'REDIRECTED', 'PENDING'] } },
    });
    /* The cutoff is one window back from now, applied to whichever timestamp
     * the order actually carries. */
    expect(where['OR']).toEqual([
      { placedAt: { lte: new Date('2026-09-20T10:10:00.000Z') } },
      { placedAt: null, createdAt: { lte: new Date('2026-09-20T10:10:00.000Z') } },
    ]);
  });

  it('cancels each expired order and reports the count', async () => {
    const rig = harness();
    rig.db.order.findMany.mockResolvedValue([
      orderRow({ id: 'order-1' }),
      orderRow({ id: 'order-2', orderNumber: 'BP-2026-000002' }),
    ]);

    await expect(rig.service.cancelExpiredOrders({ now })).resolves.toEqual({
      scanned: 2,
      cancelled: 2,
    });
    expect(rig.db.order.updateMany).toHaveBeenCalledTimes(2);
  });

  it('attributes the cancellation to the system, not to the customer', async () => {
    const rig = harness();
    rig.db.order.findMany.mockResolvedValue([orderRow()]);

    await rig.service.cancelExpiredOrders({ now });

    expect(rig.db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: 'system:order-payment-window',
        actorType: 'SYSTEM',
        action: 'ORDER_STATUS_CHANGED',
      }),
    });
  });

  it('keeps sweeping when one order loses the race to a payment', async () => {
    const rig = harness();
    rig.db.order.findMany.mockResolvedValue([
      orderRow({ id: 'order-1' }),
      orderRow({ id: 'order-2', orderNumber: 'BP-2026-000002' }),
      orderRow({ id: 'order-3', orderNumber: 'BP-2026-000003' }),
    ]);
    /* The middle order was paid between the query and its transition: the
     * conditional update matches nothing and the row now reads PAID. */
    rig.db.order.updateMany.mockImplementation((args: { where: { id: string } }) =>
      args.where.id === 'order-2' ? { count: 0 } : { count: 1 },
    );
    rig.db.order.findUnique.mockResolvedValue({ status: 'PAID' });

    await expect(rig.service.cancelExpiredOrders({ now })).resolves.toEqual({
      scanned: 3,
      cancelled: 2,
    });
  });

  it('does not count an order another pass had already cancelled', async () => {
    const rig = harness();
    rig.db.order.findMany.mockResolvedValue([orderRow()]);
    rig.db.order.updateMany.mockResolvedValue({ count: 0 });
    rig.db.order.findUnique.mockResolvedValue({ status: 'CANCELLED' });

    await expect(rig.service.cancelExpiredOrders({ now })).resolves.toEqual({
      scanned: 1,
      cancelled: 0,
    });
  });

  it('bounds the batch so a backlog is paced rather than swallowed whole', async () => {
    const rig = harness();
    await rig.service.cancelExpiredOrders({ now });

    expect(rig.db.order.findMany.mock.calls[0]?.[0]?.take).toBe(100);
  });
});

/* ============================================================================
 * The timer around the sweep
 * ==========================================================================*/

describe('OrderPaymentWindowService', () => {
  function sweeper(cancelExpiredOrders: Mock): OrderPaymentWindowService {
    return new OrderPaymentWindowService({ cancelExpiredOrders } as unknown as OrdersService);
  }

  it('runs a pass and passes the result through', async () => {
    const sweep = vi.fn().mockResolvedValue({ scanned: 3, cancelled: 2 });

    await expect(sweeper(sweep).sweepOnce()).resolves.toEqual({ scanned: 3, cancelled: 2 });
  });

  it('does not stack a second pass on top of a slow one', async () => {
    let release: () => void = () => {};
    const sweep = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ scanned: 1, cancelled: 1 });
        }),
    );
    const service = sweeper(sweep as unknown as Mock);

    const first = service.sweepOnce();
    const second = await service.sweepOnce();
    expect(second).toEqual({ scanned: 0, cancelled: 0 });
    expect(sweep).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('frees the in-flight latch when a pass throws, so the next tick still runs', async () => {
    const sweep = vi.fn().mockRejectedValue(new Error('database is away'));
    const service = sweeper(sweep);

    await expect(service.sweepOnce()).rejects.toThrow('database is away');
    sweep.mockResolvedValue({ scanned: 0, cancelled: 0 });
    await expect(service.sweepOnce()).resolves.toEqual({ scanned: 0, cancelled: 0 });
  });

  it('stops its timer on shutdown', () => {
    const service = sweeper(vi.fn().mockResolvedValue({ scanned: 0, cancelled: 0 }));
    service.onApplicationBootstrap();
    service.onApplicationShutdown();

    /* A second shutdown must not throw on the cleared timer. */
    expect(() => service.onApplicationShutdown()).not.toThrow();
  });
});
