import { describe, expect, it } from 'vitest';

import type { PaymentHttpClient, PaymentHttpResponse } from '../zarinpal/zarinpal-payment.provider';
import {
  AMIN_ORDER_ID_PATTERN,
  AminPaymentProvider,
  buildAminOrderId,
  toAminMobile,
  type AminPaymentProviderConfig,
} from './amin-payment.provider';

/* ============================================================================
 * Test doubles. Nothing in this file may reach the network.
 * ==========================================================================*/

const MERCHANT_ID = 'merchant-id-do-not-leak';
const RETURN_URL = 'https://api.centohub.com/api/payments/amin/return';

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

class ScriptedHttpClient implements PaymentHttpClient {
  readonly requests: Captured[] = [];

  constructor(private readonly responses: readonly (PaymentHttpResponse | Error)[]) {}

  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    _signal: AbortSignal,
  ): Promise<PaymentHttpResponse> {
    this.requests.push({ url, body: { ...body } });
    const next = this.responses[this.requests.length - 1];
    if (next === undefined) throw new Error('ScriptedHttpClient ran out of responses');
    if (next instanceof Error) throw next;
    return next;
  }
}

class HangingHttpClient implements PaymentHttpClient {
  async postJson(_url: string, _body: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<PaymentHttpResponse> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
}

function json(payload: unknown, status = 200): PaymentHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function unreadable(status: number): PaymentHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('not json');
    },
  };
}

function provider(
  client: PaymentHttpClient,
  overrides: Partial<AminPaymentProviderConfig> = {},
): AminPaymentProvider {
  return new AminPaymentProvider({ merchantId: MERCHANT_ID, returnUrl: RETURN_URL, ...overrides }, client);
}

const createInput = {
  amountIrr: 1_250_000n,
  orderNumber: 'CEN-100245',
  description: 'CENTO order ord_1',
  callbackUrl: 'https://ignored.example/callback',
  idempotencyKey: 'idem-key-1',
} as const;

const ORDER_ID = buildAminOrderId(createInput.orderNumber, createInput.idempotencyKey);
const EVIDENCE = { ref_num: 'REF-9001', tracking_code: 'TRK-7788' } as const;
const VERIFY_INPUT = { authority: ORDER_ID, amountIrr: 1_250_000n, evidence: EVIDENCE } as const;

function confirmed(amount: unknown = 1_250_000, extra: Record<string, unknown> = {}) {
  return json({
    status: 'CONFIRMED',
    message: 'ok',
    data: { amount, ref_num: EVIDENCE.ref_num, card_number: '6037991234567890', ...extra },
  });
}

/* ============================================================================
 * Construction
 * ==========================================================================*/

describe('AminPaymentProvider construction', () => {
  it('names itself amin', () => {
    expect(provider(new ScriptedHttpClient([])).name).toBe('amin');
  });

  it('refuses a malformed merchant identifier without echoing it', () => {
    const bad = 'bad id with spaces';
    expect(() => provider(new ScriptedHttpClient([]), { merchantId: bad })).toThrow(/merchant identifier is invalid/u);
    try {
      provider(new ScriptedHttpClient([]), { merchantId: bad });
    } catch (error) {
      expect(String(error)).not.toContain(bad);
    }
  });

  it('refuses a malformed return URL, base URL and timeout', () => {
    expect(() => provider(new ScriptedHttpClient([]), { returnUrl: 'not a url' })).toThrow(/return URL/u);
    expect(() => provider(new ScriptedHttpClient([]), { baseUrl: 'ftp://x.example' })).toThrow(/base URL/u);
    expect(() => provider(new ScriptedHttpClient([]), { timeoutMs: 0 })).toThrow(/timeout/u);
    expect(() => provider(new ScriptedHttpClient([]), { timeoutMs: 60_001 })).toThrow(/timeout/u);
  });
});

describe('buildAminOrderId', () => {
  it('is stable for one key and different for another', () => {
    expect(buildAminOrderId('CEN-1', 'a')).toBe(buildAminOrderId('CEN-1', 'a'));
    expect(buildAminOrderId('CEN-1', 'a')).not.toBe(buildAminOrderId('CEN-1', 'b'));
  });

  it('always satisfies the shape the return endpoint accepts', () => {
    expect(AMIN_ORDER_ID_PATTERN.test(ORDER_ID)).toBe(true);
    expect(AMIN_ORDER_ID_PATTERN.test(buildAminOrderId('سفارش ۱۲۳ !!', 'k'))).toBe(true);
    expect(buildAminOrderId('x'.repeat(500), 'k').length).toBeLessThanOrEqual(80);
  });

  it('does not contain the idempotency key', () => {
    expect(ORDER_ID).not.toContain(createInput.idempotencyKey);
  });
});

describe('toAminMobile', () => {
  it.each([
    ['+989123456789', '09123456789'],
    ['989123456789', '09123456789'],
    ['09123456789', '09123456789'],
    ['  +989123456789 ', '09123456789'],
  ])('turns %s into the 11-digit form Amin accepts', (input, expected) => {
    expect(toAminMobile(input)).toBe(expected);
  });

  it.each([null, undefined, '', '12345', '+98912345678', '+9891234567890', '0912345678a', '+441234567890', '09123 456789'])(
    'leaves %s out instead of failing the payment',
    (input) => {
      expect(toAminMobile(input)).toBeNull();
    },
  );
});

describe('AminPaymentProvider customer mobile on the wire', () => {
  it('sends the canonical +98 number as 11 digits', async () => {
    const client = new ScriptedHttpClient([json({ token: 'tok1', ref_num: 'R1' })]);
    await provider(client).createPayment({ ...createInput, customerMobile: '+989123456789' });
    expect(client.requests[0]?.body.mobile).toBe('09123456789');
  });

  it('omits a mobile it cannot express rather than sending one Amin would reject', async () => {
    const client = new ScriptedHttpClient([json({ token: 'tok1', ref_num: 'R1' })]);
    const result = await provider(client).createPayment({ ...createInput, customerMobile: '+441234567890' });
    expect(client.requests[0]?.body).not.toHaveProperty('mobile');
    expect(result.ok).toBe(true);
  });
});

/* ============================================================================
 * createPayment
 * ==========================================================================*/

describe('AminPaymentProvider.createPayment', () => {
  it('posts the documented fields and builds the hosted-page URL from the token', async () => {
    const client = new ScriptedHttpClient([json({ token: 'tok_ABC-123', ref_num: 'R1', pgw_amount: '1250000' })]);
    const result = await provider(client).createPayment({
      ...createInput,
      customerMobile: '09123456789',
      customerEmail: 'a@b.example',
    });

    expect(result).toEqual({
      ok: true,
      authority: ORDER_ID,
      redirectUrl: 'https://api.aminremit.com/pgw/pay/tok_ABC-123',
      providerCode: 200,
      providerAmount: 1_250_000n,
      providerAmountUnit: 'IRR',
      providerFeeIrr: null,
      providerFeeType: null,
    });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.url).toBe('https://api.aminremit.com/api/v1/withdraw/');
    expect(client.requests[0]?.body).toEqual({
      merchant_id: MERCHANT_ID,
      order_id: ORDER_ID,
      amount: '1250000',
      callback_url: RETURN_URL,
      callback_method: 'GET',
      description: 'CENTO order ord_1',
      mobile: '09123456789',
      email: 'a@b.example',
    });
  });

  it('always uses our own return URL, never the one the caller passes', async () => {
    const client = new ScriptedHttpClient([json({ token: 'tok1', ref_num: 'R1' })]);
    await provider(client).createPayment(createInput);
    expect(client.requests[0]?.body.callback_url).toBe(RETURN_URL);
  });

  it('omits the optional customer fields when they are absent', async () => {
    const client = new ScriptedHttpClient([json({ token: 'tok1', ref_num: 'R1' })]);
    await provider(client).createPayment(createInput);
    expect(client.requests[0]?.body).not.toHaveProperty('mobile');
    expect(client.requests[0]?.body).not.toHaveProperty('email');
  });

  it('honours a configured base URL and trims its trailing slash', async () => {
    const client = new ScriptedHttpClient([json({ token: 'tok1', ref_num: 'R1' })]);
    const result = await provider(client, { baseUrl: 'https://sandbox.example/' }).createPayment(createInput);
    expect(client.requests[0]?.url).toBe('https://sandbox.example/api/v1/withdraw/');
    expect(result.ok && result.redirectUrl).toBe('https://sandbox.example/pgw/pay/tok1');
  });

  it('sends the amount as an exact integer string with no float anywhere', async () => {
    const client = new ScriptedHttpClient([json({ token: 'tok1', ref_num: 'R1' })]);
    await provider(client).createPayment({ ...createInput, amountIrr: 999_999_999n });
    expect(client.requests[0]?.body.amount).toBe('999999999');
  });

  it.each([49_999n, 0n, -5n, 1_000_000_001n])('refuses %s IRR without calling the gateway', async (amountIrr) => {
    const client = new ScriptedHttpClient([]);
    const result = await provider(client).createPayment({ ...createInput, amountIrr });
    expect(result).toEqual({ ok: false, providerCode: null, failureReason: 'REQUEST_REJECTED' });
    expect(client.requests).toHaveLength(0);
  });

  it('accepts the documented minimum and maximum', async () => {
    for (const amountIrr of [50_000n, 1_000_000_000n]) {
      const client = new ScriptedHttpClient([json({ token: 'tok1', ref_num: 'R1' })]);
      expect((await provider(client).createPayment({ ...createInput, amountIrr })).ok).toBe(true);
    }
  });

  it('turns a 400 into a rejected request and does not surface the gateway text', async () => {
    const client = new ScriptedHttpClient([json({ message: 'merchant id-do-not-leak is bad' }, 400)]);
    const result = await provider(client).createPayment(createInput);
    expect(result).toEqual({ ok: false, providerCode: 400, failureReason: 'REQUEST_REJECTED' });
  });

  it('treats a 5xx as a network error', async () => {
    const client = new ScriptedHttpClient([json({}, 502)]);
    expect(await provider(client).createPayment(createInput)).toEqual({
      ok: false,
      providerCode: null,
      failureReason: 'PROVIDER_NETWORK_ERROR',
    });
  });

  it('rejects a 200 with no usable token', async () => {
    for (const payload of [{}, { token: '' }, { token: 'has spaces' }, { token: 'a/b' }, { token: 5 }]) {
      const client = new ScriptedHttpClient([json(payload)]);
      expect(await provider(client).createPayment(createInput)).toEqual({
        ok: false,
        providerCode: 200,
        failureReason: 'UNKNOWN_PROVIDER_RESPONSE',
      });
    }
  });

  it('treats an unreadable 200 body as an unknown response', async () => {
    const client = new ScriptedHttpClient([unreadable(200)]);
    expect(await provider(client).createPayment(createInput)).toEqual({
      ok: false,
      providerCode: null,
      failureReason: 'UNKNOWN_PROVIDER_RESPONSE',
    });
  });

  it('reports a transport failure and a timeout distinctly', async () => {
    const failing = new ScriptedHttpClient([new Error('connect ECONNREFUSED')]);
    expect(await provider(failing).createPayment(createInput)).toEqual({
      ok: false,
      providerCode: null,
      failureReason: 'PROVIDER_NETWORK_ERROR',
    });

    const result = await provider(new HangingHttpClient(), { timeoutMs: 5 }).createPayment(createInput);
    expect(result).toEqual({ ok: false, providerCode: null, failureReason: 'PROVIDER_TIMEOUT' });
  });
});

/* ============================================================================
 * verifyPayment
 * ==========================================================================*/

describe('AminPaymentProvider.verifyPayment', () => {
  it('verifies with the documented fields and our own stored amount', async () => {
    const client = new ScriptedHttpClient([confirmed()]);
    const result = await provider(client).verifyPayment(VERIFY_INPUT);

    expect(client.requests[0]?.url).toBe('https://api.aminremit.com/api/v1/verify/');
    expect(client.requests[0]?.body).toEqual({
      merchant_id: MERCHANT_ID,
      order_id: ORDER_ID,
      amount: '1250000',
      tracking_code: 'TRK-7788',
      ref_num: 'REF-9001',
    });
    expect(result).toEqual({
      outcome: 'VERIFIED',
      providerCode: 100,
      authority: ORDER_ID,
      providerAmount: 1_250_000n,
      providerAmountUnit: 'IRR',
      refId: 'TRK-7788',
      maskedCard: '6037********7890',
      cardHash: null,
      providerFeeIrr: null,
      providerFeeType: null,
    });
  });

  it('never returns a full card number', async () => {
    const result = await provider(new ScriptedHttpClient([confirmed()])).verifyPayment(VERIFY_INPUT);
    expect(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(
      '6037991234567890',
    );
  });

  it.each([['1250000'], ['1250000.00'], [1_250_000]])('accepts an echoed amount of %s', async (amount) => {
    const result = await provider(new ScriptedHttpClient([confirmed(amount)])).verifyPayment(VERIFY_INPUT);
    expect(result.outcome).toBe('VERIFIED');
  });

  it('accepts a confirmation without a card number', async () => {
    const result = await provider(new ScriptedHttpClient([confirmed(1_250_000, { card_number: undefined })])).verifyPayment(
      VERIFY_INPUT,
    );
    expect(result.outcome === 'VERIFIED' && result.maskedCard).toBeNull();
  });

  it('is an AMOUNT_MISMATCH failure when the gateway echoes a different amount', async () => {
    for (const amount of [1_249_999, 1_250_001, '12500000']) {
      const result = await provider(new ScriptedHttpClient([confirmed(amount)])).verifyPayment(VERIFY_INPUT);
      expect(result).toEqual({ outcome: 'FAILED', providerCode: 100, failureReason: 'AMOUNT_MISMATCH' });
    }
  });

  it('does not act on a confirmation whose amount it cannot read', async () => {
    for (const data of [{}, { amount: 'abc' }, { amount: 1.5 }, { amount: -1 }, { amount: null }]) {
      const result = await provider(new ScriptedHttpClient([json({ status: 'CONFIRMED', data })])).verifyPayment(
        VERIFY_INPUT,
      );
      expect(result.outcome).toBe('UNKNOWN');
    }
    const noData = await provider(new ScriptedHttpClient([json({ status: 'CONFIRMED' })])).verifyPayment(VERIFY_INPUT);
    expect(noData.outcome).toBe('UNKNOWN');
  });

  it('does not act on a confirmation that echoes a different reference', async () => {
    const result = await provider(
      new ScriptedHttpClient([confirmed(1_250_000, { ref_num: 'SOMEONE-ELSE' })]),
    ).verifyPayment(VERIFY_INPUT);
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('only believes CONFIRMED on an HTTP 2xx', async () => {
    const result = await provider(
      new ScriptedHttpClient([json({ status: 'CONFIRMED', data: { amount: 1_250_000 } }, 400)]),
    ).verifyPayment(VERIFY_INPUT);
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('maps ALREADY_PAYED to ALREADY_VERIFIED for the same authority and amount', async () => {
    const result = await provider(new ScriptedHttpClient([json({ status: 'ALREADY_PAYED' })])).verifyPayment(VERIFY_INPUT);
    expect(result).toEqual({
      outcome: 'ALREADY_VERIFIED',
      providerCode: 101,
      authority: ORDER_ID,
      providerAmount: 1_250_000n,
      providerAmountUnit: 'IRR',
    });
  });

  it.each(['TRX_FAILED', 'INVALID_CARD', 'AMOUNT_LIMIT_EXCEEDED'])(
    'treats %s as the gateway\'s verdict that the payment failed',
    async (status) => {
      const result = await provider(new ScriptedHttpClient([json({ status }, 400)])).verifyPayment(VERIFY_INPUT);
      expect(result).toEqual({ outcome: 'FAILED', providerCode: 400, failureReason: 'VERIFY_FAILED' });
    },
  );

  it.each([
    'INVALID_REQUEST',
    'INVALID_GATEWAY',
    'RETRY_TOKEN',
    'INVALID_REF_NUM',
    'BAD_DATA',
    'CANNOT_VERIFY',
    'VERIFY_FAILED',
    'SYSTEM_FAILURE',
    'SOMETHING_NEW',
  ])('never lets %s close a payment as FAILED', async (status) => {
    const result = await provider(new ScriptedHttpClient([json({ status }, 400)])).verifyPayment(VERIFY_INPUT);
    expect(result.outcome).toBe('UNKNOWN');
  });

  it('is UNKNOWN on a transport error, a timeout, a 5xx or an unreadable body', async () => {
    const cases: [PaymentHttpClient, string][] = [
      [new ScriptedHttpClient([new Error('reset')]), 'PROVIDER_NETWORK_ERROR'],
      [new ScriptedHttpClient([json({}, 503)]), 'PROVIDER_NETWORK_ERROR'],
      [new ScriptedHttpClient([unreadable(200)]), 'UNKNOWN_PROVIDER_RESPONSE'],
      [new ScriptedHttpClient([json({ nothing: true })]), 'UNKNOWN_PROVIDER_RESPONSE'],
    ];
    for (const [client, failureReason] of cases) {
      const result = await provider(client).verifyPayment(VERIFY_INPUT);
      expect(result).toMatchObject({ outcome: 'UNKNOWN', failureReason });
    }
    const hung = await provider(new HangingHttpClient(), { timeoutMs: 5 }).verifyPayment(VERIFY_INPUT);
    expect(hung).toMatchObject({ outcome: 'UNKNOWN', failureReason: 'PROVIDER_TIMEOUT' });
  });

  it('does not call the gateway without the callback evidence', async () => {
    const client = new ScriptedHttpClient([]);
    const result = await provider(client).verifyPayment({ authority: ORDER_ID, amountIrr: 1_250_000n });
    expect(result).toEqual({ outcome: 'UNKNOWN', providerCode: null, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' });
    expect(client.requests).toHaveLength(0);
  });

  it('does not call the gateway with malformed evidence or authority', async () => {
    const client = new ScriptedHttpClient([]);
    const bad = [
      { ...VERIFY_INPUT, evidence: { ref_num: 'has space', tracking_code: 'ok' } },
      { ...VERIFY_INPUT, evidence: { ref_num: 'ok', tracking_code: '' } },
      { ...VERIFY_INPUT, evidence: { ref_num: 'ok' } },
      { ...VERIFY_INPUT, authority: 'bad authority!' },
    ];
    for (const input of bad) {
      expect((await provider(client).verifyPayment(input)).outcome).toBe('UNKNOWN');
    }
    expect(client.requests).toHaveLength(0);
  });

  it('keeps the merchant identifier out of every result', async () => {
    const results = [
      await provider(new ScriptedHttpClient([confirmed()])).verifyPayment(VERIFY_INPUT),
      await provider(new ScriptedHttpClient([json({ status: 'BAD_DATA' }, 400)])).verifyPayment(VERIFY_INPUT),
      await provider(new ScriptedHttpClient([new Error(`boom ${MERCHANT_ID}`)])).verifyPayment(VERIFY_INPUT),
    ];
    for (const result of results) expect(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(MERCHANT_ID);
  });
});

/* ============================================================================
 * getPaymentStatus and refund
 * ==========================================================================*/

describe('AminPaymentProvider status and refund', () => {
  it('reports PAID for a confirmation and ALREADY_VERIFIED for a replay', async () => {
    expect(await provider(new ScriptedHttpClient([confirmed()])).getPaymentStatus(VERIFY_INPUT)).toEqual({
      status: 'PAID',
      providerCode: 100,
    });
    expect(
      await provider(new ScriptedHttpClient([json({ status: 'ALREADY_PAYED' })])).getPaymentStatus(VERIFY_INPUT),
    ).toEqual({ status: 'ALREADY_VERIFIED', providerCode: 101 });
  });

  it('reports UNKNOWN when the gateway cannot be asked', async () => {
    const status = await provider(new ScriptedHttpClient([])).getPaymentStatus({
      authority: ORDER_ID,
      amountIrr: 1_250_000n,
    });
    expect(status).toMatchObject({ status: 'UNKNOWN' });
  });

  it('never pretends to refund', async () => {
    expect(
      await provider(new ScriptedHttpClient([])).refund({ authority: ORDER_ID, amountIrr: 1n, idempotencyKey: 'k' }),
    ).toEqual({ outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' });
  });
});
