import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockRialPaymentProvider } from '@barat/payments';
import type { RialPaymentProvider, VerifyResult } from '@barat/payments';

import type { AuditService } from '../audit/audit.service';
import {
  assertPaymentTransition,
  PaymentsService,
  type FulfillmentTrigger,
  type PaymentDatabase,
} from './payments.service';

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
  const trigger = vi.fn(async () => undefined);
  const audit = vi.fn(async () => undefined);
  const fulfillment: FulfillmentTrigger = { trigger: trigger as FulfillmentTrigger['trigger'] };
  const auditService = { record: audit } as unknown as AuditService;
  const service = new PaymentsService(provider, db, auditService, fulfillment);
  return { db, provider, service, trigger, audit };
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

  it('only allows UNKNOWN -> PAID through the reconciliation path', () => {
    expect(() => assertPaymentTransition('UNKNOWN', 'PAID')).toThrow(/Illegal payment transition/u);
    expect(() => assertPaymentTransition('UNKNOWN', 'PAID', 'reconciliation')).not.toThrow();
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
    expect(result.redirectUrl).toBe('');
  });

  it('marks an outright gateway rejection FAILED', async () => {
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

    // Exactly one payment row, and it is PAID.
    expect(harness.db.tables.payment).toHaveLength(1);
    expect(harness.db.paymentById(paymentId)['status']).toBe('PAID');

    // Exactly one order transition to PAID.
    const paidOrderUpdates = harness.db
      .callsFor('order', 'update')
      .filter((call) => (call.args['data'] as Row)['status'] === 'PAID');
    expect(paidOrderUpdates).toHaveLength(1);
    expect(harness.db.tables.order[0]?.['status']).toBe('PAID');

    // Exactly one fulfillment trigger, with a stable idempotency key.
    expect(harness.trigger).toHaveBeenCalledTimes(1);
    expect(harness.trigger).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      paymentId,
      idempotencyKey: `payment:${paymentId}:fulfillment`,
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
      return undefined;
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
    expect(harness.db.tables.order[0]?.['status']).toBe('AWAITING_PAYMENT');
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('maps a NOK status to a customer cancellation without calling the gateway', async () => {
    const harness = makeHarness();
    const verifySpy = vi.spyOn(harness.provider, 'verifyPayment');
    const { paymentId, authority } = await startPayment(harness);

    const response = await harness.service.callback({ Authority: authority, Status: 'NOK' });

    expect(response.outcome).toBe('CANCELLED');
    expect(harness.db.paymentById(paymentId)['status']).toBe('CANCELLED');
    expect(harness.db.paymentById(paymentId)['failureReason']).toBe('CUSTOMER_CANCELLED');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('maps an unrecognised status to an indeterminate provider response, not to success', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    const response = await harness.service.callback({ Authority: authority, Status: 'weird' });

    expect(response.outcome).toBe('FAILED');
    expect(harness.db.paymentById(paymentId)['failureReason']).toBe('UNKNOWN_PROVIDER_RESPONSE');
    expect(harness.trigger).not.toHaveBeenCalled();
  });

  it('records a payment attempt for every callback, successful or not', async () => {
    const harness = makeHarness();
    const { paymentId, authority } = await startPayment(harness);

    await harness.service.callback({ Authority: authority, Status: 'NOK' });
    await harness.service.callback({ Authority: authority, Status: 'NOK' });

    const attempts = harness.db.tables.paymentAttempt.filter(
      (row) => row['paymentId'] === paymentId && row['action'] === 'CALLBACK',
    );
    expect(attempts).toHaveLength(2);
    expect(attempts.map((row) => row['attemptNumber'])).toEqual([1, 2]);
  });
});

/* ============================================================================
 * Amount mismatch during verification
 * ==========================================================================*/

describe('PaymentsService verification amount checks', () => {
  function providerReturning(result: VerifyResult): RialPaymentProvider {
    const provider = new MockRialPaymentProvider();
    return new Proxy(provider, {
      get(target, property, receiver) {
        if (property === 'verifyPayment') return async () => result;
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as RialPaymentProvider;
  }

  it('refuses to mark PAID when the gateway reports a different amount', async () => {
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
    // The mock provider name must still match for the compound lookup.
    const response = await mismatchingHarness.service.callback({
      Authority: authority,
      Status: 'OK',
    });

    expect(response.outcome).toBe('FAILED');
    expect(mismatchingHarness.db.paymentById(paymentId)['status']).toBe('FAILED');
    expect(mismatchingHarness.db.paymentById(paymentId)['failureReason']).toBe('AMOUNT_MISMATCH');
    expect(auditActions(mismatchingHarness.audit)).toContain('AMOUNT_MISMATCH');
    expect(mismatchingHarness.db.tables.reconciliationIssue).toHaveLength(1);
    expect(mismatchingHarness.trigger).not.toHaveBeenCalled();
    expect(mismatchingHarness.db.tables.order[0]?.['status']).toBe('AWAITING_PAYMENT');
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

    expect(harness.db.tables.reconciliationIssue).toHaveLength(1);
    const issue = harness.db.tables.reconciliationIssue[0];
    expect(issue?.['paymentId']).toBe(paymentId);
    expect((issue?.['details'] as { reason: string }).reason).toBe(
      'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH',
    );

    // The order must not advance and fulfillment must not run on an unknown state.
    expect(harness.db.tables.order[0]?.['status']).toBe('AWAITING_PAYMENT');
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
    expect(harness.db.tables.order[0]?.['status']).toBe('AWAITING_PAYMENT');
    expect(harness.trigger).not.toHaveBeenCalled();
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
    expect(harness.trigger).not.toHaveBeenCalled();
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
 * In-memory stand-in for the Prisma delegates the payments service uses.
 *
 * Unit tests must never touch PostgreSQL or a payment gateway, but they must
 * still exercise the real idempotency logic — which is expressed as conditional
 * `updateMany` statements. So this fake implements the small slice of the query
 * surface `PaymentsService` actually calls: `{ in: [...] }` filters, the
 * `provider_providerAuthority` compound unique key, detached read results and
 * transaction rollback.
 * ==========================================================================*/

export type Row = Record<string, unknown>;

export type TableName =
  | 'quote'
  | 'order'
  | 'payment'
  | 'paymentAttempt'
  | 'reconciliationIssue';

export interface RecordedCall {
  readonly table: TableName;
  readonly operation: string;
  readonly args: Record<string, unknown>;
}

const TABLE_NAMES: readonly TableName[] = [
  'quote',
  'order',
  'payment',
  'paymentAttempt',
  'reconciliationIssue',
];

/** Columns that must read as `null` rather than `undefined` when never written. */
const NULLABLE_DEFAULTS: Readonly<Record<TableName, readonly string[]>> = {
  quote: ['acceptedAt'],
  order: ['paidAt'],
  payment: [
    'providerAuthority',
    'providerRefId',
    'providerRequestCode',
    'providerVerifyCode',
    'providerAmount',
    'providerAmountUnit',
    'providerFee',
    'providerFeeType',
    'maskedCard',
    'cardHash',
    'failureReason',
    'requestedAt',
    'redirectedAt',
    'callbackAt',
    'verifiedAt',
  ],
  paymentAttempt: ['providerCode', 'providerMessage', 'ip', 'userAgent', 'durationMs'],
  reconciliationIssue: ['paymentId', 'orderId', 'expectedAmountIrr', 'actualAmountIrr'],
};

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'bigint' || typeof right === 'bigint') {
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return String(left) === String(right);
  }
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    // Prisma compound unique keys arrive as a single nested object.
    if (key === 'provider_providerAuthority') {
      const compound = condition as Record<string, unknown>;
      if (
        !valuesEqual(row['provider'], compound['provider']) ||
        !valuesEqual(row['providerAuthority'], compound['providerAuthority'])
      ) {
        return false;
      }
      continue;
    }
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const operators = condition as Record<string, unknown>;
      if (Array.isArray(operators['in'])) {
        const candidates = operators['in'] as readonly unknown[];
        if (!candidates.some((candidate) => valuesEqual(row[key], candidate))) return false;
        continue;
      }
      if ('not' in operators) {
        if (valuesEqual(row[key], operators['not'])) return false;
        continue;
      }
      throw new Error(`Unsupported filter for "${key}" in the payments test database`);
    }
    if (!valuesEqual(row[key], condition)) return false;
  }
  return true;
}

class FakeTable {
  constructor(
    private readonly store: FakePaymentDatabase,
    private readonly name: TableName,
  ) {}

  private get rows(): Row[] {
    return this.store.tables[this.name];
  }

  private where(args: Record<string, unknown>): Record<string, unknown> {
    return (args['where'] as Record<string, unknown> | undefined) ?? {};
  }

  /**
   * Always returns a detached copy, like Prisma does. Handing out the live row
   * would hide read-your-own-stale-snapshot races, which is exactly what the
   * idempotency tests need to reproduce.
   */
  private hydrate(row: Row, args: Record<string, unknown>): Row {
    const include = args['include'] as Record<string, unknown> | undefined;
    if (include?.['quote'] === true) {
      const quote = this.store.tables.quote.find((candidate) =>
        valuesEqual(candidate['id'], row['quoteId']),
      );
      return { ...row, quote: quote === undefined ? null : { ...quote } };
    }
    return { ...row };
  }

  async findUnique(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'findUnique', args);
    const row = this.rows.find((candidate) => matchesWhere(candidate, this.where(args)));
    return row === undefined ? null : this.hydrate(row, args);
  }

  async findFirst(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'findFirst', args);
    const row = this.rows.find((candidate) => matchesWhere(candidate, this.where(args)));
    return row === undefined ? null : this.hydrate(row, args);
  }

  async create(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'create', args);
    const data = (args['data'] as Row | undefined) ?? {};
    const row: Row = {
      id: (data['id'] as string | undefined) ?? this.store.nextId(this.name),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...Object.fromEntries(NULLABLE_DEFAULTS[this.name].map((column) => [column, null])),
      ...data,
    };
    this.store.assertUniqueOnInsert(this.name, row);
    this.rows.push(row);
    return { ...row };
  }

  async update(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'update', args);
    const row = this.rows.find((candidate) => matchesWhere(candidate, this.where(args)));
    if (row === undefined) throw new Error(`No ${this.name} row matched update`);
    Object.assign(row, args['data'] as Row);
    return { ...row };
  }

  async updateMany(args: Record<string, unknown>): Promise<{ count: number }> {
    this.store.record(this.name, 'updateMany', args);
    const matched = this.rows.filter((candidate) => matchesWhere(candidate, this.where(args)));
    for (const row of matched) Object.assign(row, args['data'] as Row);
    return { count: matched.length };
  }

  async count(args: Record<string, unknown>): Promise<number> {
    this.store.record(this.name, 'count', args);
    return this.rows.filter((candidate) => matchesWhere(candidate, this.where(args))).length;
  }
}

export class FakePaymentDatabase implements PaymentDatabase {
  readonly tables: Record<TableName, Row[]> = {
    quote: [],
    order: [],
    payment: [],
    paymentAttempt: [],
    reconciliationIssue: [],
  };

  readonly calls: RecordedCall[] = [];

  readonly quote: unknown;
  readonly order: unknown;
  readonly payment: unknown;
  readonly paymentAttempt: unknown;
  readonly reconciliationIssue: unknown;

  private sequence = 0;

  constructor(seed: Partial<Record<TableName, readonly Row[]>> = {}) {
    for (const name of TABLE_NAMES) {
      this.tables[name] = [...(seed[name] ?? [])].map((row) => ({ ...row }));
    }
    this.quote = new FakeTable(this, 'quote');
    this.order = new FakeTable(this, 'order');
    this.payment = new FakeTable(this, 'payment');
    this.paymentAttempt = new FakeTable(this, 'paymentAttempt');
    this.reconciliationIssue = new FakeTable(this, 'reconciliationIssue');
  }

  nextId(name: TableName): string {
    this.sequence += 1;
    return `${name}-${this.sequence}`;
  }

  record(table: TableName, operation: string, args: Record<string, unknown>): void {
    this.calls.push({ table, operation, args });
  }

  callsFor(table: TableName, operation: string): readonly RecordedCall[] {
    return this.calls.filter((call) => call.table === table && call.operation === operation);
  }

  /** Mirrors the two unique constraints the payment flow depends on. */
  assertUniqueOnInsert(name: TableName, row: Row): void {
    if (name !== 'payment') return;
    for (const existing of this.tables.payment) {
      if (
        row['idempotencyKey'] !== undefined &&
        valuesEqual(existing['idempotencyKey'], row['idempotencyKey'])
      ) {
        throw new Error('Unique constraint failed on Payment.idempotencyKey');
      }
      if (
        row['providerAuthority'] !== undefined &&
        row['providerAuthority'] !== null &&
        valuesEqual(existing['provider'], row['provider']) &&
        valuesEqual(existing['providerAuthority'], row['providerAuthority'])
      ) {
        throw new Error('Unique constraint failed on Payment(provider, providerAuthority)');
      }
    }
  }

  /** Rolls the whole store back when the callback throws, like a real transaction. */
  async $transaction<T>(callback: (transaction: PaymentDatabase) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.tables);
    try {
      return await callback(this);
    } catch (error) {
      for (const name of TABLE_NAMES) this.tables[name] = snapshot[name];
      throw error;
    }
  }

  paymentById(id: string): Row {
    const row = this.tables.payment.find((candidate) => candidate['id'] === id);
    if (row === undefined) throw new Error(`No payment ${id}`);
    return row;
  }
}
