import { describe, expect, it } from 'vitest';

import {
  BAZAARPAY_MAX_AMOUNT,
  BazaarPayPaymentProvider,
  toBazaarPayAmount,
  type BazaarPayHttpClient,
  type BazaarPayHttpResponse,
  type BazaarPayPaymentProviderConfig,
} from './bazaarpay-payment.provider';

/* ============================================================================
 * Test doubles. Nothing in this file may reach the network.
 * ==========================================================================*/

const TOKEN = 'merchant-token-do-not-leak';

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;
}

class ScriptedHttpClient implements BazaarPayHttpClient {
  readonly requests: Captured[] = [];

  constructor(private readonly responses: readonly (BazaarPayHttpResponse | Error)[]) {}

  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
    _signal: AbortSignal,
  ): Promise<BazaarPayHttpResponse> {
    this.requests.push({ url, body: { ...body }, headers: { ...headers } });
    const next = this.responses[this.requests.length - 1];
    if (next === undefined) throw new Error('ScriptedHttpClient ran out of responses');
    if (next instanceof Error) throw next;
    return next;
  }
}

class HangingHttpClient implements BazaarPayHttpClient {
  async postJson(
    _url: string,
    _body: Readonly<Record<string, unknown>>,
    _headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<BazaarPayHttpResponse> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
}

function json(payload: unknown, status = 200): BazaarPayHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function noBody(status: number): BazaarPayHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
}

const CONFIG: BazaarPayPaymentProviderConfig = {
  apiToken: TOKEN,
  destination: 'centohub',
  returnUrl: 'https://www.centohub.com/api/payments/bazaarpay/return',
};

function provider(client: BazaarPayHttpClient, overrides: Partial<BazaarPayPaymentProviderConfig> = {}) {
  return new BazaarPayPaymentProvider({ ...CONFIG, ...overrides }, client);
}

const INIT_OK = {
  checkout_token: '3258455376',
  payment_url: 'https://app.bazaar-pay.ir/payment?token=3258455376',
};

const CREATE_INPUT = {
  amountIrr: 500_000n,
  orderNumber: 'BP-2026-000200',
  description: 'CENTO order cmorder1',
  callbackUrl: 'https://unused.example/callback',
  idempotencyKey: 'idem-key-0000000001',
};

/* ============================================================================
 * Amount conversion
 * ==========================================================================*/

describe('toBazaarPayAmount', () => {
  it('passes rial through untouched', () => {
    expect(toBazaarPayAmount(123_456_780n, 'IRR')).toBe(123_456_780n);
  });

  it('converts to toman exactly, and refuses what it cannot represent', () => {
    expect(toBazaarPayAmount(500_000n, 'IRT')).toBe(50_000n);
    expect(() => toBazaarPayAmount(500_001n, 'IRT')).toThrow(RangeError);
  });

  it('refuses zero and negative amounts', () => {
    expect(() => toBazaarPayAmount(0n, 'IRR')).toThrow(RangeError);
    expect(() => toBazaarPayAmount(-10n, 'IRR')).toThrow(RangeError);
  });
});

/* ============================================================================
 * Construction
 * ==========================================================================*/

describe('BazaarPayPaymentProvider construction', () => {
  const client = new ScriptedHttpClient([]);

  it.each([
    ['empty token', { apiToken: '' }, /API token/u],
    ['token with whitespace', { apiToken: 'a b' }, /API token/u],
    ['bad destination', { destination: 'has space' }, /destination/u],
    ['bad return URL', { returnUrl: 'not a url' }, /return URL/u],
    ['bad base URL', { baseUrl: 'ftp://x' }, /base URL/u],
    ['bad unit', { amountUnit: 'USD' as never }, /amount unit/u],
    ['zero timeout', { timeoutMs: 0 }, /timeout/u],
  ])('refuses %s at boot', (_name, overrides, message) => {
    expect(() => provider(client, overrides)).toThrow(message);
  });

  it('never puts the token into a construction error', () => {
    try {
      provider(client, { destination: 'bad dest', apiToken: TOKEN });
    } catch (error) {
      expect(String(error)).not.toContain(TOKEN);
    }
  });
});

/* ============================================================================
 * createPayment
 * ==========================================================================*/

describe('createPayment', () => {
  it('opens a checkout with exactly the documented body and the Token header', async () => {
    const http = new ScriptedHttpClient([json(INIT_OK)]);
    const result = await provider(http).createPayment(CREATE_INPUT);

    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.url).toBe('https://api.bazaar-pay.ir/badje/v1/checkout/init/');
    expect(http.requests[0]?.body).toEqual({
      amount: 500_000,
      destination: 'centohub',
      service_name: 'CENTO order cmorder1',
    });
    expect(http.requests[0]?.headers['authorization']).toBe(`Token ${TOKEN}`);
    expect(http.requests[0]?.headers['content-type']).toBe('application/json');
    expect(http.requests[0]?.headers['user-agent']).toContain('CENTO');

    expect(result).toMatchObject({
      ok: true,
      authority: '3258455376',
      providerAmount: 500_000n,
      providerAmountUnit: 'IRR',
      providerFeeIrr: null,
    });
  });

  it('sends the toman amount when the merchant unit is toman', async () => {
    const http = new ScriptedHttpClient([json(INIT_OK)]);
    const result = await provider(http, { amountUnit: 'IRT' }).createPayment(CREATE_INPUT);

    expect(http.requests[0]?.body['amount']).toBe(50_000);
    expect(result).toMatchObject({ ok: true, providerAmount: 50_000n, providerAmountUnit: 'IRT' });
  });

  it('attaches our own return URL, carrying the token and the order, to the hosted page', async () => {
    const http = new ScriptedHttpClient([json(INIT_OK)]);
    const result = await provider(http).createPayment(CREATE_INPUT);
    if (!result.ok) throw new Error('expected ok');

    const page = new URL(result.redirectUrl);
    expect(page.origin + page.pathname).toBe('https://app.bazaar-pay.ir/payment');
    expect(page.searchParams.get('token')).toBe('3258455376');
    const back = new URL(page.searchParams.get('redirect_url') ?? '');
    expect(back.origin + back.pathname).toBe('https://www.centohub.com/api/payments/bazaarpay/return');
    expect(back.searchParams.get('token')).toBe('3258455376');
    expect(back.searchParams.get('order')).toBe('BP-2026-000200');
  });

  it('refuses a payment page outside bazaar-pay.ir rather than sending a customer there', async () => {
    for (const hostile of [
      'https://evil.example/payment?token=3258455376',
      'https://bazaar-pay.ir.evil.example/payment',
      'http://app.bazaar-pay.ir/payment',
      'javascript:alert(1)',
    ]) {
      const http = new ScriptedHttpClient([json({ ...INIT_OK, payment_url: hostile })]);
      const result = await provider(http).createPayment(CREATE_INPUT);
      expect(result).toMatchObject({ ok: false, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' });
    }
  });

  it.each([
    ['no token', { payment_url: INIT_OK.payment_url }],
    ['token with a path separator', { checkout_token: '../x', payment_url: INIT_OK.payment_url }],
    ['numeric token', { checkout_token: 123, payment_url: INIT_OK.payment_url }],
    ['no payment_url', { checkout_token: '3258455376' }],
    ['not an object', 'ok'],
  ])('treats a malformed init response (%s) as unknown, not as success', async (_name, payload) => {
    const result = await provider(new ScriptedHttpClient([json(payload)])).createPayment(CREATE_INPUT);
    expect(result).toMatchObject({ ok: false, failureReason: 'UNKNOWN_PROVIDER_RESPONSE' });
  });

  it('refuses an amount above the documented ceiling without calling the gateway', async () => {
    const http = new ScriptedHttpClient([]);
    const result = await provider(http).createPayment({
      ...CREATE_INPUT,
      amountIrr: BAZAARPAY_MAX_AMOUNT + 1n,
    });

    expect(result).toMatchObject({ ok: false, failureReason: 'REQUEST_REJECTED' });
    expect(http.requests).toHaveLength(0);
  });

  it('reports a 4xx as a rejection and a 5xx or network error as indeterminate', async () => {
    expect(
      await provider(new ScriptedHttpClient([json({ amount: ['bad'] }, 400)])).createPayment(CREATE_INPUT),
    ).toMatchObject({ ok: false, providerCode: 400, failureReason: 'REQUEST_REJECTED' });
    expect(
      await provider(new ScriptedHttpClient([json({ detail: 'x' }, 401)])).createPayment(CREATE_INPUT),
    ).toMatchObject({ ok: false, providerCode: 401, failureReason: 'REQUEST_REJECTED' });
    expect(
      await provider(new ScriptedHttpClient([noBody(503)])).createPayment(CREATE_INPUT),
    ).toMatchObject({ ok: false, failureReason: 'PROVIDER_NETWORK_ERROR' });
    expect(
      await provider(new ScriptedHttpClient([new Error('ECONNRESET')])).createPayment(CREATE_INPUT),
    ).toMatchObject({ ok: false, failureReason: 'PROVIDER_NETWORK_ERROR' });
  });

  it('reports a timeout as PROVIDER_TIMEOUT', async () => {
    const result = await provider(new HangingHttpClient(), { timeoutMs: 20 }).createPayment(CREATE_INPUT);
    expect(result).toMatchObject({ ok: false, failureReason: 'PROVIDER_TIMEOUT' });
  });

  it('never makes a second init call on its own, even after a timeout', async () => {
    const http = new ScriptedHttpClient([new Error('socket hang up')]);
    await provider(http).createPayment(CREATE_INPUT);
    expect(http.requests).toHaveLength(1);
  });
});

/* ============================================================================
 * Auto-login — skip BazaarPay's own login for a customer signed in with us
 * ==========================================================================*/

const ACCESS_TOKEN_PATH = '/merchant/create-user-access-token/';
const LOGIN_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.user-login-token-do-not-leak.sig';

/** Answers by path, because init and the token request run side by side. */
class RoutedHttpClient implements BazaarPayHttpClient {
  readonly requests: Captured[] = [];

  constructor(private readonly routes: Readonly<Record<string, BazaarPayHttpResponse | Error | 'hang'>>) {}

  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<BazaarPayHttpResponse> {
    this.requests.push({ url, body: { ...body }, headers: { ...headers } });
    const path = new URL(url).pathname.replace(/^\/badje\/v1/u, '');
    const route = this.routes[path];
    if (route === undefined) throw new Error(`RoutedHttpClient has no route for ${path}`);
    if (route === 'hang') {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (route instanceof Error) throw route;
    return route;
  }

  paths(): string[] {
    return this.requests.map((request) => new URL(request.url).pathname.replace(/^\/badje\/v1/u, ''));
  }
}

const SIGNED_IN = { ...CREATE_INPUT, customerMobile: '09121234567' };

async function pageFor(
  http: BazaarPayHttpClient,
  input: typeof CREATE_INPUT & { customerMobile?: string | null },
  overrides: Partial<BazaarPayPaymentProviderConfig> = { autoLogin: true },
): Promise<URL> {
  const result = await provider(http, overrides).createPayment(input);
  if (!result.ok) throw new Error(`expected ok, got ${result.failureReason}`);
  return new URL(result.redirectUrl);
}

describe('createPayment auto-login', () => {
  it('requests a purchase-scoped login token for the mobile and puts it on the payment page', async () => {
    const http = new RoutedHttpClient({
      '/checkout/init/': json(INIT_OK),
      [ACCESS_TOKEN_PATH]: json({ access_token: LOGIN_TOKEN }),
    });
    const page = await pageFor(http, SIGNED_IN);

    const tokenRequest = http.requests.find((request) => request.url.endsWith(ACCESS_TOKEN_PATH));
    expect(tokenRequest?.url).toBe('https://api.bazaar-pay.ir/badje/v1/merchant/create-user-access-token/');
    expect(tokenRequest?.body).toEqual({ user_phone_number: '09121234567', scope: 'purchase' });
    expect(tokenRequest?.headers['authorization']).toBe(`Token ${TOKEN}`);

    expect(page.searchParams.get('auto_login_token')).toBe(LOGIN_TOKEN);
    expect(page.searchParams.get('phone')).toBe('09121234567');
    expect(page.searchParams.get('token')).toBe('3258455376');
    // The return address is still intact next to the new parameters.
    expect(new URL(page.searchParams.get('redirect_url') ?? '').searchParams.get('order')).toBe('BP-2026-000200');
  });

  it('is off unless configured: no token request, but the mobile still pre-fills the login', async () => {
    const http = new RoutedHttpClient({ '/checkout/init/': json(INIT_OK) });
    const page = await pageFor(http, SIGNED_IN, {});

    expect(http.paths()).toEqual(['/checkout/init/']);
    expect(page.searchParams.has('auto_login_token')).toBe(false);
    expect(page.searchParams.get('phone')).toBe('09121234567');
  });

  it('asks for nothing when the caller has no mobile for the customer', async () => {
    const http = new RoutedHttpClient({ '/checkout/init/': json(INIT_OK) });
    const page = await pageFor(http, { ...CREATE_INPUT, customerMobile: null });

    expect(http.paths()).toEqual(['/checkout/init/']);
    expect(page.searchParams.has('auto_login_token')).toBe(false);
    expect(page.searchParams.has('phone')).toBe(false);
  });

  it.each([
    ['98 prefix', '989121234567'],
    ['+98 prefix', '+989121234567'],
    ['surrounding spaces', ' 09121234567 '],
  ])('normalises a mobile with %s to the 09 form', async (_name, mobile) => {
    const http = new RoutedHttpClient({
      '/checkout/init/': json(INIT_OK),
      [ACCESS_TOKEN_PATH]: json({ access_token: LOGIN_TOKEN }),
    });
    const page = await pageFor(http, { ...CREATE_INPUT, customerMobile: mobile });

    expect(http.requests.find((request) => request.url.endsWith(ACCESS_TOKEN_PATH))?.body['user_phone_number']).toBe(
      '09121234567',
    );
    expect(page.searchParams.get('phone')).toBe('09121234567');
  });

  it.each([['landline', '02112345678'], ['too short', '0912123456'], ['e-mail', 'a@b.ir'], ['empty', '']])(
    'sends neither a token request nor a phone for a %s',
    async (_name, mobile) => {
      const http = new RoutedHttpClient({ '/checkout/init/': json(INIT_OK) });
      const page = await pageFor(http, { ...CREATE_INPUT, customerMobile: mobile });

      expect(http.paths()).toEqual(['/checkout/init/']);
      expect(page.searchParams.has('phone')).toBe(false);
    },
  );

  it.each([
    ['403 (auto-login not enabled for the merchant)', json({ detail: 'You cannot use auto-login for purchase.' }, 403)],
    ['401', json({ detail: 'x' }, 401)],
    ['503', noBody(503)],
    ['network error', new Error('ECONNRESET')],
    ['no access_token', json({})],
    ['a token with a space', json({ access_token: 'two words' })],
    ['a non-string token', json({ access_token: 12345 })],
  ])('falls back to the normal login when the token request yields %s', async (_name, answer) => {
    const http = new RoutedHttpClient({ '/checkout/init/': json(INIT_OK), [ACCESS_TOKEN_PATH]: answer });
    const page = await pageFor(http, SIGNED_IN);

    expect(page.searchParams.has('auto_login_token')).toBe(false);
    expect(page.searchParams.get('phone')).toBe('09121234567');
    expect(page.searchParams.get('token')).toBe('3258455376');
  });

  it('does not let a hanging token request hold the checkout beyond its own short timeout', async () => {
    const http = new RoutedHttpClient({ '/checkout/init/': json(INIT_OK), [ACCESS_TOKEN_PATH]: 'hang' });
    const page = await pageFor(http, SIGNED_IN, { autoLogin: true, timeoutMs: 30 });

    expect(page.searchParams.has('auto_login_token')).toBe(false);
  });

  it('keeps an init failure a failure, and never surfaces the login token in it', async () => {
    const http = new RoutedHttpClient({
      '/checkout/init/': json({ amount: ['bad'] }, 400),
      [ACCESS_TOKEN_PATH]: json({ access_token: LOGIN_TOKEN }),
    });
    const result = await provider(http, { autoLogin: true }).createPayment(SIGNED_IN);

    expect(result).toMatchObject({ ok: false, providerCode: 400, failureReason: 'REQUEST_REJECTED' });
    expect(JSON.stringify(result)).not.toContain(LOGIN_TOKEN);
  });
});

/* ============================================================================
 * verifyPayment — read-only, status from /trace/
 * ==========================================================================*/

describe('verifyPayment', () => {
  const INPUT = { authority: '3258455376', amountIrr: 500_000n };

  async function verify(status: unknown) {
    const http = new ScriptedHttpClient([json({ status })]);
    const result = await provider(http).verifyPayment(INPUT);
    return { result, http };
  }

  it('treats paid_not_committed as VERIFIED with the amount WE stored, and never commits', async () => {
    const { result, http } = await verify('paid_not_committed');

    expect(result).toMatchObject({
      outcome: 'VERIFIED',
      providerCode: 100,
      authority: '3258455376',
      providerAmount: 500_000n,
      providerAmountUnit: 'IRR',
      refId: '3258455376',
      maskedCard: null,
      cardHash: null,
    });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.url).toBe('https://api.bazaar-pay.ir/badje/v1/trace/');
    expect(http.requests[0]?.body).toEqual({ checkout_token: '3258455376' });
  });

  it('treats paid_committed as ALREADY_VERIFIED', async () => {
    expect((await verify('paid_committed')).result).toMatchObject({
      outcome: 'ALREADY_VERIFIED',
      providerCode: 101,
    });
  });

  it('reports the customer leaving without paying as a cancellation', async () => {
    expect((await verify('unpaid')).result).toMatchObject({
      outcome: 'FAILED',
      failureReason: 'CUSTOMER_CANCELLED',
    });
  });

  it.each([
    ['invalid_token', 'INVALID_AUTHORITY'],
    ['paid_not_committed_refunded', 'VERIFY_FAILED'],
    ['timed_out', 'VERIFY_FAILED'],
  ])('reports %s as a failure', async (status, reason) => {
    expect((await verify(status)).result).toMatchObject({ outcome: 'FAILED', failureReason: reason });
  });

  it('sends a refunded checkout to a person instead of settling it', async () => {
    expect((await verify('refunded')).result).toMatchObject({ outcome: 'UNKNOWN' });
  });

  it.each([['totally_new_status'], [''], [42], [null], [undefined]])(
    'never reads an unrecognised status (%s) as paid',
    async (status) => {
      const { result } = await verify(status);
      expect(result.outcome).toBe('UNKNOWN');
    },
  );

  it('keeps an unreachable gateway UNKNOWN rather than FAILED, because the customer may have paid', async () => {
    for (const client of [
      new ScriptedHttpClient([noBody(502)]),
      new ScriptedHttpClient([new Error('ETIMEDOUT')]),
      new HangingHttpClient(),
    ]) {
      const result = await provider(client, { timeoutMs: 20 }).verifyPayment(INPUT);
      expect(result.outcome).toBe('UNKNOWN');
    }
  });

  it('treats a 4xx trace as a failed authority', async () => {
    const result = await provider(new ScriptedHttpClient([json({ checkout_token: ['bad'] }, 400)])).verifyPayment(INPUT);
    expect(result).toMatchObject({ outcome: 'FAILED', failureReason: 'INVALID_AUTHORITY' });
  });

  it.each([[401], [403], [408], [409], [429]])(
    'keeps a %s trace UNKNOWN: it is about us or the gateway, not about whether the customer paid',
    async (status) => {
      const result = await provider(new ScriptedHttpClient([json({ detail: 'x' }, status)])).verifyPayment(INPUT);
      expect(result.outcome).toBe('UNKNOWN');
    },
  );

  it('getPaymentStatus agrees with verifyPayment', async () => {
    expect(
      await provider(new ScriptedHttpClient([json({ status: 'paid_not_committed' })])).getPaymentStatus(INPUT),
    ).toEqual({ status: 'PAID', providerCode: 100 });
    expect(
      await provider(new ScriptedHttpClient([json({ status: 'paid_committed' })])).getPaymentStatus(INPUT),
    ).toEqual({ status: 'ALREADY_VERIFIED', providerCode: 101 });
  });
});

/* ============================================================================
 * confirmPayment — the only place that commits
 * ==========================================================================*/

describe('confirmPayment', () => {
  const INPUT = { authority: '3258455376' };

  it('commits with the documented body and succeeds on 204', async () => {
    const http = new ScriptedHttpClient([noBody(204)]);
    const result = await provider(http).confirmPayment(INPUT);

    expect(result).toEqual({ confirmed: true });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]?.url).toBe('https://api.bazaar-pay.ir/badje/v1/commit/');
    expect(http.requests[0]?.body).toEqual({ checkout_token: '3258455376' });
    expect(http.requests[0]?.headers['authorization']).toBe(`Token ${TOKEN}`);
  });

  it('asks the gateway before giving up: a commit whose reply was lost may have landed', async () => {
    const http = new ScriptedHttpClient([new Error('ECONNRESET'), json({ status: 'paid_committed' })]);
    const result = await provider(http).confirmPayment(INPUT);

    expect(result).toEqual({ confirmed: true });
    expect(http.requests.map((request) => request.url)).toEqual([
      'https://api.bazaar-pay.ir/badje/v1/commit/',
      'https://api.bazaar-pay.ir/badje/v1/trace/',
    ]);
  });

  it('is not confirmed when the gateway still says the charge is uncommitted', async () => {
    const http = new ScriptedHttpClient([noBody(503), json({ status: 'paid_not_committed' })]);
    const result = await provider(http).confirmPayment(INPUT);

    expect(result).toMatchObject({ confirmed: false });
  });

  it('is not confirmed when the commit is rejected and the charge is not committed', async () => {
    const http = new ScriptedHttpClient([json({ detail: 'nope' }, 400), json({ status: 'timed_out' })]);
    expect(await provider(http).confirmPayment(INPUT)).toMatchObject({ confirmed: false, providerCode: 400 });
  });

  it('is not confirmed when neither call gets an answer', async () => {
    const http = new ScriptedHttpClient([new Error('down'), new Error('down')]);
    expect(await provider(http).confirmPayment(INPUT)).toMatchObject({
      confirmed: false,
      failureReason: 'PROVIDER_NETWORK_ERROR',
    });
  });
});

describe('refund', () => {
  it('never claims a refund it did not perform', async () => {
    const http = new ScriptedHttpClient([]);
    expect(
      await provider(http).refund({ authority: 'x', amountIrr: 10n, idempotencyKey: 'k'.repeat(16) }),
    ).toEqual({ outcome: 'NOT_SUPPORTED', failureReason: 'NOT_SUPPORTED' });
    expect(http.requests).toHaveLength(0);
  });
});
