import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff } from '../identity/identity.tokens';
import { OrderStateMachine } from '../orders/order-state-machine';
import type { OrdersDatabase } from '../orders/orders.tokens';
import { RefundsService, type RefundsDatabase } from './refunds.service';

type Row = Record<string, unknown>;

/* A small in-memory slice of the tables refund processing touches, with the
 * conditional updates evaluated for real so a stale approval cannot pass. */
class RefundsFake {
  readonly refunds: Row[] = [];
  readonly payments: Row[] = [];
  readonly orders: Row[] = [];
  readonly issues: Row[] = [];
  readonly auditLog: Row[] = [];

  private match(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === 'object' && Array.isArray((value as Row)['in'])) {
        return ((value as Row)['in'] as unknown[]).includes(row[key]);
      }
      return row[key] === value;
    });
  }

  private withIncludes(row: Row): Row {
    const order = this.orders.find((candidate) => candidate['id'] === row['orderId']);
    const payment = this.payments.find((candidate) => candidate['id'] === row['paymentId']);
    return {
      ...row,
      order: order ? { ...order } : null,
      payment: payment ? { status: payment['status'], provider: payment['provider'] } : null,
      requestedBy: row['requestedByStaffId'] ? { fullName: `Staff ${String(row['requestedByStaffId'])}` } : null,
      approvedBy: row['approvedByStaffId'] ? { fullName: `Staff ${String(row['approvedByStaffId'])}` } : null,
    };
  }

  private table(rows: Row[], includes: boolean) {
    return {
      findUnique: async (args: Row) => {
        const row = rows.find((candidate) => this.match(candidate, args['where'] as Row));
        if (!row) return null;
        return includes && args['include'] ? this.withIncludes(row) : { ...row };
      },
      findFirst: async (args: Row) => {
        const row = rows.find((candidate) => this.match(candidate, args['where'] as Row));
        return row ? { ...row } : null;
      },
      findMany: async (args: Row) =>
        rows.filter((candidate) => this.match(candidate, args['where'] as Row)).map((row) => this.withIncludes(row)),
      updateMany: async (args: Row) => {
        const matched = rows.filter((candidate) => this.match(candidate, args['where'] as Row));
        for (const row of matched) Object.assign(row, args['data'] as Row);
        return { count: matched.length };
      },
      create: async (args: Row) => {
        const row = { id: `row-${rows.length + 1}`, ...(args['data'] as Row) };
        rows.push(row);
        return row;
      },
    };
  }

  readonly refund = this.table(this.refunds, true);
  readonly payment = this.table(this.payments, false);
  readonly order = this.table(this.orders, false);
  readonly reconciliationIssue = this.table(this.issues, false);
  readonly auditLogTable = this.table(this.auditLog, false);

  async $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    const backup = [this.refunds, this.payments, this.orders, this.issues].map((rows) => rows.map((row) => ({ ...row })));
    try {
      return await callback(this.asTransaction());
    } catch (error) {
      [this.refunds, this.payments, this.orders, this.issues].forEach((rows, index) => {
        rows.splice(0, rows.length, ...backup[index]!);
      });
      throw error;
    }
  }

  asTransaction(): unknown {
    return {
      refund: this.refund,
      payment: this.payment,
      order: this.order,
      reconciliationIssue: this.reconciliationIssue,
      auditLog: this.auditLogTable,
    };
  }
}

const REQUESTER: AuthenticatedStaff = { type: 'STAFF', staffId: 'op-1', role: 'OPERATOR' as never, email: 'op@x.test' };
const FINANCE: AuthenticatedStaff = { type: 'STAFF', staffId: 'fin-1', role: 'FINANCE', email: 'fin@x.test' };

function harness(seed: { refund: Row; order: Row; payment?: Row }) {
  const fake = new RefundsFake();
  fake.orders.push({ orderNumber: 'BP-1', ...seed.order });
  if (seed.payment) fake.payments.push({ provider: 'zarinpal', ...seed.payment });
  fake.refunds.push({
    requestedAt: new Date(),
    processedAt: null,
    providerRefundRef: null,
    approvedByStaffId: null,
    paymentId: null,
    ...seed.refund,
  });
  fake.issues.push({ id: 'issue-1', paymentId: seed.payment?.['id'] ?? null, type: 'duplicate_payment', status: 'OPEN', openDedupeKey: 'k' });
  const audit = vi.fn(async () => undefined);
  const states = new OrderStateMachine(fake as unknown as OrdersDatabase);
  const service = new RefundsService(fake as unknown as RefundsDatabase, states, { record: audit } as unknown as AuditService);
  return { fake, service, audit };
}

describe('RefundsService (PAY-10)', () => {
  it('refuses to let the requester approve their own refund', async () => {
    const { service, fake } = harness({
      refund: { id: 'r1', orderId: 'o1', amountIrr: 100n, reason: 'customer asked', status: 'REQUESTED', requestedByStaffId: 'op-1' },
      order: { id: 'o1', status: 'REFUND_PENDING' },
    });

    await expect(service.approve('r1', REQUESTER)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(fake.refunds[0]?.['status']).toBe('REQUESTED');
  });

  it('approval by a second person ties a full refund to the paid payment', async () => {
    const { service, audit } = harness({
      refund: { id: 'r1', orderId: 'o1', amountIrr: 100n, reason: 'customer asked', status: 'REQUESTED', requestedByStaffId: 'op-1' },
      order: { id: 'o1', status: 'REFUND_PENDING' },
      payment: { id: 'p1', orderId: 'o1', status: 'PAID', amountIrr: 100n },
    });

    const dto = await service.approve('r1', FINANCE);

    expect(dto).toMatchObject({ status: 'APPROVED', approvedByStaffId: 'fin-1', paymentId: 'p1', paymentStatus: 'REFUND_PENDING' });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'REFUND_APPROVED', entityId: 'r1' }));
  });

  it('a partial refund leaves the payment PAID', async () => {
    const { service, fake } = harness({
      refund: { id: 'r1', orderId: 'o1', amountIrr: 40n, reason: 'partial', status: 'REQUESTED', requestedByStaffId: 'op-1' },
      order: { id: 'o1', status: 'REFUND_PENDING' },
      payment: { id: 'p1', orderId: 'o1', status: 'PAID', amountIrr: 100n },
    });

    await service.approve('r1', FINANCE);

    expect(fake.refunds[0]?.['paymentId']).toBeNull();
    expect(fake.payments[0]?.['status']).toBe('PAID');
  });

  it('completion needs approval first, then records the transfer and refunds payment and order', async () => {
    const { service, fake } = harness({
      refund: { id: 'r1', orderId: 'o1', amountIrr: 100n, reason: 'customer asked', status: 'REQUESTED', requestedByStaffId: 'op-1' },
      order: { id: 'o1', status: 'REFUND_PENDING' },
      payment: { id: 'p1', orderId: 'o1', status: 'PAID', amountIrr: 100n },
    });

    await expect(service.complete('r1', 'TRX-123456', FINANCE)).rejects.toMatchObject({ code: 'CONFLICT' });

    await service.approve('r1', FINANCE);
    const dto = await service.complete('r1', 'TRX-123456', FINANCE);

    expect(dto).toMatchObject({ status: 'COMPLETED', bankReference: 'TRX-123456', paymentStatus: 'REFUNDED' });
    expect(fake.orders[0]?.['status']).toBe('REFUNDED');
    expect(fake.auditLog.some((row) => row['action'] === 'ORDER_STATUS_CHANGED')).toBe(true);

    // Replaying the same completion is a no-op, not an error.
    await expect(service.complete('r1', 'TRX-123456', FINANCE)).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('completing a second-capture refund settles that payment and its issue, but leaves the order alone', async () => {
    const { service, fake } = harness({
      refund: { id: 'r1', orderId: 'o1', paymentId: 'p2', amountIrr: 100n, reason: 'DUPLICATE_PAYMENT_FOR_ORDER', status: 'REQUESTED', requestedByStaffId: null },
      order: { id: 'o1', status: 'FULFILLED' },
      payment: { id: 'p2', orderId: 'o1', status: 'REFUND_PENDING', amountIrr: 100n },
    });

    await service.approve('r1', FINANCE);
    await service.complete('r1', 'TRX-999999', FINANCE);

    expect(fake.payments[0]?.['status']).toBe('REFUNDED');
    expect(fake.orders[0]?.['status']).toBe('FULFILLED');
    expect(fake.issues[0]).toMatchObject({ status: 'RESOLVED', openDedupeKey: null, resolvedByStaffId: 'fin-1' });
  });

  it('rejecting sends the order back to review, but a second capture cannot be rejected', async () => {
    const ordinary = harness({
      refund: { id: 'r1', orderId: 'o1', amountIrr: 100n, reason: 'customer asked', status: 'REQUESTED', requestedByStaffId: 'op-1' },
      order: { id: 'o1', status: 'REFUND_PENDING' },
    });
    await ordinary.service.reject('r1', 'Delivered successfully, checked with customer', FINANCE);
    expect(ordinary.fake.refunds[0]?.['status']).toBe('REJECTED');
    expect(ordinary.fake.orders[0]?.['status']).toBe('REVIEW_REQUIRED');

    const duplicate = harness({
      refund: { id: 'r2', orderId: 'o1', paymentId: 'p2', amountIrr: 100n, reason: 'DUPLICATE_PAYMENT_FOR_ORDER', status: 'REQUESTED', requestedByStaffId: null },
      order: { id: 'o1', status: 'FULFILLED' },
      payment: { id: 'p2', orderId: 'o1', status: 'REFUND_PENDING', amountIrr: 100n },
    });
    await expect(duplicate.service.reject('r2', 'We would rather keep it', FINANCE)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
