import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ZARINPAL_STARTPAY_URL,
  FetchPaymentHttpClient,
  normalizeZarinPalFailure,
  toZarinPalAmount,
  ZarinPalPaymentProvider,
  type PaymentHttpClient,
  type PaymentHttpResponse,
  type ZarinPalPaymentProviderConfig,
} from './zarinpal-payment.provider';

/* ============================================================================
 * Test doubles. Nothing in this file may reach the network.
 * ==========================================================================*/

const MERCHANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface CapturedRequest {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

class ScriptedHttpClient implements PaymentHttpClient {
  readonly requests: CapturedRequest[] = [];

  constructor(private readonly responses: readonly PaymentHttpResponse[]) {}

  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    _signal: AbortSignal,
  ): Promise<PaymentHttpResponse> {
    this.requests.push({ url, body: { ...body } });
    const response = this.responses[this.requests.length - 1];
    if (response === undefined) throw new Error('ScriptedHttpClient ran out of responses');
    return response;
  }
}

/** Never resolves; only the provider's own abort timer can end the call. */
class HangingHttpClient implements PaymentHttpClient {
  async postJson(
    _url: string,
    _body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<PaymentHttpResponse> {
    return new Promise<PaymentHttpResponse>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error('The request was aborted'));
      });
    });
  }
}

function jsonResponse(payload: unknown, init: { ok?: boolean; status?: number } = {}): PaymentHttpResponse {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  };
}

function provider(
  http: PaymentHttpClient,
  overrides: Partial<ZarinPalPaymentProviderConfig> = {},
): ZarinPalPaymentProvider {
  return new ZarinPalPaymentProvider(
    {
      merchantId: MERCHANT_ID,
      callbackUrl: 'https://api.barat.test/api/payments/zarinpal/callback',
      amountUnit: 'IRR',
      timeoutMs: 500,
      ...overrides,
    },
    http,
  );
}

const createInput = {
  amountIrr: 5_000_000n,
  orderNumber: 'BP-1001',
  description: 'Barat Pay order',
  callbackUrl: 'https://api.barat.test/api/payments/zarinpal/callback',
  idempotencyKey: 'idem-create-1',
};

/* ============================================================================
 * Amount units — the single highest-risk conversion in the system.
 * ==========================================================================*/

describe('toZarinPalAmount', () => {
  it('passes IRR straight through in IRR mode', () => {
    expect(toZarinPalAmount(5_000_000n, 'IRR')).toBe(5_000_000n);
    expect(toZarinPalAmount(1n, 'IRR')).toBe(1n);
    expect(toZarinPalAmount(1_234_567n, 'IRR')).toBe(1_234_567n);
  });

  it('divides by exactly ten in IRT mode', () => {
    expect(toZarinPalAmount(5_000_000n, 'IRT')).toBe(500_000n);
    expect(toZarinPalAmount(10n, 'IRT')).toBe(1n);
  });

  it('throws instead of rounding when IRR is not divisible by ten', () => {
    expect(() => toZarinPalAmount(1_234_567n, 'IRT')).toThrow(RangeError);
    expect(() => toZarinPalAmount(5n, 'IRT')).toThrow(/not exactly representable/u);
    // The tenth rial matters: a silent floor here loses real money on every order.
    expect(() => toZarinPalAmount(999n, 'IRT')).toThrow(RangeError);
  });

  it('rejects non-positive amounts in both units', () => {
    expect(() => toZarinPalAmount(0n, 'IRR')).toThrow(RangeError);
    expect(() => toZarinPalAmount(0n, 'IRT')).toThrow(RangeError);
    expect(() => toZarinPalAmount(-10n, 'IRT')).toThrow(RangeError);
  });
});

/* ============================================================================
 * Configuration must fail fast at construction, i.e. at boot.
 * ==========================================================================*/

describe('ZarinPalPaymentProvider configuration', () => {
  it('refuses a malformed merchant identifier', () => {
    expect(() => provider(new ScriptedHttpClient([]), { merchantId: 'not-a-merchant' })).toThrow(
      /merchant identifier is invalid/u,
    );
  });

  it('refuses a non-http endpoint or callback', () => {
    expect(() => provider(new ScriptedHttpClient([]), { requestUrl: 'ftp://x/y' })).toThrow(
      /request URL is invalid/u,
    );
    expect(() => provider(new ScriptedHttpClient([]), { callbackUrl: 'not a url' })).toThrow(
      /callback URL is invalid/u,
    );
  });

  it('refuses an out-of-range timeout', () => {
    expect(() => provider(new ScriptedHttpClient([]), { timeoutMs: 0 })).toThrow(/timeout/u);
    expect(() => provider(new ScriptedHttpClient([]), { timeoutMs: 60_001 })).toThrow(/timeout/u);
  });

  it('does not construct a real fetch client when one is supplied', () => {
    const http = new ScriptedHttpClient([]);
    expect(provider(http)).toBeInstanceOf(ZarinPalPaymentProvider);
    expect(http).not.toBeInstanceOf(FetchPaymentHttpClient);
  });
});

/* ============================================================================
 * createPayment
 * ==========================================================================*/

describe('ZarinPalPaymentProvider.createPayment', () => {
  it('sends the rial amount in IRR mode and returns the start-pay redirect', async () => {
    const http = new ScriptedHttpClient([
      jsonResponse({ data: { code: 100, authority: 'A00000000000000000000000000000001', fee: 5000, fee_type: 'Merchant' } }),
    ]);
    const result = await provider(http).createPayment(createInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerAmount).toBe(5_000_000n);
    expect(result.providerAmountUnit).toBe('IRR');
    expect(result.providerFeeIrr).toBe(5_000n);
    expect(result.redirectUrl).toBe(
      `${DEFAULT_ZARINPAL_STARTPAY_URL}/A00000000000000000000000000000001`,
    );
    expect(http.requests[0]?.body['amount']).toBe(5_000_000n);
  });

  it('sends the toman amount in IRT mode and scales the fee back to IRR', async () => {
    const http = new ScriptedHttpClient([
      jsonResponse({ data: { code: 100, authority: 'A2', fee: 500, fee_type: 'Merchant' } }),
    ]);
    const result = await provider(http, { amountUnit: 'IRT' }).createPayment(createInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerAmount).toBe(500_000n);
    expect(result.providerAmountUnit).toBe('IRT');
    expect(result.providerFeeIrr).toBe(5_000n);
    expect(http.requests[0]?.body['amount']).toBe(500_000n);
  });

  it('throws rather than truncating when an IRT order is not divisible by ten', async () => {
    const http = new ScriptedHttpClient([]);
    await expect(
      provider(http, { amountUnit: 'IRT' }).createPayment({ ...createInput, amountIrr: 5_000_001n }),
    ).rejects.toThrow(RangeError);
    expect(http.requests).toHaveLength(0);
  });

  it('normalises a rejected request instead of inventing an authority', async () => {
    const http = new ScriptedHttpClient([jsonResponse({ errors: { code: -50 } }, { ok: false, status: 400 })]);
    const result = await provider(http).createPayment(createInput);

    expect(result).toEqual({ ok: false, providerCode: -50, failureReason: 'AMOUNT_MISMATCH' });
  });

  it('treats a 5xx as a network error, not a rejection', async () => {
    const http = new ScriptedHttpClient([jsonResponse({}, { ok: false, status: 502 })]);
    const result = await provider(http).createPayment(createInput);

    expect(result).toEqual({ ok: false, providerCode: null, failureReason: 'PROVIDER_NETWORK_ERROR' });
  });

  it('rejects an over-long authority', async () => {
    const http = new ScriptedHttpClient([
      jsonResponse({ data: { code: 100, authority: 'A'.repeat(200) } }),
    ]);
    const result = await provider(http).createPayment(createInput);
    expect(result.ok).toBe(false);
  });
});

/* ============================================================================
 * verifyPayment
 * ==========================================================================*/

describe('ZarinPalPaymentProvider.verifyPayment', () => {
  const verifyInput = { authority: 'A00000000000000000000000000000001', amountIrr: 5_000_000n };

  it('maps code 100 to VERIFIED with a masked card and no raw pan', async () => {
    const http = new ScriptedHttpClient([
      jsonResponse({
        data: {
          code: 100,
          ref_id: 987_654_321,
          card_pan: '6037-9911-1234-5678',
          card_hash: 'C'.repeat(64),
          fee: 5000,
          fee_type: 'Merchant',
        },
      }),
    ]);
    const result = await provider(http).verifyPayment(verifyInput);

    expect(result.outcome).toBe('VERIFIED');
    if (result.outcome !== 'VERIFIED') return;
    expect(result.refId).toBe('987654321');
    expect(result.maskedCard).toBe('6037********5678');
    expect(result.maskedCard).not.toContain('9911');
    expect(result.providerAmount).toBe(5_000_000n);
    expect(result.providerFeeIrr).toBe(5_000n);
  });

  it('verifies with the toman amount in IRT mode', async () => {
    const http = new ScriptedHttpClient([jsonResponse({ data: { code: 100, ref_id: '42' } })]);
    const result = await provider(http, { amountUnit: 'IRT' }).verifyPayment(verifyInput);

    expect(http.requests[0]?.body['amount']).toBe(500_000n);
    expect(result.outcome).toBe('VERIFIED');
    if (result.outcome !== 'VERIFIED') return;
    expect(result.providerAmount).toBe(500_000n);
    expect(result.providerAmountUnit).toBe('IRT');
  });

  it('maps code 101 to ALREADY_VERIFIED rather than to a fresh success', async () => {
    const http = new ScriptedHttpClient([jsonResponse({ data: { code: 101, message: 'Verified' } })]);
    const result = await provider(http).verifyPayment(verifyInput);

    expect(result).toEqual({
      outcome: 'ALREADY_VERIFIED',
      providerCode: 101,
      authority: verifyInput.authority,
      providerAmount: 5_000_000n,
      providerAmountUnit: 'IRR',
    });
  });

  it('maps a missing ref_id on code 100 to UNKNOWN, never to success', async () => {
    const http = new ScriptedHttpClient([jsonResponse({ data: { code: 100 } })]);
    const result = await provider(http).verifyPayment(verifyInput);

    expect(result.outcome).toBe('UNKNOWN');
  });

  it('maps a definitive rejection to FAILED', async () => {
    const http = new ScriptedHttpClient([jsonResponse({ data: { code: -51 } })]);
    const result = await provider(http).verifyPayment(verifyInput);

    expect(result).toEqual({ outcome: 'FAILED', providerCode: -51, failureReason: 'VERIFY_FAILED' });
  });

  it('maps an indeterminate session code to UNKNOWN so money is never written off', async () => {
    for (const code of [-53, -52]) {
      const http = new ScriptedHttpClient([jsonResponse({ data: { code } })]);
      const result = await provider(http).verifyPayment(verifyInput);
      expect(result.outcome).toBe('UNKNOWN');
    }
  });

  it('reports a timeout as UNKNOWN with PROVIDER_TIMEOUT', async () => {
    const result = await provider(new HangingHttpClient(), { timeoutMs: 20 }).verifyPayment(verifyInput);

    expect(result).toEqual({
      outcome: 'UNKNOWN',
      providerCode: null,
      failureReason: 'PROVIDER_TIMEOUT',
    });
  });

  it('reports unreadable JSON as UNKNOWN_PROVIDER_RESPONSE', async () => {
    const http = new ScriptedHttpClient([
      {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      },
    ]);
    const result = await provider(http).verifyPayment(verifyInput);

    expect(result.outcome).toBe('FAILED');
    if (result.outcome === 'VERIFIED' || result.outcome === 'ALREADY_VERIFIED') return;
    expect(result.failureReason).toBe('UNKNOWN_PROVIDER_RESPONSE');
  });
});

describe('ZarinPalPaymentProvider.refund', () => {
  it('returns a typed NOT_SUPPORTED result instead of faking a refund', async () => {
    const result = await provider(new ScriptedHttpClient([])).refund({
      authority: 'A00000000000000000000000000000001',
      amountIrr: 5_000_000n,
      idempotencyKey: 'refund-1',
    });

    expect(result).toEqual({ outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' });
  });
});

describe('normalizeZarinPalFailure', () => {
  it('never returns a success-shaped reason for an unknown code', () => {
    expect(normalizeZarinPalFailure(-50, 'verify')).toBe('AMOUNT_MISMATCH');
    expect(normalizeZarinPalFailure(-54, 'verify')).toBe('INVALID_AUTHORITY');
    expect(normalizeZarinPalFailure(-51, 'verify')).toBe('VERIFY_FAILED');
    expect(normalizeZarinPalFailure(null, 'request')).toBe('UNKNOWN_PROVIDER_RESPONSE');
    expect(normalizeZarinPalFailure(-9, 'request')).toBe('REQUEST_REJECTED');
    expect(normalizeZarinPalFailure(-9, 'verify')).toBe('VERIFY_FAILED');
  });
});

/* ============================================================================
 * Secrecy and network isolation (AGENTS.md rule 10).
 * ==========================================================================*/

describe('ZarinPalPaymentProvider secrecy', () => {
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const method of consoleMethods) {
      spies.push(vi.spyOn(console, method).mockImplementation(() => undefined));
    }
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('A test attempted a real network call');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    spies.length = 0;
  });

  it('writes nothing to the console and opens no socket during a full round trip', async () => {
    const http = new ScriptedHttpClient([
      jsonResponse({ data: { code: 100, authority: 'A1' } }),
      jsonResponse({ data: { code: 100, ref_id: 1, card_pan: '6037991112345678' } }),
    ]);
    const subject = provider(http);

    await subject.createPayment(createInput);
    await subject.verifyPayment({ authority: 'A1', amountIrr: 5_000_000n });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the merchant id to the gateway but keeps it out of every returned value', async () => {
    const http = new ScriptedHttpClient([jsonResponse({ data: { code: 100, authority: 'A1' } })]);
    const result = await provider(http).createPayment(createInput);

    expect(http.requests[0]?.body['merchant_id']).toBe(MERCHANT_ID);
    expect(JSON.stringify(result, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(
      MERCHANT_ID,
    );
  });
});
