import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockRialPaymentProvider } from '@barat/payments';
import type { ConfirmPaymentResult, RialPaymentProvider, VerifyResult } from '@barat/payments';

import type { AuditService } from '../audit/audit.service';
/* The real port, from the module that owns it. Payments used to declare its own
 * look-alike interface and its own token; the two drifted and every paid order
 * silently created no work item. Binding the test to the published contract is
 * what keeps that from happening again. */
import type { FulfillmentTrigger, WorkItemSummary } from '../workitems/workitems.types';
import {
  assertPaymentTransition,
  FULFILLMENT_REPAIR_AFTER_MS,
  PaymentsService,
  VERIFY_COOLDOWN_MS,
  VERIFY_LEASE_TTL_MS,
} from './payments.service';
import { FakeOrderBridge, FakePaymentDatabase, type Row } from './testing/fake-payment-database';

/* ============================================================================
 * Fixtures
 * ==========================================================================*/

const CUSTOMER_ID = 'cust-1';
const ORDER_ID = 'order-1';
const QUOTE_ID = 'quote-1';
const AMOUNT_IRR = 5_000_000n;
const AMOUNT_TOMAN = 500_000n;
const CALLBACK_URL = 'https://api.barat.test/api/payments/zarinpal/callback';

function inOneHour(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function seedRows(overrides: { quote?: Partial<Row>; order?: Partial<Row> } = {}): {
  quote: Row[];
  order: Row[];
} {
  return {
    quote: [
      {
        id: QUOTE_ID,
        customerId: CUSTOMER_ID,
        finalAmountIrr: AMOUNT_IRR,
        displayAmountToman: AMOUNT_TOMAN,
        status: 'ACTIVE',
        expiresAt: inOneHour(),
        ...overrides.quote,
      },
    ],
    order: [
      {
        id: ORDER_ID,
        orderNumber: 'BP-1001',
        customerId: CUSTOMER_ID,
        quoteId: QUOTE_ID,
        status: 'AWAITING_PAYMENT',
        totalAmountIrr: AMOUNT_IRR,
        displayAmountToman: AMOUNT_TOMAN,
        paidAt: null,
        ...overrides.order,
      },
    ],
  };
}

interface Harness {
  readonly db: FakePaymentDatabase;
  readonly provider: RialPaymentProvider;
  readonly service: PaymentsService;
  readonly trigger: ReturnType<typeof vi.fn>;
  readonly audit: ReturnType<typeof vi.fn>;
  readonly bridge: FakeOrderBridge;
}

function makeHarness(options: {
  provider?: RialPaymentProvider;
  quote?: Partial<Row>;
  order?: Partial<Row>;
} = {}): Harness {
  const seed = seedRows({
    ...(options.quote ? { quote: options.quote } : {}),
    ...(options.order ? { order: options.order } : {}),
  });
  const db = new FakePaymentDatabase(seed);
  const provider = options.provider ?? new MockRialPaymentProvider();
  const trigger = vi.fn(async () => ({ id: 'work-item-1' }) as unknown as WorkItemSummary);
  const audit = vi.fn(async () => undefined);
  const fulfillment: FulfillmentTrigger = { onOrderPaid: trigger };
  const auditService = { record: audit } as unknown as AuditService;
  const bridge = new FakeOrderBridge(db);
  const service = new PaymentsService(provider, db, auditService, fulfillment, bridge);
  return { db, provider, service, trigger, audit, bridge };
}

async function startPayment(
  harness: Harness,
  idempotencyKey = 'idem-1',
): Promise<{ paymentId: string; authority: string }> {
  const created = await harness.service.createPayment(
    { orderId: ORDER_ID, idempotencyKey },
    CUSTOMER_ID,
    CALLBACK_URL,
  );
  const row = harness.db.paymentById(created.payment.id);
  return { paymentId: created.payment.id, authority: row['providerAuthority'] as string };
}

function auditActions(audit: Harness['audit']): string[] {
  return audit.mock.calls.map((call) => (call[0] as { action: string }).action);
}

/** A provider whose verify always answers `result`. */
function providerReturning(result: VerifyResult | (() => VerifyResult)): RialPaymentProvider {
  const provider = new MockRialPaymentProvider();
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === 'verifyPayment') return async () => (typeof result === 'function' ? result() : result);
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as RialPaymentProvider;
}

/** A two-phase gateway (BazaarPay-like): the mock plus a commit step. */
function twoPhaseProvider(confirm: () => Promise<ConfirmPaymentResult> = async () => ({ confirmed: true })) {
  const base = new MockRialPaymentProvider();
  const confirmPayment = vi.fn(confirm);
  const provider = new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'confirmPayment') return confirmPayment;
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as RialPaymentProvider & { forceNextVerify(outcome: string): void };
  return { provider, base, confirmPayment };
}

/** Pretend the last gateway call for this payment was long ago. */
function ageVerifyAttempts(db: FakePaymentDatabase, paymentId: string, ms: number): void {
  for (const row of db.tables.paymentAttempt) {
    if (row['paymentId'] === paymentId) row['createdAt'] = new Date(Date.now() - ms);
  }
}

/* ============================================================================
 * State machine
 * ==========================================================================*/

describe('assertPaymentTransition', () => {
  it('allows the normal happy path', () => {
    expect(() => assertPaymentTransition('CREATED', 'REDIRECTED')).not.toThrow();
    expect(() => assertPaymentTransition('REDIRECTED', 'PAID')).not.toThrow();
  });

  it('refuses to move money backwards out of a terminal paid state', () => {
    expect(() => assertPaymentTransition('PAID', 'FAILED')).toThrow(/Illegal payment transition/u);
    expect(() => assertPaymentTransition('REFUNDED', 'PAID')).toThrow(/Illegal payment transition/u);
  });

  it('only allows UNKNOWN -> PAID / FAILED through the reconciliation path', () => {
    expect(() => assertPaymentTransition('UNKNOWN', 'PAID')).toThrow(/Illegal payment transition/u);
    expect(() => assertPaymentTransition('UNKNOWN', 'FAILED')).toThrow(/Illegal payment transition/u);
    expect(() => assertPaymentTransition('UNKNOWN', 'PAID', 'reconciliation')).not.toThrow();
    expect(() => assertPaymentTransition('UNKNOWN', 'FAILED', 'reconciliation')).not.toThrow();
  });

  it('lets a gateway-verified payment complete from a closed row (PAY-2)', () => {
    expect(() => assertPaymentTransition('FAILED', 'PAID')).not.toThrow();
    expect(() => assertPaymentTransition('CANCELLED', 'PAID')).not.toThrow();
  });

  it('sends a second capture to the refund queue, never back to a live status', () => {
    expect(() => assertPaymentTransition('REDIRECTED', 'REFUND_PENDING')).not.toThrow();
    expect(() => assertPaymentTransition('FAILED', 'REFUND_PENDING')).not.toThrow();
    expect(() => assertPaymentTransition('REFUND_PENDING', 'PAID')).toThrow(/Illegal payment transition/u);
  });
});

/* ============================================================================
 * createPayment
 * ==========================================================================*/

describe('PaymentsService.createPayment', () => {
  it('freezes the quote, stores the provider amount and unit, and redirects', async () => {
    const harness = makeHarness();
    const result = await harness.service.createPayment(
      { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
      CUSTOMER_ID,
      CALLBACK_URL,
    );

    const payment = harness.db.paymentById(result.payment.id);
    expect(payment['status']).toBe('REDIRECTED');
    expect(payment['amountIrr']).toBe(AMOUNT_IRR);
    expect(payment['providerAmount']).toBe('5000000');
    expect(payment['providerAmountUnit']).toBe('IRR');
    expect(payment['providerAuthority']).toMatch(/^mock_[0-9a-f]{32}$/u);
    expect(result.redirectUrl).toContain(payment['providerAuthority']);
    expect(result.created).toBe(true);

    // Rule 11: the quote is frozen the moment checkout starts.
    expect(harness.db.tables.quote[0]?.['status']).toBe('ACCEPTED');
    expect(harness.db.tables.quote[0]?.['acceptedAt']).toBeInstanceOf(Date);
  });

  it('moves the order to PAYMENT_PENDING through the order state machine (PAY-5)', async () => {
    const harness = makeHarness();
    await startPayment(harness);

    expect(harness.db.tables.order[0]?.['status']).toBe('PAYMENT_PENDING');
    // The payments module itself never writes order.status.
    expect(harness.db.callsFor('order', 'updateMany')).toHaveLength(0);
  });

  it('is idempotent: the same key returns the same payment and opens no second session', async () => {
    const harness = makeHarness();
    const createSpy = vi.spyOn(harness.provider, 'createPayment');

    const first = await harness.service.createPayment(
      { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
      CUSTOMER_ID,
      CALLBACK_URL,
    );
    const second = await harness.service.createPayment(
      { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
      CUSTOMER_ID,
      CALLBACK_URL,
    );

    expect(second.payment.id).toBe(first.payment.id);
    expect(second.created).toBe(false);
    expect(second.redirectUrl).toBe(first.redirectUrl);
    expect(harness.db.tables.payment).toHaveLength(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses an idempotency key that belongs to a different order', async () => {
    const harness = makeHarness();
    await startPayment(harness, 'idem-1');

    await expect(
      harness.service.createPayment(
        { orderId: 'order-2', idempotencyKey: 'idem-1' },
        CUSTOMER_ID,
        CALLBACK_URL,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('refuses an expired quote and creates no payment', async () => {
    const harness = makeHarness({ quote: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(
      harness.service.createPayment(
        { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
        CUSTOMER_ID,
        CALLBACK_URL,
      ),
    ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    expect(harness.db.tables.payment).toHaveLength(0);
    expect(harness.db.tables.quote[0]?.['status']).toBe('ACTIVE');
  });

  it('refuses a quote whose amount disagrees with the order and audits the mismatch', async () => {
    const harness = makeHarness({ quote: { finalAmountIrr: 4_999_999n } });

    await expect(
      harness.service.createPayment(
        { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
        CUSTOMER_ID,
        CALLBACK_URL,
      ),
    ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });

    expect(auditActions(harness.audit)).toContain('AMOUNT_MISMATCH');
    expect(harness.db.tables.payment).toHaveLength(0);
  });

  it('refuses a quote that belongs to another customer', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.createPayment(
        { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
        'someone-else',
        CALLBACK_URL,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(harness.db.tables.payment).toHaveLength(0);
  });

  it('refuses a second payment for an order that is already paid', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness, 'idem-1');
    harness.db.paymentById(paymentId)['status'] = 'PAID';

    await expect(
      harness.service.createPayment(
        { orderId: ORDER_ID, idempotencyKey: 'idem-2' },
        CUSTOMER_ID,
        CALLBACK_URL,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.db.tables.payment).toHaveLength(1);
  });

  it('marks a gateway timeout UNKNOWN, not FAILED — the money may still have moved', async () => {
    const provider = new MockRialPaymentProvider();
    provider.forceNextCreate('timeout');
    const harness = makeHarness({ provider });

    const result = await harness.service.createPayment(
      { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
      CUSTOMER_ID,
      CALLBACK_URL,
    );

    expect(harness.db.paymentById(result.payment.id)['status']).toBe('UNKNOWN');
    expect(harness.db.paymentById(result.payment.id)['failureReason']).toBe('PROVIDER_TIMEOUT');
    expect(harness.db.paymentById(result.payment.id)['liveOrderKey']).toBeNull();
    expect(result.redirectUrl).toBe('');
  });

  it('marks an outright gateway rejection FAILED and frees the live slot', async () => {
    const provider = new MockRialPaymentProvider();
    provider.forceNextCreate('failure');
    const harness = makeHarness({ provider });

    const result = await harness.service.createPayment(
      { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
      CUSTOMER_ID,
      CALLBACK_URL,
    );

    expect(harness.db.paymentById(result.payment.id)['status']).toBe('FAILED');
    expect(harness.db.paymentById(result.payment.id)['failureReason']).toBe('REQUEST_REJECTED');
    expect(harness.db.paymentById(result.payment.id)['liveOrderKey']).toBeNull();
  });
});

describe('PAY-3: one live gateway session per order', () => {
  it('a second request with a fresh key joins the open session instead of opening another', async () => {
    const harness = makeHarness();
    const createSpy = vi.spyOn(harness.provider, 'createPayment');
    const first = await harness.service.createPayment({ orderId: ORDER_ID, idempotencyKey: 'tab-one-key' }, CUSTOMER_ID, CALLBACK_URL);

    const second = await harness.service.createPayment({ orderId: ORDER_ID, idempotencyKey: 'tab-two-key' }, CUSTOMER_ID, CALLBACK_URL);

    expect(second.payment.id).toBe(first.payment.id);
    expect(second.redirectUrl).toBe(first.redirectUrl);
    expect(second.created).toBe(false);
    expect(harness.db.tables.payment).toHaveLength(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('holds the live slot in the database: a second live row for the order is refused', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);
    expect(harness.db.paymentById(paymentId)['liveOrderKey']).toBe(ORDER_ID);

    await expect(
      (harness.db.payment as unknown as { create(args: Row): Promise<unknown> }).create({
        data: { orderId: ORDER_ID, idempotencyKey: 'other', liveOrderKey: ORDER_ID, status: 'CREATED' },
      }),
    ).rejects.toThrow(/liveOrderKey/u);
  });

  it('refuses to open a session while an earlier one is still being opened', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);
    const row = harness.db.paymentById(paymentId);
    // Another process reserved the slot and has not heard back from the gateway.
    row['status'] = 'CREATED';
    row['providerAuthority'] = null;

    await expect(
      harness.service.createPayment({ orderId: ORDER_ID, idempotencyKey: 'idem-2' }, CUSTOMER_ID, CALLBACK_URL),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a new session while an earlier one is UNKNOWN at the gateway', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { authority } = await startPayment(harness);
    provider.forceNextVerify('timeout');
    await harness.service.callback({ Authority: authority, Status: 'OK' });

    await expect(
      harness.service.createPayment({ orderId: ORDER_ID, idempotencyKey: 'idem-2' }, CUSTOMER_ID, CALLBACK_URL),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(harness.db.tables.payment).toHaveLength(1);
  });

  it('still lets a customer retry on an order whose earlier payment failed', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    provider.forceNextCreate('failure');
    await startPayment(harness, 'idem-1');

    const retry = await harness.service.createPayment(
      { orderId: ORDER_ID, idempotencyKey: 'idem-2' },
      CUSTOMER_ID,
      CALLBACK_URL,
    );
    expect(retry.created).toBe(true);
    expect(harness.db.paymentById(retry.payment.id)['status']).toBe('REDIRECTED');
  });
});

/* ============================================================================
 * THE core idempotency requirement
 * ==========================================================================*/

describe('PaymentsService.callback idempotency', () => {
  it('processes the same successful callback five times with exactly one effect', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    const responses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      responses.push(await harness.service.callback({ Authority: authority, Status: 'OK' }));
    }

    // Exactly one payment row, and it is PAID and holds the order's paid slot.
    expect(harness.db.tables.payment).toHaveLength(1);
    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(harness.db.paymentById(paymentId)['paidOrderKey']).toBe(ORDER_ID);
    expect(harness.db.paymentById(paymentId)['liveOrderKey']).toBeNull();

    // Exactly one order transition to PAID.
    const paidOrderUpdates = harness.db
      .callsFor('order', 'update')
      .filter((call) => (call.args['data'] as Row)['status'] === 'PAID');
    expect(paidOrderUpdates).toHaveLength(1);
    expect(harness.db.tables.order[0]?.['status']).toBe('PAID');

    /* Exactly one fulfillment hand-off, carrying the order the operator must
     * work and non-secret context only. Idempotency lives in the work-items
     * service, keyed on the order, so five callbacks still yield one item. */
    expect(harness.trigger).toHaveBeenCalledTimes(1);
    expect(harness.trigger).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      customerId: CUSTOMER_ID,
      payload: { paymentId },
    });

    // No duplicate reconciliation noise, and every response is a consistent PAID.
    expect(harness.db.tables.reconciliationIssue).toHaveLength(0);
    expect(responses.map((response) => response.outcome)).toEqual([
      'PAID',
      'PAID',
      'PAID',
      'PAID',
      'PAID',
    ]);
    expect(responses.map((response) => response.verified)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('emits the fulfillment event only after the payment transaction has committed', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    let stateSeenByFulfillment: { payment: unknown; order: unknown } | null = null;
    harness.trigger.mockImplementation(async () => {
      stateSeenByFulfillment = {
        payment: harness.db.paymentById(paymentId)['status'],
        order: harness.db.tables.order[0]?.['status'],
      };
      return { id: 'work-item-1' } as unknown as WorkItemSummary;
    });

    await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(stateSeenByFulfillment).toEqual({ payment: 'PAID', order: 'PAID' });
  });

  it('does not fire fulfillment twice when two callbacks race on the same authority', async () => {
    const harness = makeHarness();
    const { authority } = await startPayment(harness);

    const [first, second] = await Promise.all([
      harness.service.callback({ Authority: authority, Status: 'OK' }),
      harness.service.callback({ Authority: authority, Status: 'OK' }),
    ]);

    expect(first.outcome).toBe('PAID');
    expect(second.outcome).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
    expect(harness.db.tables.payment).toHaveLength(1);
  });

  it('verifies with the stored amount, never with a query-string amount', async () => {
    const harness = makeHarness();
    const verifySpy = vi.spyOn(harness.provider, 'verifyPayment');
    const { authority } = await startPayment(harness);

    await harness.service.callback({
      Authority: authority,
      Status: 'OK',
      // A hostile extra parameter must have no effect at all.
      amount: '1',
    } as never);

    expect(verifySpy).toHaveBeenCalledWith({ authority, amountIrr: AMOUNT_IRR });
  });
});

/* ============================================================================
 * Untrusted callback input
 * ==========================================================================*/

describe('PaymentsService.callback with untrusted input', () => {
  it('never creates a payment for an unknown authority and audits a security event', async () => {
    const harness = makeHarness();

    const response = await harness.service.callback({
      Authority: 'A-forged-authority',
      Status: 'OK',
    });

    expect(response).toMatchObject({ payment: null, orderId: null, outcome: 'FAILED', verified: false });
    expect(harness.db.tables.payment).toHaveLength(0);
    expect(auditActions(harness.audit)).toContain('PAYMENT_CALLBACK_UNKNOWN_AUTHORITY');
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('keeps the raw authority out of the audit trail', async () => {
    const harness = makeHarness();
    await harness.service.callback({ Authority: 'A-forged-authority', Status: 'OK' });

    const serialised = JSON.stringify(harness.audit.mock.calls);
    expect(serialised).not.toContain('A-forged-authority');
    expect(serialised).toContain('authorityHash');
  });

  it('rejects a callback with no authority at all', async () => {
    const harness = makeHarness();
    const response = await harness.service.callback({ Status: 'OK' });

    expect(response).toMatchObject({ payment: null, outcome: 'UNKNOWN', verified: false });
    expect(auditActions(harness.audit)).toContain('PAYMENT_CALLBACK_INVALID');
  });

  it('does not treat Status=OK as proof: a failed verify leaves the payment unpaid', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('failure');

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('FAILED');
    expect(harness.db.paymentById(paymentId)['status']).toBe('FAILED');
    expect(harness.db.paymentById(paymentId)['failureReason']).toBe('VERIFY_FAILED');
    expect(harness.db.tables.order[0]?.['status']).toBe('PAYMENT_PENDING');
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('PAY-1: asks the gateway on a NOK callback, and only a gateway "not paid" cancels', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const verifySpy = vi.spyOn(provider, 'verifyPayment');
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('failure');

    const response = await harness.service.callback({ Authority: authority, Status: 'NOK' });

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(response.outcome).toBe('CANCELLED');
    expect(harness.db.paymentById(paymentId)['status']).toBe('CANCELLED');
    expect(harness.db.paymentById(paymentId)['failureReason']).toBe('CUSTOMER_CANCELLED');
  });

  it('PAY-1: a forged NOK for a payment the customer did make cannot cancel it', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    // Whoever holds the authority sends "cancel"; the gateway says it was paid.
    const response = await harness.service.callback({ Authority: authority, Status: 'NOK' });

    expect(response.outcome).toBe('PAID');
    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
  });

  it('PAY-1: a NOK the gateway cannot answer parks the payment as UNKNOWN, not CANCELLED', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('timeout');

    const response = await harness.service.callback({ Authority: authority, Status: 'NOK' });

    expect(response.outcome).toBe('UNKNOWN');
    expect(harness.db.paymentById(paymentId)['status']).toBe('UNKNOWN');
  });

  it('maps an unrecognised status the gateway confirms as unpaid to an indeterminate provider response', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('failure');

    const response = await harness.service.callback({ Authority: authority, Status: 'weird' });

    expect(response.outcome).toBe('FAILED');
    expect(harness.db.paymentById(paymentId)['failureReason']).toBe('UNKNOWN_PROVIDER_RESPONSE');
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('records a payment attempt for every callback, successful or not', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('failure');

    await harness.service.callback({ Authority: authority, Status: 'NOK' });
    await harness.service.callback({ Authority: authority, Status: 'NOK' });

    const attempts = harness.db.tables.paymentAttempt.filter(
      (row) => row['paymentId'] === paymentId && row['action'] === 'CALLBACK',
    );
    expect(attempts).toHaveLength(2);
    expect(attempts.map((row) => row['attemptNumber'])).toEqual([1, 3]);
  });
});

/* ============================================================================
 * Amount mismatch during verification
 * ==========================================================================*/

describe('PaymentsService verification amount checks', () => {
  it('refuses to mark PAID when the gateway reports a different amount, with a typed issue (PAY-12)', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    const mismatchingHarness = makeHarness({
      provider: providerReturning({
        outcome: 'VERIFIED',
        providerCode: 100,
        authority,
        providerAmount: 4_000_000n,
        providerAmountUnit: 'IRR',
        refId: '123456',
        maskedCard: '6037********1234',
        cardHash: 'hash',
        providerFeeIrr: 0n,
        providerFeeType: 'X',
      }),
    });
    // Reuse the same store so the payment exists for the mismatching provider.
    mismatchingHarness.db.tables.payment.push({ ...harness.db.paymentById(paymentId) });
    const response = await mismatchingHarness.service.callback({
      Authority: authority,
      Status: 'OK',
    });

    expect(response.outcome).toBe('FAILED');
    expect(mismatchingHarness.db.paymentById(paymentId)['status']).toBe('FAILED');
    expect(mismatchingHarness.db.paymentById(paymentId)['failureReason']).toBe('AMOUNT_MISMATCH');
    expect(auditActions(mismatchingHarness.audit)).toContain('AMOUNT_MISMATCH');
    expect(mismatchingHarness.db.tables.reconciliationIssue).toHaveLength(1);
    expect(mismatchingHarness.db.tables.reconciliationIssue[0]).toMatchObject({
      type: 'amount_mismatch',
      expectedAmountIrr: AMOUNT_IRR,
      actualAmountIrr: 4_000_000n,
      differenceIrr: -1_000_000n,
    });
    expect(mismatchingHarness.trigger).not.toHaveBeenCalled();
    expect(mismatchingHarness.db.tables.order[0]?.['status']).toBe('AWAITING_PAYMENT');
    // PAY-10: the money was settled, so the bank's 72-hour reversal is not promised.
    expect(response.messageFa).not.toMatch(/۷۲/u);
  });

  it('accepts an IRT-quoted verification only when it converts back to the exact IRR total', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    const irtHarness = makeHarness({
      provider: providerReturning({
        outcome: 'VERIFIED',
        providerCode: 100,
        authority,
        providerAmount: 500_000n,
        providerAmountUnit: 'IRT',
        refId: '123456',
        maskedCard: '6037********1234',
        cardHash: 'hash',
        providerFeeIrr: 0n,
        providerFeeType: 'X',
      }),
    });
    const row = { ...harness.db.paymentById(paymentId) };
    // The request was made in IRT, so that is what was stored at redirect time.
    row['providerAmount'] = '500000';
    row['providerAmountUnit'] = 'IRT';
    irtHarness.db.tables.payment.push(row);

    const response = await irtHarness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('PAID');
    expect(irtHarness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(irtHarness.trigger).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================================
 * Provider code 101 — already verified
 * ==========================================================================*/

describe('PaymentsService already-verified handling', () => {
  it('returns idempotently when the local payment is already PAID for the same authority', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    // Simulate the real race: a concurrent request commits PAID while this
    // request is waiting for the gateway, which then answers 101.
    vi.spyOn(harness.provider, 'verifyPayment').mockImplementation(async () => {
      const row = harness.db.paymentById(paymentId);
      row['status'] = 'PAID';
      row['providerRefId'] = '987654321';
      return {
        outcome: 'ALREADY_VERIFIED',
        providerCode: 101,
        authority,
        providerAmount: AMOUNT_IRR,
        providerAmountUnit: 'IRR',
      };
    });

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('ALREADY_VERIFIED');
    expect(response.verified).toBe(false);
    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(harness.db.tables.reconciliationIssue).toHaveLength(0);
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('flags a reconciliation issue and refuses to fulfil when the local payment is not PAID', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('already-verified');

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('UNKNOWN');
    const payment = harness.db.paymentById(paymentId);
    expect(payment['status']).toBe('UNKNOWN');
    expect(payment['providerVerifyCode']).toBe(101);
    expect(payment['failureReason']).toBe('PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH');
    expect(payment['liveOrderKey']).toBeNull();

    expect(harness.db.tables.reconciliationIssue).toHaveLength(1);
    const issue = harness.db.tables.reconciliationIssue[0];
    expect(issue?.['paymentId']).toBe(paymentId);
    expect(issue?.['type']).toBe('provider_already_verified_mismatch');
    expect((issue?.['details'] as { reason: string }).reason).toBe(
      'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH',
    );

    // The order must not advance and fulfillment must not run on an unknown state.
    expect(harness.db.tables.order[0]?.['status']).toBe('PAYMENT_PENDING');
    expect(harness.trigger).not.toHaveBeenCalled();
    expect(auditActions(harness.audit)).toContain('PAYMENT_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH');
  });
});

/* ============================================================================
 * Indeterminate outcomes
 * ==========================================================================*/

describe('PaymentsService indeterminate outcomes', () => {
  it('parks a verify timeout in UNKNOWN without fulfilling', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('timeout');

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('UNKNOWN');
    expect(harness.db.paymentById(paymentId)['status']).toBe('UNKNOWN');
    expect(harness.db.tables.order[0]?.['status']).toBe('PAYMENT_PENDING');
    expect(harness.trigger).not.toHaveBeenCalled();
    // PAY-10: tell the customer not to pay twice, not that money is coming back.
    expect(response.messageFa).toMatch(/دوباره پرداخت نکنید/u);
  });

  it('treats a thrown provider error as UNKNOWN, never as a failure to write off', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    vi.spyOn(harness.provider, 'verifyPayment').mockRejectedValue(new Error('socket hang up'));

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('UNKNOWN');
    expect(harness.db.paymentById(paymentId)['status']).toBe('UNKNOWN');
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('never auto-promotes an UNKNOWN payment to PAID from a callback', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    harness.db.paymentById(paymentId)['status'] = 'UNKNOWN';

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('UNKNOWN');
    expect(harness.db.paymentById(paymentId)['status']).toBe('UNKNOWN');
    expect(harness.db.tables.reconciliationIssue).toHaveLength(1);
    expect(harness.db.tables.reconciliationIssue[0]?.['type']).toBe('unknown_payment');
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('PAY-11: a refreshed result page does not open a second issue for the same payment', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    harness.db.paymentById(paymentId)['status'] = 'UNKNOWN';

    await harness.service.callback({ Authority: authority, Status: 'OK' });
    ageVerifyAttempts(harness.db, paymentId, VERIFY_COOLDOWN_MS + 1);
    await harness.service.verifyPayment({ paymentId, idempotencyKey: 'verify-key-000001' }, CUSTOMER_ID);
    ageVerifyAttempts(harness.db, paymentId, VERIFY_COOLDOWN_MS + 1);
    await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(harness.db.tables.reconciliationIssue).toHaveLength(1);
    expect(harness.db.tables.reconciliationIssue[0]?.['openDedupeKey']).toBe(`${paymentId}:UNKNOWN_PAYMENT_STATE`);
  });
});

/* ============================================================================
 * verifyPayment endpoint
 * ==========================================================================*/

describe('PaymentsService.verifyPayment', () => {
  it('verifies by payment id and is idempotent on replay', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);

    const first = await harness.service.verifyPayment(
      { paymentId, idempotencyKey: 'verify-1' },
      CUSTOMER_ID,
    );
    const second = await harness.service.verifyPayment(
      { paymentId, idempotencyKey: 'verify-1' },
      CUSTOMER_ID,
    );

    expect(first).toMatchObject({ outcome: 'PAID', verified: true });
    expect(second).toMatchObject({ outcome: 'PAID', verified: false });
    expect(harness.trigger).toHaveBeenCalledTimes(1);
  });

  it('hides another customer’s payment behind a not-found', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);

    await expect(
      harness.service.verifyPayment({ paymentId, idempotencyKey: 'v' }, 'someone-else'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an unknown payment id', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.verifyPayment({ paymentId: 'nope', idempotencyKey: 'v' }, CUSTOMER_ID),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('PAY-13: answers a closed payment from its row between gateway calls', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId } = await startPayment(harness);
    provider.forceNextVerify('failure');
    await harness.service.verifyPayment({ paymentId, idempotencyKey: 'v' }, CUSTOMER_ID);
    const verifySpy = vi.spyOn(provider, 'verifyPayment');

    for (let i = 0; i < 5; i += 1) {
      const response = await harness.service.verifyPayment({ paymentId, idempotencyKey: 'v' }, CUSTOMER_ID);
      expect(response).toMatchObject({ outcome: 'FAILED', verified: false });
    }
    expect(verifySpy).not.toHaveBeenCalled();

    ageVerifyAttempts(harness.db, paymentId, VERIFY_COOLDOWN_MS + 1);
    provider.forceNextVerify('failure');
    await harness.service.verifyPayment({ paymentId, idempotencyKey: 'v' }, CUSTOMER_ID);
    expect(verifySpy).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================================
 * Customer-facing payload safety
 * ==========================================================================*/

describe('payment DTO safety', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = makeHarness();
    const { authority } = await startPayment(harness);
    await harness.service.callback({ Authority: authority, Status: 'OK' });
  });

  it('exposes money as exact strings and leaks no authority, card hash or merchant id', async () => {
    const response = await harness.service.verifyPayment(
      { paymentId: harness.db.tables.payment[0]?.['id'] as string, idempotencyKey: 'v' },
      CUSTOMER_ID,
    );

    expect(response.payment.amountIrr).toBe('5000000');
    expect(response.payment.displayAmountToman).toBe('500000');
    expect(response.payment.maskedCard).toBe('6037********1234');
    expect(response.messageFa).toMatch(/[؀-ۿ]/u);

    const serialised = JSON.stringify(response);
    const stored = harness.db.tables.payment[0] as Row;
    expect(serialised).not.toContain(stored['providerAuthority'] as string);
    expect(serialised).not.toContain(stored['cardHash'] as string);
    expect(serialised).not.toContain('merchant');
  });
});

/* ============================================================================
 * Security audit regressions (2026-10-20)
 * ==========================================================================*/

describe('security audit: payment verification races and closed states', () => {
  /** A single-phase gateway: the first verify settles (100), every later one says 101. */
  function settlingGateway(): { provider: RialPaymentProvider; calls: () => number } {
    const base = new MockRialPaymentProvider();
    let calls = 0;
    const provider = new Proxy(base, {
      get(target, property, receiver) {
        if (property === 'verifyPayment') {
          return async (input: { authority: string; amountIrr: bigint }): Promise<VerifyResult> => {
            calls += 1;
            if (calls === 1) {
              // The settling call is slow, so a second request overlaps it.
              await new Promise((resolve) => setTimeout(resolve, 5));
              return base.verifyPayment(input);
            }
            return {
              outcome: 'ALREADY_VERIFIED',
              providerCode: 101,
              authority: input.authority,
              providerAmount: input.amountIrr,
              providerAmountUnit: 'IRR',
            };
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as RialPaymentProvider;
    return { provider, calls: () => calls };
  }

  it('a callback and a /verify overlapping on one payment end PAID with one fulfillment, not UNKNOWN', async () => {
    const gateway = settlingGateway();
    const harness = makeHarness({ provider: gateway.provider });
    const { paymentId, authority } = await startPayment(harness);

    const [callback, verify] = await Promise.all([
      harness.service.callback({ Authority: authority, Status: 'OK' }),
      harness.service.verifyPayment({ paymentId, idempotencyKey: 'verify-key-000001' }, CUSTOMER_ID),
    ]);

    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(callback.outcome).toBe('PAID');
    expect(verify.outcome).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
    expect(harness.db.tables.reconciliationIssue).toHaveLength(0);
    // The second request re-read a committed PAID and never asked the gateway.
    expect(gateway.calls()).toBe(1);
  });

  it('PAY-2: a gateway-verified payment whose row is CANCELLED completes and is delivered', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    provider.forceNextVerify('failure');
    await harness.service.callback({ Authority: authority, Status: 'NOK' });
    expect(harness.db.paymentById(paymentId)['status']).toBe('CANCELLED');

    // The customer did pay after all; the gateway sends them back with OK.
    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('PAID');
    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(harness.db.tables.order[0]?.['status']).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
    expect(harness.db.tables.reconciliationIssue).toHaveLength(0);
    expect(auditActions(harness.audit)).toContain('PAYMENT_VERIFIED_AFTER_LOCAL_CLOSE');
  });

  it('never reports PAID when the PAID compare-and-set lost to another writer', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    const original = harness.provider.verifyPayment.bind(harness.provider);
    vi.spyOn(harness.provider, 'verifyPayment').mockImplementation(async (input) => {
      const result = await original(input);
      // Another writer parks the row while the gateway was answering.
      harness.db.paymentById(paymentId)['status'] = 'UNKNOWN';
      return result;
    });

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('UNKNOWN');
    expect(harness.db.paymentById(paymentId)['status']).toBe('UNKNOWN');
    expect(harness.trigger).not.toHaveBeenCalled();
    expect(harness.db.tables.reconciliationIssue).toHaveLength(1);
  });

  it('a late failure signal for an UNKNOWN payment changes nothing instead of throwing', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    harness.db.paymentById(paymentId)['status'] = 'UNKNOWN';
    provider.forceNextVerify('failure');

    const response = await harness.service.callback({ Authority: authority, Status: 'NOK' });

    expect(harness.db.paymentById(paymentId)['status']).toBe('UNKNOWN');
    expect(response.payment?.status).toBe('UNKNOWN');
  });
});

describe('security audit: orders that may not be paid', () => {
  it.each([['CANCELLED'], ['FAILED'], ['FULFILLED'], ['REFUNDED'], ['PAID'], ['DRAFT']])(
    'refuses to open a gateway session for an order in %s',
    async (status) => {
      const harness = makeHarness({ order: { status } });
      const createSpy = vi.spyOn(harness.provider, 'createPayment');

      await expect(
        harness.service.createPayment({ orderId: ORDER_ID, idempotencyKey: 'idem-1' }, CUSTOMER_ID, CALLBACK_URL),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(harness.db.tables.payment).toHaveLength(0);
      expect(createSpy).not.toHaveBeenCalled();
      // Rule 11 is not tripped by a refused payment either.
      expect(harness.db.tables.quote[0]?.['status']).toBe('ACTIVE');
    },
  );

  it('PLT-5: a second capture for a paid order goes to the refund queue, never to fulfillment', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    // Session one is abandoned and closed; session two is opened and paid.
    const first = await startPayment(harness, 'idem-1');
    provider.forceNextVerify('failure');
    await harness.service.verifyPayment({ paymentId: first.paymentId, idempotencyKey: 'v' }, CUSTOMER_ID);
    const second = await startPayment(harness, 'idem-2');
    await harness.service.callback({ Authority: second.authority, Status: 'OK' });
    harness.db.tables.order[0]!['status'] = 'FULFILLED';

    // The first session turns out to have been paid as well.
    const response = await harness.service.callback({ Authority: first.authority, Status: 'OK' });

    expect(response.outcome).toBe('FAILED');
    expect(response.messageFa).toMatch(/بازگشت/u);
    expect(harness.db.paymentById(first.paymentId)['status']).toBe('REFUND_PENDING');
    expect(harness.db.paymentById(first.paymentId)['paidOrderKey']).toBeNull();
    expect(harness.db.paymentById(second.paymentId)['paidOrderKey']).toBe(ORDER_ID);
    expect(harness.db.tables.order[0]?.['status']).toBe('FULFILLED');
    expect(harness.trigger).toHaveBeenCalledTimes(1);

    const duplicates = harness.db.tables.reconciliationIssue.filter((row) => row['type'] === 'duplicate_payment');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ paymentId: first.paymentId, severity: 'HIGH' });
    expect(harness.db.tables.refund).toHaveLength(1);
    expect(harness.db.tables.refund[0]).toMatchObject({
      paymentId: first.paymentId,
      amountIrr: AMOUNT_IRR,
      status: 'REQUESTED',
      reason: 'DUPLICATE_PAYMENT_FOR_ORDER',
    });

    // A replay changes nothing: one issue, one refund request.
    await harness.service.callback({ Authority: first.authority, Status: 'OK' });
    expect(harness.db.tables.refund).toHaveLength(1);
    expect(harness.db.tables.reconciliationIssue.filter((row) => row['type'] === 'duplicate_payment')).toHaveLength(1);
  });

  it('PLT-5: the paid slot is a database guarantee, not only an application check', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    await harness.service.callback({ Authority: authority, Status: 'OK' });
    expect(harness.db.paymentById(paymentId)['paidOrderKey']).toBe(ORDER_ID);

    await expect(
      (harness.db.payment as unknown as { create(args: Row): Promise<unknown> }).create({
        data: { orderId: ORDER_ID, idempotencyKey: 'x', status: 'PAID', paidOrderKey: ORDER_ID },
      }),
    ).rejects.toThrow(/paidOrderKey/u);
  });

  it('PAY-2/PAY-5: a payment verified for an order cancelled underneath it reopens the order and delivers', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    harness.db.tables.order[0]!['status'] = 'CANCELLED';

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('PAID');
    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(harness.db.tables.order[0]?.['status']).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
    expect(harness.db.tables.reconciliationIssue).toHaveLength(1);
    expect(harness.db.tables.reconciliationIssue[0]).toMatchObject({
      type: 'paid_not_fulfilled',
      severity: 'LOW',
      details: { reason: 'PAYMENT_VERIFIED_FOR_CLOSED_ORDER', orderStatus: 'CANCELLED', reopened: true },
    });
  });
});

/* ============================================================================
 * Two-phase gateways (PAY-4)
 * ==========================================================================*/

describe('PAY-4: a two-phase gateway is never committed for a payment we will not keep', () => {
  it('commits a normal payment after PAID is written, then fulfils', async () => {
    const { provider, confirmPayment } = twoPhaseProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);

    let statusAtCommit: unknown = null;
    confirmPayment.mockImplementation(async () => {
      statusAtCommit = harness.db.paymentById(paymentId)['status'];
      return { confirmed: true };
    });
    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('PAID');
    expect(statusAtCommit).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
  });

  it('does not commit a second capture: the gateway hands it back, no refund request is filed', async () => {
    const { provider, base, confirmPayment } = twoPhaseProvider();
    const harness = makeHarness({ provider });
    const first = await startPayment(harness, 'idem-1');
    base.forceNextVerify('failure');
    await harness.service.verifyPayment({ paymentId: first.paymentId, idempotencyKey: 'v' }, CUSTOMER_ID);
    const second = await startPayment(harness, 'idem-2');
    await harness.service.callback({ Authority: second.authority, Status: 'OK' });
    expect(confirmPayment).toHaveBeenCalledTimes(1);

    const response = await harness.service.callback({ Authority: first.authority, Status: 'OK' });

    expect(confirmPayment).toHaveBeenCalledTimes(1);
    expect(harness.db.paymentById(first.paymentId)['status']).toBe('REFUND_PENDING');
    expect(harness.db.tables.refund).toHaveLength(0);
    expect(harness.db.tables.reconciliationIssue[0]).toMatchObject({
      type: 'duplicate_payment',
      severity: 'MEDIUM',
      details: { autoReturn: true },
    });
    expect(response.messageFa).toMatch(/خودکار/u);
  });

  it('does not commit a payment for a cancelled order', async () => {
    const { provider, confirmPayment } = twoPhaseProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    harness.db.tables.order[0]!['status'] = 'CANCELLED';

    await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(confirmPayment).not.toHaveBeenCalled();
    expect(harness.db.paymentById(paymentId)['status']).toBe('REFUND_PENDING');
    expect(harness.db.tables.order[0]?.['status']).toBe('CANCELLED');
    expect(harness.trigger).not.toHaveBeenCalled();
    expect(harness.db.tables.reconciliationIssue[0]).toMatchObject({
      type: 'duplicate_payment',
      details: { reason: 'PAYMENT_FOR_CLOSED_ORDER' },
    });
  });

  it('closes the uncommitted charge as REFUNDED once the gateway has handed it back', async () => {
    const { provider, base } = twoPhaseProvider();
    const harness = makeHarness({ provider });
    const { paymentId, authority } = await startPayment(harness);
    harness.db.tables.order[0]!['status'] = 'CANCELLED';
    await harness.service.callback({ Authority: authority, Status: 'OK' });

    base.forceNextVerify('failure');
    const result = await harness.service.reconcilePayment(paymentId);

    expect(result).toEqual({ status: 'REFUNDED', changed: true });
  });
});

/* ============================================================================
 * Reconciliation path (PAY-6)
 * ==========================================================================*/

describe('PAY-6: PaymentsService.reconcilePayment', () => {
  it('settles an UNKNOWN payment the gateway verifies, and fulfils it', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);
    harness.db.paymentById(paymentId)['status'] = 'UNKNOWN';

    const result = await harness.service.reconcilePayment(paymentId);

    expect(result).toEqual({ status: 'PAID', changed: true });
    expect(harness.db.tables.order[0]?.['status']).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
  });

  it('settles an UNKNOWN payment the gateway already holds as paid for the exact amount (101)', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId } = await startPayment(harness);
    harness.db.paymentById(paymentId)['status'] = 'UNKNOWN';
    provider.forceNextVerify('already-verified');

    const result = await harness.service.reconcilePayment(paymentId);

    expect(result.status).toBe('PAID');
    expect(harness.db.paymentById(paymentId)['providerVerifyCode']).toBe(101);
    expect(harness.trigger).toHaveBeenCalledTimes(1);
  });

  it('closes an UNKNOWN payment the gateway definitely did not take', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId } = await startPayment(harness);
    harness.db.paymentById(paymentId)['status'] = 'UNKNOWN';
    provider.forceNextVerify('failure');

    expect(await harness.service.reconcilePayment(paymentId)).toEqual({ status: 'FAILED', changed: true });
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('closes an abandoned session and frees the order for the payment-window sweep (ORD-10)', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId } = await startPayment(harness);
    provider.forceNextVerify('failure');

    expect(await harness.service.reconcilePayment(paymentId)).toEqual({ status: 'FAILED', changed: true });
    expect(harness.db.paymentById(paymentId)['liveOrderKey']).toBeNull();
  });

  it('leaves a live session live when the gateway cannot answer', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { paymentId } = await startPayment(harness);
    provider.forceNextVerify('timeout');

    expect(await harness.service.reconcilePayment(paymentId)).toEqual({ status: 'REDIRECTED', changed: false });
  });

  it('closes a reservation the gateway never answered (no authority, nobody could have paid)', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);
    const row = harness.db.paymentById(paymentId);
    row['status'] = 'CREATED';
    row['providerAuthority'] = null;
    const verifySpy = vi.spyOn(harness.provider, 'verifyPayment');

    expect(await harness.service.reconcilePayment(paymentId)).toEqual({ status: 'FAILED', changed: true });
    expect(verifySpy).not.toHaveBeenCalled();
  });
});

/* ============================================================================
 * Paid orders that never started (PAY-7)
 * ==========================================================================*/

describe('PAY-7: repairing a paid order with no fulfillment', () => {
  it('a trigger that throws leaves the payment PAID, and the repair starts fulfillment later', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    harness.trigger.mockRejectedValueOnce(new Error('work item store down'));

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });
    expect(response.outcome).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);

    // A replay moments later does not race the first attempt.
    await harness.service.callback({ Authority: authority, Status: 'OK' });
    expect(harness.trigger).toHaveBeenCalledTimes(1);

    // Once the grace period has passed, the next replay (or the scanner) repairs it.
    harness.db.paymentById(paymentId)['verifiedAt'] = new Date(Date.now() - FULFILLMENT_REPAIR_AFTER_MS - 1);
    await harness.service.callback({ Authority: authority, Status: 'OK' });
    expect(harness.trigger).toHaveBeenCalledTimes(2);
    expect(harness.trigger).toHaveBeenLastCalledWith({
      orderId: ORDER_ID,
      customerId: CUSTOMER_ID,
      payload: { paymentId, repaired: true },
    });
    expect(auditActions(harness.audit)).toContain('PAYMENT_FULFILLMENT_REPAIRED');
  });

  it('does nothing for an order that has its work item', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    await harness.service.callback({ Authority: authority, Status: 'OK' });
    harness.db.tables.workItem.push({ id: 'wi-1', orderId: ORDER_ID });
    harness.db.paymentById(paymentId)['verifiedAt'] = new Date(Date.now() - FULFILLMENT_REPAIR_AFTER_MS - 1);

    expect(await harness.service.repairFulfillmentIfMissing(harness.db.paymentById(paymentId) as never)).toBe(false);
    expect(harness.trigger).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================================
 * Cross-process verification lease (PAY-9)
 * ==========================================================================*/

describe('PAY-9: verification lease', () => {
  it('waits for another process to release the lease, then sees its result', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);
    const row = harness.db.paymentById(paymentId);
    row['verifyLeaseUntil'] = new Date(Date.now() + VERIFY_LEASE_TTL_MS);
    row['verifyLeaseToken'] = 'other-process';
    setTimeout(() => {
      // The other process finishes: it committed PAID and released the lease.
      row['status'] = 'PAID';
      row['verifiedAt'] = new Date();
      row['verifyLeaseUntil'] = null;
      row['verifyLeaseToken'] = null;
    }, 300);
    const verifySpy = vi.spyOn(harness.provider, 'verifyPayment');

    const response = await harness.service.verifyPayment({ paymentId, idempotencyKey: 'v' }, CUSTOMER_ID);

    expect(response.outcome).toBe('PAID');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('takes over an expired lease left by a crashed process, and releases its own', async () => {
    const harness = makeHarness();
    const { paymentId } = await startPayment(harness);
    const row = harness.db.paymentById(paymentId);
    row['verifyLeaseUntil'] = new Date(Date.now() - 1);
    row['verifyLeaseToken'] = 'crashed-process';

    const response = await harness.service.verifyPayment({ paymentId, idempotencyKey: 'v' }, CUSTOMER_ID);

    expect(response.outcome).toBe('PAID');
    expect(row['verifyLeaseUntil']).toBeNull();
    expect(row['verifyLeaseToken']).toBeNull();
  });
});

/* ============================================================================
 * Customer messages (PAY-10)
 * ==========================================================================*/

describe('PAY-10: the result-page sentence promises only what is true', () => {
  it('promises the bank reversal for an unsettled single-phase failure', async () => {
    const provider = new MockRialPaymentProvider();
    const harness = makeHarness({ provider });
    const { authority } = await startPayment(harness);
    provider.forceNextVerify('failure');

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.messageFa).toMatch(/۷۲ ساعت/u);
  });

  it('points a two-phase failure at the wallet, not the bank', async () => {
    const { provider, base } = twoPhaseProvider();
    const harness = makeHarness({ provider });
    const { authority } = await startPayment(harness);
    base.forceNextVerify('failure');

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.messageFa).toMatch(/کیف پول/u);
    expect(response.messageFa).not.toMatch(/۷۲/u);
  });
});

describe('security audit: idempotency and robustness', () => {
  it('answers a same-key request that lost the insert race with the existing payment, not a 500', async () => {
    const harness = makeHarness();
    const first = await startPayment(harness, 'idem-1');
    // The racing request's first read ran before the winner's insert was visible.
    vi.spyOn(harness.db.payment as { findUnique: (args: Row) => Promise<unknown> }, 'findUnique')
      .mockResolvedValueOnce(null);

    const replay = await harness.service.createPayment(
      { orderId: ORDER_ID, idempotencyKey: 'idem-1' },
      CUSTOMER_ID,
      CALLBACK_URL,
    );

    expect(replay.created).toBe(false);
    expect(replay.payment.id).toBe(first.paymentId);
    expect(harness.db.tables.payment).toHaveLength(1);
  });

  it('retries a payment-attempt number collision instead of aborting the callback', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);
    const attempts = harness.db.paymentAttempt as unknown as { create: (args: Row) => Promise<unknown> };
    const realCreate = attempts.create.bind(attempts);
    vi.spyOn(attempts, 'create')
      .mockImplementationOnce(async () => {
        throw Object.assign(new Error('Unique constraint failed on the fields: (`paymentId`,`attemptNumber`)'), {
          code: 'P2002',
        });
      })
      .mockImplementation(realCreate);

    const response = await harness.service.callback({ Authority: authority, Status: 'OK' });

    expect(response.outcome).toBe('PAID');
    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');
    expect(harness.trigger).toHaveBeenCalledTimes(1);
  });

  it('a failing audit write on an amount mismatch does not become an unhandled rejection', async () => {
    const harness = makeHarness({ quote: { finalAmountIrr: 4_999_999n } });
    harness.audit.mockRejectedValue(new Error('audit store down'));

    await expect(
      harness.service.createPayment({ orderId: ORDER_ID, idempotencyKey: 'idem-1' }, CUSTOMER_ID, CALLBACK_URL),
    ).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
    // Give a stray rejection the chance to surface; vitest fails the run if it does.
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});
