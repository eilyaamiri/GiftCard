import { describe, expect, it } from 'vitest';

import { MockRialPaymentProvider } from '../../integrations/payments/src/providers/mock-rial-payment.provider';

describe('payment integration contract', () => {
  it('creates and verifies a payment through the provider interface', async () => {
    const provider = new MockRialPaymentProvider();
    const created = await provider.createPayment({
      amountIrr: 46_370_000n,
      orderNumber: 'BP-TEST-000001',
      callbackUrl: 'https://example.test/payment/callback',
      description: 'test payment',
      idempotencyKey: 'payment-integration-1',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const verified = await provider.verifyPayment({
      authority: created.authority,
      amountIrr: 46_370_000n,
    });
    expect(verified.outcome).toBe('VERIFIED');
    if (verified.outcome === 'VERIFIED') {
      expect(verified.providerAmount).toBe(46_370_000n);
      expect(verified.refId).toMatch(/^\d+$/u);
    }
  });

  it('exposes timeout as UNKNOWN instead of treating it as paid', async () => {
    const provider = new MockRialPaymentProvider({ defaultVerifyOutcome: 'timeout' });
    const result = await provider.verifyPayment({
      authority: 'mock_timeout',
      amountIrr: 1_000n,
    });
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.failureReason).toBe('PROVIDER_TIMEOUT');
  });
});
