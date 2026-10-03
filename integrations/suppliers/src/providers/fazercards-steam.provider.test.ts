import { afterEach, describe, expect, it } from 'vitest';

import {
  FazerCardsSteamSupplierError,
  FazerCardsSteamSupplierProvider,
  formatFazerCardsSteamProviderSku,
  parseFazerCardsSteamProviderSku,
  STEAM_CUSTOM_AMOUNT_SKU,
} from './fazercards-steam.provider';

const ORIGINAL_FETCH = globalThis.fetch;
const NOW = new Date('2026-10-03T10:00:00.000Z');

interface Route {
  readonly status?: number;
  readonly body?: unknown;
  readonly text?: string;
  readonly fail?: boolean;
}

interface Call {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

const key = (method: string, url: string): string =>
  `${method} ${new URL(url).pathname.replace(/^\/api\/v2/u, '')}`;

function stubFetch(routes: Record<string, Route>): { calls: Map<string, Call[]>; count: (k: string) => number } {
  const calls = new Map<string, Call[]>();
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const k = key(method, String(input));
    calls.set(k, [
      ...(calls.get(k) ?? []),
      {
        method,
        headers: (init.headers as Record<string, string>) ?? {},
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      },
    ]);
    const route = routes[k];
    if (route === undefined) throw new Error(`unrouted call: ${k}`);
    if (route.fail === true) throw new TypeError('network down');
    return {
      status: route.status ?? 200,
      json: async () => {
        if (route.text !== undefined) throw new SyntaxError('not json');
        return route.body;
      },
    } as Response;
  }) as typeof fetch;
  return { calls, count: (k) => calls.get(k)?.length ?? 0 };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const RATES: Route = {
  body: { ok: true, base: 'USD', rates: { USD: 1, RUB: 90.5, UAH: 41.2, KZT: 480 }, updated_at: '2026-10-03T09:00:00Z' },
};
const CAN_REFILL: Route = { body: { ok: true, can_refill: true } };
const CREATED: Route = { status: 201, body: { ok: true, order: { id: 'ord-42', status: 'processing' } } };

function provider(): FazerCardsSteamSupplierProvider {
  return new FazerCardsSteamSupplierProvider({ apiKey: 'test-key', clock: () => NOW });
}

const request = (overrides: Partial<Parameters<FazerCardsSteamSupplierProvider['purchase']>[0]> = {}) => ({
  providerSku: 'steam:usd:10',
  quantity: 1,
  idempotencyKey: 'topup:ord_1',
  accountFields: { steam_login: 'gabe_newell' },
  ...overrides,
});

describe('Steam provider SKU', () => {
  it('round-trips whole and cent amounts', () => {
    expect(parseFazerCardsSteamProviderSku('steam:usd:10')).toEqual({ currency: 'USD', cents: 1000n });
    expect(parseFazerCardsSteamProviderSku('steam:usd:0.15').cents).toBe(15n);
    expect(parseFazerCardsSteamProviderSku('steam:usd:1000').cents).toBe(100_000n);
    expect(formatFazerCardsSteamProviderSku('25')).toBe('steam:usd:25');
  });

  it.each(['steam:usd:0', 'steam:usd:1000.01', 'steam:usd:5.999', 'steam:rub:5', 'telegram:stars:50', 'steam:usd:', 'steam:usd:-5'])(
    'refuses %s',
    (sku) => {
      expect(() => parseFazerCardsSteamProviderSku(sku)).toThrow(FazerCardsSteamSupplierError);
    },
  );

  it('refuses the template SKU: it is not a purchasable amount', () => {
    expect(() => parseFazerCardsSteamProviderSku(STEAM_CUSTOM_AMOUNT_SKU)).toThrow(FazerCardsSteamSupplierError);
  });
});

describe('construction', () => {
  it('requires a key and a sane timeout', () => {
    expect(() => new FazerCardsSteamSupplierProvider({ apiKey: '  ' })).toThrow(RangeError);
    expect(() => new FazerCardsSteamSupplierProvider({ apiKey: 'k', timeoutMs: 0 })).toThrow(RangeError);
  });
});

describe('catalogue, price and availability', () => {
  it('lists one custom-amount template that needs a Steam login', async () => {
    stubFetch({ 'GET /steam-topup/rates': RATES });
    const catalog = await provider().getCatalog();
    expect(catalog.map((item) => item.providerSku)).toEqual(['steam:usd:custom']);
    expect(catalog[0]).toMatchObject({
      assetType: 'DIRECT_TOPUP',
      requiredAccountFields: ['steam_login'],
    });
  });

  it('prices at the USD face value as a decimal string', async () => {
    stubFetch({ 'GET /steam-topup/rates': RATES });
    const price = await provider().getPrice('steam:usd:12.5');
    expect(price.cost).toEqual({ amount: '12.5000', currency: 'USD' });
    expect(price.observedAt).toEqual(NOW);
  });

  it('fails closed when the rates payload is unusable', async () => {
    stubFetch({ 'GET /steam-topup/rates': { body: { ok: true, base: 'EUR', rates: { USD: 1 } } } });
    await expect(provider().getPrice('steam:usd:10')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(provider().getCatalog()).rejects.toBeInstanceOf(FazerCardsSteamSupplierError);
  });

  it('reports availability from the rates check', async () => {
    stubFetch({ 'GET /steam-topup/rates': RATES });
    expect((await provider().checkAvailability('steam:usd:10')).availability).toBe('AVAILABLE');
    expect((await provider().checkAvailability('steam:usd:5.999')).availability).toBe('UNAVAILABLE');
    stubFetch({ 'GET /steam-topup/rates': { status: 503, body: { ok: false, error: 'x' } } });
    expect((await provider().checkAvailability('steam:usd:10')).availability).toBe('UNKNOWN');
  });

  it('reads the balance', async () => {
    stubFetch({ 'GET /balance': { body: { ok: true, balance: '12.5', currency: 'USD' } } });
    expect(await provider().getBalance()).toEqual({ amount: '12.5000', currency: 'USD', observedAt: NOW });
  });
});

describe('purchase', () => {
  it('checks the login, then orders with the idempotency header and USD cents', async () => {
    const stub = stubFetch({
      'POST /steam-topup/check-login': CAN_REFILL,
      'POST /steam-topup/order': CREATED,
    });
    const result = await provider().purchase(request({ providerSku: 'steam:usd:10.5' }));

    expect(result).toEqual({ status: 'PENDING', providerReference: 'ord-42' });
    const order = stub.calls.get('POST /steam-topup/order')?.[0];
    expect(order?.body).toEqual({ steamLogin: 'gabe_newell', currency: 'USD', amount: '10.5' });
    expect(order?.headers['idempotency-key']).toBe('topup:ord_1');
    expect(order?.headers['x-api-key']).toBe('test-key');
    expect(stub.calls.get('POST /steam-topup/check-login')?.[0]?.body).toEqual({ steamLogin: 'gabe_newell' });
  });

  it('succeeds only on an explicit completed status', async () => {
    stubFetch({
      'POST /steam-topup/check-login': CAN_REFILL,
      'POST /steam-topup/order': { status: 201, body: { ok: true, order: { id: 'ord-7', status: 'completed' } } },
    });
    expect(await provider().purchase(request())).toEqual({
      status: 'SUCCEEDED',
      providerReference: 'ord-7',
      asset: { assetType: 'DIRECT_TOPUP', accountReference: 'gabe_newell' },
    });
  });

  it('treats a 201 with no status as pending, and with no reference as unknown', async () => {
    stubFetch({ 'POST /steam-topup/check-login': CAN_REFILL, 'POST /steam-topup/order': { status: 201, body: { ok: true, order: { id: 'ord-9' } } } });
    expect((await provider().purchase(request())).status).toBe('PENDING');
    stubFetch({ 'POST /steam-topup/check-login': CAN_REFILL, 'POST /steam-topup/order': { status: 201, body: { ok: true, order: {} } } });
    expect(await provider().purchase(request())).toMatchObject({ status: 'UNKNOWN', failureCode: 'ORDER_STATUS_UNKNOWN' });
  });

  it('refuses a login that cannot be refilled before charging anything', async () => {
    const stub = stubFetch({
      'POST /steam-topup/check-login': { body: { ok: true, can_refill: false } },
      'POST /steam-topup/order': CREATED,
    });
    expect(await provider().purchase(request())).toEqual({ status: 'FAILED', failureCode: 'STEAM_LOGIN_CANNOT_REFILL' });
    expect(stub.count('POST /steam-topup/order')).toBe(0);
  });

  it('proceeds when the venue could not verify the login', async () => {
    const stub = stubFetch({
      'POST /steam-topup/check-login': { body: { ok: true, can_refill: true, unverified: true } },
      'POST /steam-topup/order': CREATED,
    });
    expect((await provider().purchase(request())).status).toBe('PENDING');
    expect(stub.count('POST /steam-topup/order')).toBe(1);
  });

  it('fails cleanly, without ordering, when the login check is unreachable', async () => {
    const stub = stubFetch({ 'POST /steam-topup/check-login': { fail: true }, 'POST /steam-topup/order': CREATED });
    expect(await provider().purchase(request())).toEqual({ status: 'FAILED', failureCode: 'LOGIN_CHECK_UNAVAILABLE' });
    expect(stub.count('POST /steam-topup/order')).toBe(0);
  });

  it('maps a stated 4xx to FAILED and never to UNKNOWN', async () => {
    stubFetch({
      'POST /steam-topup/check-login': CAN_REFILL,
      'POST /steam-topup/order': { status: 400, body: { ok: false, error: 'Insufficient balance', code: 'insufficient-funds' } },
    });
    expect(await provider().purchase(request())).toEqual({ status: 'FAILED', failureCode: 'PROVIDER_INSUFFICIENT_FUNDS' });
  });

  it('maps rate limiting to FAILED', async () => {
    stubFetch({ 'POST /steam-topup/check-login': CAN_REFILL, 'POST /steam-topup/order': { status: 429, body: { ok: false, error: 'x' } } });
    expect(await provider().purchase(request())).toEqual({ status: 'FAILED', failureCode: 'RATE_LIMITED' });
  });

  it.each([
    ['a network failure', { fail: true }],
    ['a 5xx', { status: 503, body: { ok: false, error: 'x' } }],
    ['an unreadable body', { status: 201, text: '<html>' }],
    ['a 201 without an order', { status: 201, body: { ok: true } }],
  ] as const)('is UNKNOWN after the charge may have happened: %s', async (_name, route) => {
    stubFetch({ 'POST /steam-topup/check-login': CAN_REFILL, 'POST /steam-topup/order': route });
    expect((await provider().purchase(request())).status).toBe('UNKNOWN');
  });

  it.each([
    ['quantity above one', request({ quantity: 2 }), 'QUANTITY_NOT_SUPPORTED'],
    ['a blank idempotency key', request({ idempotencyKey: '  ' }), 'IDEMPOTENCY_KEY_UNUSABLE'],
    ['an over-long idempotency key', request({ idempotencyKey: 'k'.repeat(256) }), 'IDEMPOTENCY_KEY_UNUSABLE'],
    ['a missing login', request({ accountFields: {} }), 'ACCOUNT_FIELDS_MISSING'],
    ['a login with whitespace inside', request({ accountFields: { steam_login: 'a b' } }), 'ACCOUNT_FIELDS_INVALID'],
    ['an over-long login', request({ accountFields: { steam_login: 'a'.repeat(65) } }), 'ACCOUNT_FIELDS_INVALID'],
    ['a foreign SKU', request({ providerSku: 'telegram:stars:50' }), 'INVALID_PROVIDER_SKU'],
  ])('refuses %s without calling the venue', async (_name, input, code) => {
    const stub = stubFetch({});
    expect(await provider().purchase(input)).toEqual({ status: 'FAILED', failureCode: code });
    expect(stub.calls.size).toBe(0);
  });

  it('never leaks the key or the venue prose into a failure code', async () => {
    stubFetch({
      'POST /steam-topup/check-login': CAN_REFILL,
      'POST /steam-topup/order': { status: 400, body: { ok: false, error: 'secret test-key text', code: 'bad code!!' } },
    });
    const result = await provider().purchase(request());
    expect(JSON.stringify(result)).not.toContain('test-key');
    expect(result.failureCode).toBe('PROVIDER_BAD_CODE__');
  });
});

describe('getPurchaseStatus', () => {
  it('maps the venue statuses', async () => {
    stubFetch({ 'GET /orders/ord-5': { body: { ok: true, order: { status: 'completed', steamLogin: 'gabe_newell' } } } });
    expect(await provider().getPurchaseStatus('ord-5')).toEqual({
      status: 'SUCCEEDED',
      providerReference: 'ord-5',
      asset: { assetType: 'DIRECT_TOPUP', accountReference: 'gabe_newell' },
    });
    stubFetch({ 'GET /orders/ord-5': { body: { ok: true, order: { status: 'processing' } } } });
    expect((await provider().getPurchaseStatus('ord-5')).status).toBe('PENDING');
    stubFetch({ 'GET /orders/ord-5': { body: { ok: true, order: { status: 'cancelled' } } } });
    expect((await provider().getPurchaseStatus('ord-5')).status).toBe('FAILED');
    stubFetch({ 'GET /orders/ord-5': { body: { ok: true, order: { status: 'weird' } } } });
    expect((await provider().getPurchaseStatus('ord-5')).status).toBe('UNKNOWN');
  });

  it('does not call a completed order credited without knowing the account', async () => {
    stubFetch({ 'GET /orders/ord-5': { body: { ok: true, order: { status: 'completed' } } } });
    expect(await provider().getPurchaseStatus('ord-5')).toMatchObject({ status: 'UNKNOWN', failureCode: 'ACCOUNT_REFERENCE_MISSING' });
  });

  it('refuses a reference that is not an order id, and tolerates 404 and transport errors', async () => {
    const stub = stubFetch({});
    expect((await provider().getPurchaseStatus('../balance')).failureCode).toBe('INVALID_PROVIDER_REFERENCE');
    expect(stub.calls.size).toBe(0);
    stubFetch({ 'GET /orders/ord-1': { status: 404, body: { ok: false, error: 'x' } } });
    expect((await provider().getPurchaseStatus('ord-1')).failureCode).toBe('ORDER_NOT_FOUND');
    stubFetch({ 'GET /orders/ord-1': { fail: true } });
    expect((await provider().getPurchaseStatus('ord-1')).failureCode).toBe('NETWORK_ERROR');
  });
});
