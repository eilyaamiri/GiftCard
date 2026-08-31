import { describe, expect, it, vi } from 'vitest';
import type { OrderStatus } from '@barat/contracts';
import { ORDER_STATUS_VALUES } from '@barat/contracts';

import {
  ALLOWED_TRANSITIONS,
  IllegalOrderTransition,
  ORDER_STATUS_CHANGED,
  OrderStateMachine,
  assertTransition,
  canTransition,
  isTerminalOrderStatus,
} from './order-state-machine';
import type { OrdersDatabase } from './orders.tokens';

/* Every ordered pair of statuses, so the table below is exhaustive by
 * construction rather than by whoever remembered to add a case. */
const ALL_PAIRS: ReadonlyArray<readonly [OrderStatus, OrderStatus]> = ORDER_STATUS_VALUES.flatMap(
  (from) => ORDER_STATUS_VALUES.map((to) => [from, to] as const),
);

const LEGAL_PAIRS = ALL_PAIRS.filter(([from, to]) => ALLOWED_TRANSITIONS[from].includes(to));
const ILLEGAL_PAIRS = ALL_PAIRS.filter(([from, to]) => !ALLOWED_TRANSITIONS[from].includes(to));

function machine(
  updated = 1,
  currentStatus: OrderStatus = 'REVIEW_REQUIRED',
): {
  readonly stateMachine: OrderStateMachine;
  readonly updateMany: ReturnType<typeof vi.fn>;
  readonly record: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn().mockResolvedValue({ count: updated });
  const record = vi.fn().mockResolvedValue({ id: 'audit-1' });
  const core = {
    order: {
      updateMany,
      findUnique: vi.fn().mockResolvedValue({ status: currentStatus }),
    },
    auditLog: { create: record },
  };
  const database = {
    ...core,
    $transaction: (callback: (db: unknown) => Promise<unknown>) => callback(core),
  } as unknown as OrdersDatabase;
  return { stateMachine: new OrderStateMachine(database), updateMany, record };
}

const order = { id: 'order-1', orderNumber: 'BP-2026-000001', status: 'PAID' as OrderStatus };
const actor = { id: 'staff-1', type: 'STAFF' as const };

describe('ALLOWED_TRANSITIONS', () => {
  it('covers every status exactly once', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ORDER_STATUS_VALUES].sort());
  });

  it('never lists a status as its own successor', () => {
    for (const status of ORDER_STATUS_VALUES) {
      expect(ALLOWED_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('leaves every terminal status with no way out', () => {
    for (const status of ORDER_STATUS_VALUES) {
      if (isTerminalOrderStatus(status)) {
        expect(ALLOWED_TRANSITIONS[status]).toEqual([]);
      }
    }
  });

  it('never lets a PAID order be cancelled: money has already moved', () => {
    expect(canTransition('PAID', 'CANCELLED')).toBe(false);
    expect(canTransition('PAID', 'REFUND_PENDING')).toBe(true);
  });

  it('never lets an order reach PAID from anything but a payment state', () => {
    const sources = ORDER_STATUS_VALUES.filter((from) => canTransition(from, 'PAID'));
    expect([...sources].sort()).toEqual(['AWAITING_PAYMENT', 'PAYMENT_PENDING']);
  });

  it('never lets an unpaid order be fulfilled', () => {
    expect(canTransition('AWAITING_PAYMENT', 'FULFILLMENT_PENDING')).toBe(false);
    expect(canTransition('DRAFT', 'FULFILLED')).toBe(false);
    expect(canTransition('PAYMENT_PENDING', 'FULFILLING')).toBe(false);
  });

  it('cannot reach a money-moved status from DRAFT without passing through PAID', () => {
    const reachableWithoutPaid = new Set<OrderStatus>(['DRAFT']);
    const pending: OrderStatus[] = ['DRAFT'];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      for (const next of ALLOWED_TRANSITIONS[current]) {
        if (next !== 'PAID' && !reachableWithoutPaid.has(next)) {
          reachableWithoutPaid.add(next);
          pending.push(next);
        }
      }
    }

    for (const status of [
      'FULFILLMENT_PENDING',
      'FULFILLING',
      'FULFILLED',
      'REVIEW_REQUIRED',
      'REFUND_PENDING',
      'REFUNDED',
    ] satisfies OrderStatus[]) {
      expect(reachableWithoutPaid).not.toContain(status);
    }
  });

  it('cannot reach cancellation or a pre-payment failure after PAID', () => {
    const reachable = new Set<OrderStatus>(['PAID']);
    const pending: OrderStatus[] = ['PAID'];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      for (const next of ALLOWED_TRANSITIONS[current]) {
        if (!reachable.has(next)) {
          reachable.add(next);
          pending.push(next);
        }
      }
    }

    expect(reachable).not.toContain('FAILED');
    expect(reachable).not.toContain('CANCELLED');
    expect(reachable).not.toContain('AWAITING_PAYMENT');
    expect(reachable).not.toContain('PAYMENT_PENDING');
  });
});

describe('assertTransition', () => {
  it.each(LEGAL_PAIRS)('permits %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(ILLEGAL_PAIRS)('refuses %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(IllegalOrderTransition);
  });
});

describe('OrderStateMachine.transition', () => {
  it('applies a legal transition conditionally on the status it read', async () => {
    const { stateMachine, updateMany } = machine();
    const now = new Date('2026-08-30T12:00:00.000Z');

    const result = await stateMachine.transition(order, 'FULFILLMENT_PENDING', actor, 'queued', {
      now,
    });

    expect(result).toEqual({
      orderId: 'order-1',
      orderNumber: 'BP-2026-000001',
      status: 'FULFILLMENT_PENDING',
      changed: true,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PAID' },
      data: { status: 'FULFILLMENT_PENDING' },
    });
  });

  it('stamps the timestamp the target status implies', async () => {
    const { stateMachine, updateMany } = machine();
    const now = new Date('2026-08-30T12:00:00.000Z');

    await stateMachine.transition({ ...order, status: 'PAYMENT_PENDING' }, 'PAID', actor, null, {
      now,
    });

    expect(updateMany.mock.calls[0]?.[0].data).toEqual({ status: 'PAID', paidAt: now });
  });

  it('writes exactly one audit row carrying both sides of the change', async () => {
    const { stateMachine, record } = machine();

    await stateMachine.transition(order, 'REVIEW_REQUIRED', actor, 'cost variance', {
      context: { paymentId: 'pay-1' },
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0].data).toMatchObject({
      action: ORDER_STATUS_CHANGED,
      entity: 'Order',
      entityId: 'order-1',
      before: { status: 'PAID' },
      after: { status: 'REVIEW_REQUIRED', reason: 'cost variance', paymentId: 'pay-1' },
    });
  });

  it('is idempotent when the order is already in the target state', async () => {
    const { stateMachine, updateMany, record } = machine();

    const result = await stateMachine.transition(order, 'PAID', actor);

    expect(result.changed).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('writes nothing at all when the transition is illegal', async () => {
    const { stateMachine, updateMany, record } = machine();

    await expect(stateMachine.transition(order, 'CANCELLED', actor)).rejects.toBeInstanceOf(
      IllegalOrderTransition,
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('treats a concurrent winner of the same transition as an idempotent replay', async () => {
    const { stateMachine, record } = machine(0, 'FULFILLMENT_PENDING');

    const result = await stateMachine.transition(order, 'FULFILLMENT_PENDING', actor);

    expect(result).toMatchObject({ status: 'FULFILLMENT_PENDING', changed: false });
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses, rather than retries, when another writer moved the order first', async () => {
    const { stateMachine, record } = machine(0);

    await expect(
      stateMachine.transition(order, 'FULFILLMENT_PENDING', actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    /* No audit row: nothing happened, so nothing may be claimed to have. */
    expect(record).not.toHaveBeenCalled();
  });
});
