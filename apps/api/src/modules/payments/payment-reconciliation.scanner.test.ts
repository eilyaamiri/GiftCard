import { describe, expect, it, vi } from 'vitest';
import { MockRialPaymentProvider, type RialPaymentProvider } from '@barat/payments';

import type { AuditService } from '../audit/audit.service';
import type { FulfillmentTrigger, WorkItemSummary } from '../workitems/workitems.types';
import {
  ABANDONED_SESSION_AFTER_MS,
  PaymentReconciliationScanner,
  RECHECK_INTERVAL_MS,
} from './payment-reconciliation.scanner';
import { FULFILLMENT_REPAIR_AFTER_MS, PaymentsService } from './payments.service';
import { FakeOrderBridge, FakePaymentDatabase, type Row } from './testing/fake-payment-database';

const MINUTE = 60_000;

function payment(overrides: Row): Row {
  return {
    orderId: 'order-1',
    customerId: 'cust-1',
    provider: 'mock',
    amountIrr: 5_000_000n,
    displayAmountToman: 500_000n,
    providerAuthority: `mock_${String(overrides['id'])}`,
    providerAmount: null,
    providerAmountUnit: null,
    liveOrderKey: null,
    paidOrderKey: null,
    verifyLeaseUntil: null,
    verifyLeaseToken: null,
    verifiedAt: null,
    failureReason: null,
    idempotencyKey: `key-${String(overrides['id'])}`,
    createdAt: new Date(),
    ...overrides,
  };
}

function setup(rows: Row[], provider: RialPaymentProvider = new MockRialPaymentProvider()) {
  const db = new FakePaymentDatabase({
    order: [{ id: 'order-1', orderNumber: 'BP-1', customerId: 'cust-1', status: 'PAYMENT_PENDING', paidAt: null }],
    payment: rows,
  });
  const trigger = vi.fn(async () => ({ id: 'wi' }) as unknown as WorkItemSummary);
  const service = new PaymentsService(
    provider,
    db,
    { record: vi.fn(async () => undefined) } as unknown as AuditService,
    { onOrderPaid: trigger } as FulfillmentTrigger,
    new FakeOrderBridge(db),
  );
  const scanner = new PaymentReconciliationScanner(service, db, provider);
  return { db, service, scanner, trigger };
}

describe('PaymentReconciliationScanner (PAY-6, PAY-7, ORD-10)', () => {
  it('asks the gateway about an abandoned session and leaves a fresh one alone', async () => {
    const provider = new MockRialPaymentProvider();
    const { db, scanner } = setup(
      [
        payment({ id: 'old', status: 'REDIRECTED', liveOrderKey: 'order-1', createdAt: new Date(Date.now() - ABANDONED_SESSION_AFTER_MS - MINUTE) }),
      ],
      provider,
    );
    provider.forceNextVerify('failure');

    const result = await scanner.sweepOnce();

    expect(result).toEqual({ checked: 1, changed: 1, failed: 0 });
    expect(db.paymentById('old')['status']).toBe('FAILED');
    expect(db.paymentById('old')['liveOrderKey']).toBeNull();

    // A session opened a minute ago is the customer still paying.
    db.tables.payment.push(payment({ id: 'fresh', status: 'REDIRECTED', createdAt: new Date(Date.now() - MINUTE) }));
    expect((await scanner.sweepOnce()).checked).toBe(0);
  });

  it('settles an UNKNOWN payment and then waits before asking about it again', async () => {
    const provider = new MockRialPaymentProvider();
    const { db, scanner, trigger } = setup([payment({ id: 'u1', status: 'UNKNOWN', createdAt: new Date(Date.now() - 10 * MINUTE) })], provider);
    provider.forceNextVerify('timeout');

    expect(await scanner.sweepOnce()).toEqual({ checked: 1, changed: 0, failed: 0 });
    expect(db.paymentById('u1')['status']).toBe('UNKNOWN');

    // Asked moments ago: skipped this pass.
    expect((await scanner.sweepOnce()).checked).toBe(0);

    for (const row of db.tables.paymentAttempt) row['createdAt'] = new Date(Date.now() - RECHECK_INTERVAL_MS - 1);
    expect(await scanner.sweepOnce()).toEqual({ checked: 1, changed: 1, failed: 0 });
    expect(db.paymentById('u1')['status']).toBe('PAID');
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('restarts fulfillment for a paid order that has none', async () => {
    const { db, scanner, trigger } = setup([
      payment({ id: 'p1', status: 'PAID', paidOrderKey: 'order-1', verifiedAt: new Date(Date.now() - FULFILLMENT_REPAIR_AFTER_MS - MINUTE) }),
    ]);
    db.tables.order[0]!['status'] = 'PAID';

    await scanner.sweepOnce();
    expect(trigger).toHaveBeenCalledTimes(1);

    db.tables.workItem.push({ id: 'wi', orderId: 'order-1' });
    await scanner.sweepOnce();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one payment cannot be processed', async () => {
    const { scanner, service } = setup([
      payment({ id: 'a', status: 'UNKNOWN', createdAt: new Date(Date.now() - 10 * MINUTE) }),
      payment({ id: 'b', status: 'UNKNOWN', createdAt: new Date(Date.now() - 9 * MINUTE) }),
    ]);
    const original = service.reconcilePayment.bind(service);
    vi.spyOn(service, 'reconcilePayment').mockImplementation(async (id) => {
      if (id === 'a') throw new Error('lease held');
      return original(id);
    });

    expect(await scanner.sweepOnce()).toEqual({ checked: 2, changed: 1, failed: 1 });
  });

  it('only scans payments of the gateway this process can ask', async () => {
    const { scanner } = setup([
      payment({ id: 'z', provider: 'zarinpal', status: 'UNKNOWN', createdAt: new Date(Date.now() - 10 * MINUTE) }),
    ]);

    expect((await scanner.sweepOnce()).checked).toBe(0);
  });
});
