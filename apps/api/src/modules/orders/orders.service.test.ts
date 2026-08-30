import { describe, expect, it, vi } from 'vitest';
import type { CreateOrderRequest, IrrString } from '@barat/contracts';

import type { AuditService } from '../audit/audit.service';
import { OrderStateMachine } from './order-state-machine';
import { OrdersService, uniqueViolationTargets } from './orders.service';
import type { OrdersDatabase } from './orders.tokens';

const QUOTE_AMOUNT = 1_234_500n;

function request(overrides: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return {
    quoteId: 'quote-1',
    idempotencyKey: 'idem-key-0123456789',
    acknowledgedAmountIrr: QUOTE_AMOUNT.toString() as IrrString,
    ...overrides,
  } as CreateOrderRequest;
}

function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    orderNumber: 'BP-2026-000001',
    customerId: 'customer-1',
    quoteId: 'quote-1',
    cartId: null,
    status: 'AWAITING_PAYMENT',
    totalAmountIrr: QUOTE_AMOUNT,
    displayAmountToman: QUOTE_AMOUNT / 10n,
    currency: 'IRR',
    failureReason: null,
    createdAt: new Date('2026-08-30T10:00:00.000Z'),
    paidAt: null,
    fulfilledAt: null,
    cancelledAt: null,
    quote: {
      id: 'quote-1',
      skuId: 'sku-1',
      serviceId: null,
      quantity: 1,
      finalAmountIrr: QUOTE_AMOUNT,
      sku: { denominationLabel: '$50', region: 'US', product: { titleFa: 'گیفت‌کارت' } },
      service: null,
    },
    giftCardAssets: [],
    ...overrides,
  };
}

type Mock = ReturnType<typeof vi.fn>;

interface Harness {
  readonly service: OrdersService;
  readonly db: {
    order: {
      findUnique: Mock;
      findFirst: Mock;
      findUniqueOrThrow: Mock;
      findMany: Mock;
      count: Mock;
      create: Mock;
      updateMany: Mock;
    };
    quote: { findUnique: Mock };
    auditLog: { findMany: Mock; create: Mock };
  };
  readonly record: Mock;
  readonly transaction: Mock;
}

function harness(quote: Record<string, unknown> | null): Harness {
  const db = {
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(orderRow()),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(orderRow({ status: 'DRAFT' })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    quote: { findUnique: vi.fn().mockResolvedValue(quote) },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
  const transaction = vi.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db));
  const database = {
    ...db,
    $transaction: transaction,
  } as unknown as OrdersDatabase;

  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;
  return {
    service: new OrdersService(database, new OrderStateMachine(database), audit),
    db,
    record,
    transaction,
  };
}

const acceptedQuote = {
  id: 'quote-1',
  customerId: 'customer-1',
  cartId: null,
  status: 'ACCEPTED',
  expiresAt: new Date('2999-01-01T00:00:00.000Z'),
  finalAmountIrr: QUOTE_AMOUNT,
  displayAmountToman: QUOTE_AMOUNT / 10n,
};

const actor = { customerId: 'customer-1' };

describe('OrdersService.createOrder', () => {
  it('copies the total from the quote instead of trusting the request', async () => {
    const { service, db } = harness(acceptedQuote);

    await service.createOrder(request(), actor);

    expect(db.order.create.mock.calls[0]?.[0].data).toMatchObject({
      totalAmountIrr: QUOTE_AMOUNT,
      displayAmountToman: QUOTE_AMOUNT / 10n,
      quoteId: 'quote-1',
      status: 'DRAFT',
    });
  });

  it('refuses and audits when the acknowledged amount differs from the quote', async () => {
    const { service, db, record } = harness(acceptedQuote);

    await expect(
      service.createOrder(request({ acknowledgedAmountIrr: '999' as IrrString }), actor),
    ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });

    /* Nothing may be written when the amounts disagree. */
    expect(db.order.create).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AMOUNT_MISMATCH',
        entity: 'Quote',
        before: { quoteFinalAmountIrr: QUOTE_AMOUNT.toString() },
        after: { acknowledgedAmountIrr: '999' },
      }),
    );
  });

  it('aborts the write when the row that came back disagrees with the quote', async () => {
    const { service, db } = harness(acceptedQuote);
    /* Simulate a trigger or a default rewriting the amount underneath us. */
    db.order.create.mockResolvedValue(orderRow({ status: 'DRAFT', totalAmountIrr: 1n }));

    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({
      code: 'AMOUNT_MISMATCH',
    });
  });

  it('refuses an expired quote', async () => {
    const { service } = harness({
      ...acceptedQuote,
      status: 'ACTIVE',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({
      code: 'QUOTE_EXPIRED',
    });
  });

  it('refuses a quote that was never accepted', async () => {
    const { service } = harness({ ...acceptedQuote, status: 'ACTIVE' });
    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("reports another customer's quote as missing rather than forbidden", async () => {
    const { service } = harness({ ...acceptedQuote, customerId: 'customer-2' });
    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('allows the owner of an anonymous commerce session to order its accepted quote', async () => {
    const commerceSessionToken = 'commerce-session-token-1234';
    const { service, db } = harness({
      ...acceptedQuote,
      customerId: null,
      commerceSessionId: 'commerce-session-1',
      commerceSession: { customerId: null, sessionToken: commerceSessionToken },
    });

    const result = await service.createOrder(request({ commerceSessionToken }), actor);

    expect(result.created).toBe(true);
    expect(db.order.create).toHaveBeenCalledTimes(1);
  });

  it('does not let a customer claim an anonymous quote without its commerce session', async () => {
    const { service, db } = harness({
      ...acceptedQuote,
      customerId: null,
      commerceSessionId: 'commerce-session-1',
      commerceSession: {
        customerId: null,
        sessionToken: 'commerce-session-token-1234',
      },
    });

    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it('replays an idempotency key without creating a second order', async () => {
    const { service, db } = harness(acceptedQuote);
    db.order.findUnique.mockResolvedValue(orderRow());

    const result = await service.createOrder(request(), actor);

    expect(result.created).toBe(false);
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("refuses a key that was used for someone else's order", async () => {
    const { service, db } = harness(acceptedQuote);
    db.order.findUnique.mockResolvedValue(orderRow({ customerId: 'customer-2' }));

    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('refuses a second order for a quote that already has one', async () => {
    const { service, db } = harness(acceptedQuote);
    db.order.findFirst.mockResolvedValue({ id: 'order-existing' });

    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it('maps exhausted serializable transaction conflicts to a safe domain conflict', async () => {
    const { service, transaction } = harness(acceptedQuote);
    transaction.mockRejectedValue({ code: 'P2034' });

    await expect(service.createOrder(request(), actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(transaction).toHaveBeenCalledTimes(5);
  });
});

describe('OrdersService payments bridge', () => {
  it('advances an order to PAID through the state machine', async () => {
    const { service, db } = harness(acceptedQuote);
    db.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'BP-2026-000001',
      status: 'PAYMENT_PENDING',
    });

    const result = await service.markPaid('order-1', 'payment-1');

    expect(result).toMatchObject({ status: 'PAID', changed: true });
    expect(db.order.updateMany.mock.calls[0]?.[0].where).toEqual({
      id: 'order-1',
      status: 'PAYMENT_PENDING',
    });
  });

  it('refuses to mark an unpaid-path order as PAID from a terminal state', async () => {
    const { service, db } = harness(acceptedQuote);
    db.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'BP-2026-000001',
      status: 'CANCELLED',
    });

    await expect(service.markPaid('order-1', 'payment-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('ignores late pending and failed callbacks once verified payment exists', async () => {
    const { service, db } = harness(acceptedQuote);
    db.order.findUnique.mockResolvedValue({
      id: 'order-1',
      orderNumber: 'BP-2026-000001',
      status: 'FULFILLING',
      paidAt: new Date('2026-08-30T10:05:00.000Z'),
    });

    await expect(service.markPaymentPending('order-1', 'payment-1')).resolves.toMatchObject({
      status: 'FULFILLING',
      changed: false,
    });
    await expect(
      service.markPaymentFailed('order-1', 'payment-1', 'late callback'),
    ).resolves.toMatchObject({ status: 'FULFILLING', changed: false });
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });
});

describe('uniqueViolationTargets', () => {
  it('reads the constraint columns off a P2002', () => {
    expect(uniqueViolationTargets({ code: 'P2002', meta: { target: ['idempotencyKey'] } })).toEqual(
      ['idempotencyKey'],
    );
    expect(uniqueViolationTargets({ code: 'P2002', meta: { target: 'orderNumber' } })).toEqual([
      'orderNumber',
    ]);
  });

  it('returns null for anything that is not a unique violation', () => {
    expect(uniqueViolationTargets(new Error('boom'))).toBeNull();
    expect(uniqueViolationTargets({ code: 'P2025' })).toBeNull();
    expect(uniqueViolationTargets(null)).toBeNull();
  });
});
