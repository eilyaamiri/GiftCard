import { describe, expect, it } from 'vitest';

import { MockRialPaymentProvider } from './mock-rial-payment.provider';

/**
 * The mock provider is a permanent part of the system, not scaffolding: it is
 * what lets every environment without ZarinPal credentials exercise the real
 * payment flow. These tests pin the behaviour the rest of the suite relies on.
 */
describe('MockRialPaymentProvider', () => {
  const createInput = {
    amountIrr: 5_000_000n,
    orderNumber: 'BP-1001',
    description: 'Barat Pay order',
    callbackUrl: 'https://api.barat.test/api/payments/zarinpal/callback',
    idempotencyKey: 'idem-1',
  };

  it('is deterministic: the same idempotency key yields the same authority', async () => {
    const first = await new MockRialPaymentProvider().createPayment(createInput);
    const second = await new MockRialPaymentProvider().createPayment(createInput);

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
  });

  it('derives a different authority for a different idempotency key', async () => {
    const provider = new MockRialPaymentProvider();
    const first = await provider.createPayment(createInput);
    const second = await provider.createPayment({ ...createInput, idempotencyKey: 'idem-2' });

    expect(first.ok && second.ok && first.authority).not.toBe(second.ok && second.authority);
  });

  it('forces a create failure and a create timeout exactly once each, in order', async () => {
    const provider = new MockRialPaymentProvider();
    provider.forceNextCreate('timeout');
    provider.forceNextCreate('failure');

    const timedOut = await provider.createPayment(createInput);
    const failed = await provider.createPayment(createInput);
    const succeeded = await provider.createPayment(createInput);

    expect(timedOut).toEqual({ ok: false, providerCode: null, failureReason: 'PROVIDER_TIMEOUT' });
    expect(failed).toEqual({ ok: false, providerCode: -1, failureReason: 'REQUEST_REJECTED' });
    expect(succeeded.ok).toBe(true);
  });

  it('reports the amount it was asked for, in IRR, with no unit conversion', async () => {
    const result = await new MockRialPaymentProvider().createPayment(createInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerAmount).toBe(5_000_000n);
    expect(result.providerAmountUnit).toBe('IRR');
  });

  it('forces each verify outcome, including already-verified', async () => {
    const provider = new MockRialPaymentProvider();
    const input = { authority: 'mock_abc', amountIrr: 5_000_000n };

    provider.forceNextVerify('timeout');
    expect((await provider.verifyPayment(input)).outcome).toBe('UNKNOWN');

    provider.forceNextVerify('failure');
    expect((await provider.verifyPayment(input)).outcome).toBe('FAILED');

    provider.forceNextVerify('already-verified');
    expect((await provider.verifyPayment(input)).outcome).toBe('ALREADY_VERIFIED');

    const verified = await provider.verifyPayment(input);
    expect(verified.outcome).toBe('VERIFIED');
    if (verified.outcome !== 'VERIFIED') return;
    expect(verified.maskedCard).toBe('6037********1234');
    expect(verified.refId).toMatch(/^\d+$/u);
  });

  it('never fakes a refund', async () => {
    const result = await new MockRialPaymentProvider().refund({
      authority: 'mock_abc',
      amountIrr: 5_000_000n,
      idempotencyKey: 'refund-1',
    });

    expect(result).toEqual({ outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' });
  });
});
