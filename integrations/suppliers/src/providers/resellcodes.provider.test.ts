import { afterEach, describe, expect, it } from 'vitest';

import {
  ResellCodesGiftCardSupplierProvider,
  ResellCodesTopUpSupplierProvider,
  ResellCodesSupplierError,
  parseResellCodesProviderSku,
} from './resellcodes.provider';

const ORIGINAL_FETCH = globalThis.fetch;
const KEY = 'rsc_live_testkey000000000000000000000000000000000000';

interface Route {
  readonly status?: number;
  readonly body?: unknown;
  readonly text?: string;
  readonly headers?: Record<string, string>;
  /** Make the call itself reject, as a dropped connection or timeout does. */
  readonly throws?: Error;
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Routes by "METHOD path" (query dropped); an array serves successive calls in order. */
function stubFetch(routes: Record<string, Route | readonly Route[]>): { calls: Call[]; count: (key: string) => number } {
  const calls: Call[] = [];
  const counters = new Map<string, number>();

  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    calls.push({
      method,
      path: url.pathname,
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    const route = routes[key];
    if (route === undefined) {
      throw new Error(`unrouted call: ${key}`);
    }
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const chosen = Array.isArray(route) ? (route[Math.min(index, route.length - 1)] as Route) : (route as Route);
    if (chosen.throws !== undefined) {
      throw chosen.throws;
    }

    return {
      status: chosen.status ?? 200,
      headers: new Headers(chosen.headers ?? {}),
      json: async () => {
        if (chosen.text !== undefined) {
          throw new SyntaxError('not json');
        }
        return chosen.body;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return { calls, count: (key) => counters.get(key) ?? 0 };
}

const noSleep = async (): Promise<void> => undefined;

function giftCards(options: Record<string, unknown> = {}): ResellCodesGiftCardSupplierProvider {
  return new ResellCodesGiftCardSupplierProvider({ apiKey: KEY, sleep: noSleep, ...options });
}

function topUps(options: Record<string, unknown> = {}): ResellCodesTopUpSupplierProvider {
  return new ResellCodesTopUpSupplierProvider({ apiKey: KEY, sleep: noSleep, ...options });
}

const CARD_OFFERS: Route = {
  body: {
    object: 'gift_card_offers',
    category_id: '12',
    name: 'Steam',
    offers: [
      { card_id: '99', name: 'Steam $10', price_usd: '9.7500', stock: 5, min_quantity: 1, max_quantity: 10 },
      { card_id: '100', name: 'Steam $20', price_usd: '19.5000', stock: 0, min_quantity: 1, max_quantity: 10 },
    ],
  },
};

const TOPUP_OFFERS: Route = {
  body: {
    fields: [{ key: 'player_id', label: 'Player ID', type: 'text' }],
    offers: [{ offer_id: '60uc', name: '60 UC', price_usd: '0.9900' }],
  },
};

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('provider SKU', () => {
  it('splits category and item, and refuses anything else', () => {
    expect(parseResellCodesProviderSku('12:99')).toEqual({ categoryId: '12', itemId: '99' });
    for (const bad of ['', '12', '12:', ':99', '1:2:3']) {
      expect(() => parseResellCodesProviderSku(bad)).toThrow(ResellCodesSupplierError);
    }
  });
});

describe('construction', () => {
  it('needs a key and a sane timeout', () => {
    expect(() => new ResellCodesGiftCardSupplierProvider({ apiKey: '  ' })).toThrow(RangeError);
    expect(() => new ResellCodesTopUpSupplierProvider({ apiKey: KEY, timeoutMs: 0 })).toThrow(RangeError);
    expect(() => new ResellCodesTopUpSupplierProvider({ apiKey: KEY, timeoutMs: 60_001 })).toThrow(RangeError);
  });

  it('is keyed per product and never claims venue-side idempotency', () => {
    expect(giftCards().key).toBe('resellcodes');
    expect(topUps().key).toBe('resellcodes-topup');
    expect((giftCards() as { idempotentPurchases?: boolean }).idempotentPurchases).toBeUndefined();
    expect((topUps() as { idempotentPurchases?: boolean }).idempotentPurchases).toBeUndefined();
  });
});

describe('getBalance', () => {
  it('reads balance_usd as a decimal string', async () => {
    const stub = stubFetch({ 'GET /api/v1/me': { body: { balance_usd: '150.5000' } } });

    const balance = await giftCards({ clock: () => new Date('2026-10-27T00:00:00Z') }).getBalance();

    expect(balance).toEqual({ amount: '150.5000', currency: 'USD', observedAt: new Date('2026-10-27T00:00:00Z') });
    expect(stub.calls[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('fails loudly on an unusable amount rather than inventing zero', async () => {
    stubFetch({ 'GET /api/v1/me': { body: { balance_usd: 'lots' } } });
    await expect(topUps().getBalance()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('normalises an auth failure to a token, never the venue message', async () => {
    stubFetch({
      'GET /api/v1/me': { status: 401, body: { error: { type: 'unauthorized', message: 'key rsc_live_x is bad' } } },
    });
    const error = await giftCards().getBalance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResellCodesSupplierError);
    expect((error as ResellCodesSupplierError).code).toBe('PROVIDER_UNAUTHORIZED');
    expect((error as Error).message).not.toContain('rsc_live');
  });
});

describe('gift card catalogue', () => {
  it('walks categories and reads price_usd as exact money', async () => {
    stubFetch({
      'GET /api/v1/gift-cards/categories': { body: { total: 1, data: [{ category_id: '12', name: 'Steam' }] } },
      'GET /api/v1/gift-cards/categories/12/cards': CARD_OFFERS,
    });

    const catalog = await giftCards().getCatalog();

    expect(catalog).toEqual([
      expect.objectContaining({ providerSku: '12:99', faceValue: { amount: '9.7500', currency: 'USD' }, assetType: 'CODE', brand: 'Steam' }),
      expect.objectContaining({ providerSku: '12:100', faceValue: { amount: '19.5000', currency: 'USD' } }),
    ]);
  });

  it('leaves out an item whose price cannot be read', async () => {
    stubFetch({
      'GET /api/v1/gift-cards/categories': { body: { data: [{ category_id: '12', name: 'Steam' }] } },
      'GET /api/v1/gift-cards/categories/12/cards': {
        body: { offers: [{ card_id: '1', name: 'x', price_usd: null }, { card_id: '2', name: 'y', price_usd: '1.0000' }] },
      },
    });
    expect((await giftCards().getCatalog()).map((item) => item.providerSku)).toEqual(['12:2']);
  });

  it('waits out a 429 for the stated Retry-After, then succeeds', async () => {
    const waits: number[] = [];
    stubFetch({
      'GET /api/v1/gift-cards/categories': [
        { status: 429, headers: { 'retry-after': '7' }, body: { error: { type: 'rate_limited' } } },
        { body: { data: [] } },
      ],
    });

    await giftCards({ sleep: async (ms: number) => void waits.push(ms) }).getCatalog();

    expect(waits).toEqual([7000]);
  });

  it('gives up after repeated throttling instead of looping forever', async () => {
    const stub = stubFetch({
      'GET /api/v1/gift-cards/categories': { status: 429, body: { error: { type: 'rate_limited' } } },
    });
    await expect(giftCards().getCatalog()).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    expect(stub.count('GET /api/v1/gift-cards/categories')).toBe(4);
  });

  it('treats a body that is not a list as broken, not as an empty catalogue', async () => {
    stubFetch({ 'GET /api/v1/gift-cards/categories': { body: { nope: true } } });
    await expect(giftCards().getCatalog()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('gift card price and availability', () => {
  it('reads the live price from the category listing', async () => {
    stubFetch({ 'GET /api/v1/gift-cards/categories/12/cards': CARD_OFFERS });
    const price = await giftCards().getPrice('12:99');
    expect(price.cost).toEqual({ amount: '9.7500', currency: 'USD' });
  });

  it('is AVAILABLE with stock, UNAVAILABLE at zero stock or when delisted', async () => {
    stubFetch({ 'GET /api/v1/gift-cards/categories/12/cards': CARD_OFFERS });
    expect((await giftCards().checkAvailability('12:99')).availability).toBe('AVAILABLE');
    expect((await giftCards().checkAvailability('12:100')).availability).toBe('UNAVAILABLE');
    expect((await giftCards().checkAvailability('12:404')).availability).toBe('UNAVAILABLE');
    expect((await giftCards().checkAvailability('garbage')).availability).toBe('UNAVAILABLE');
  });

  it('reports an unreachable venue as UNKNOWN, never as sold out', async () => {
    stubFetch({
      'GET /api/v1/gift-cards/categories/12/cards': { throws: new TypeError('fetch failed') },
    });
    expect((await giftCards().checkAvailability('12:99')).availability).toBe('UNKNOWN');
  });
});

describe('gift card purchase', () => {
  const request = { providerSku: '12:99', quantity: 1, idempotencyKey: 'order-1:attempt-1' } as const;

  it('buys one card and hands the code over as an asset', async () => {
    const stub = stubFetch({
      'POST /api/v1/gift-cards/order': {
        status: 201,
        body: { object: 'order', number: 4711, status: 'completed', charged_usd: '9.7500', codes: ['ABCD-1234'] },
      },
    });

    const result = await giftCards().purchase(request);

    expect(result).toEqual({
      status: 'SUCCEEDED',
      providerReference: '4711',
      cost: { amount: '9.7500', currency: 'USD' },
      asset: { assetType: 'CODE', code: 'ABCD-1234' },
    });
    expect(stub.calls[0]?.body).toEqual({ category_id: '12', card_id: '99', quantity: 1 });
  });

  it('reads a code with a PIN and serial when the venue sends an object', async () => {
    stubFetch({
      'POST /api/v1/gift-cards/order': {
        body: { number: 'A1', status: 'completed', codes: [{ code: 'C', pin: 'P', serial: 'S' }] },
      },
    });
    expect((await giftCards().purchase(request)).asset).toEqual({
      assetType: 'CODE_PIN',
      code: 'C',
      pin: 'P',
      serialNumber: 'S',
    });
  });

  it('accepts the order wrapped in `order`', async () => {
    stubFetch({
      'POST /api/v1/gift-cards/order': { body: { order: { number: 5, status: 'processing' } } },
    });
    expect(await giftCards().purchase(request)).toMatchObject({ status: 'PENDING', providerReference: '5' });
  });

  it('never puts the code in the provider reference, and says UNKNOWN when a completed order has none', async () => {
    stubFetch({ 'POST /api/v1/gift-cards/order': { body: { number: 9, status: 'completed', codes: [] } } });
    expect(await giftCards().purchase(request)).toEqual({
      status: 'UNKNOWN',
      providerReference: '9',
      failureCode: 'DELIVERY_MISSING',
    });
  });

  it('refuses more than one unit and an unusable key before any call', async () => {
    const stub = stubFetch({});
    expect(await giftCards().purchase({ ...request, quantity: 2 })).toEqual({
      status: 'FAILED',
      failureCode: 'QUANTITY_NOT_SUPPORTED',
    });
    expect(await giftCards().purchase({ ...request, idempotencyKey: '  ' })).toEqual({
      status: 'FAILED',
      failureCode: 'IDEMPOTENCY_KEY_UNUSABLE',
    });
    expect(await giftCards().purchase({ ...request, providerSku: 'bad' })).toEqual({
      status: 'FAILED',
      failureCode: 'INVALID_PROVIDER_SKU',
    });
    expect(stub.calls).toHaveLength(0);
  });

  it.each([
    ['out_of_stock', 'RESELL_OUT_OF_STOCK'],
    ['price_changed', 'RESELL_PRICE_CHANGED'],
    ['declined', 'RESELL_DECLINED'],
    ['something_new', 'PROVIDER_DECLINED'],
  ])('maps fail_code %s to %s on a failed order', async (failCode, expected) => {
    stubFetch({
      'POST /api/v1/gift-cards/order': { body: { number: 1, status: 'failed', fail_code: failCode, status_reason: 'free text' } },
    });
    expect(await giftCards().purchase(request)).toMatchObject({ status: 'FAILED', failureCode: expected });
  });

  it('treats a refunded order as a settled failure', async () => {
    stubFetch({
      'POST /api/v1/gift-cards/order': { body: { number: 1, status: 'refund', fail_code: 'timed_out' } },
    });
    expect(await giftCards().purchase(request)).toMatchObject({ status: 'FAILED', failureCode: 'RESELL_TIMED_OUT' });
  });

  it('is UNKNOWN on an unrecognised status, never SUCCEEDED', async () => {
    stubFetch({ 'POST /api/v1/gift-cards/order': { body: { number: 1, status: 'archived' } } });
    expect((await giftCards().purchase(request)).status).toBe('UNKNOWN');
  });

  it('answers a stated 4xx as FAILED (nothing charged) and a 429 as retryable RATE_LIMITED', async () => {
    stubFetch({
      'POST /api/v1/gift-cards/order': [
        { status: 400, body: { error: { type: 'invalid_request', message: 'x' } } },
        { status: 429, body: { error: { type: 'rate_limited' } } },
      ],
    });
    expect(await giftCards().purchase({ ...request, idempotencyKey: 'k-400' })).toEqual({
      status: 'FAILED',
      failureCode: 'PROVIDER_INVALID_REQUEST',
    });
    expect(await giftCards().purchase({ ...request, idempotencyKey: 'k-429' })).toEqual({
      status: 'FAILED',
      failureCode: 'RATE_LIMITED',
    });
  });

  it('is UNKNOWN on a 5xx, an unreadable body, or a dropped connection — the order may exist', async () => {
    for (const route of [
      { status: 502, body: undefined },
      { status: 500, text: '<html>' },
      { throws: new TypeError('fetch failed') },
    ] satisfies Route[]) {
      stubFetch({ 'POST /api/v1/gift-cards/order': route });
      expect((await giftCards().purchase({ ...request, idempotencyKey: `k-${String(Math.random())}` })).status).toBe(
        'UNKNOWN',
      );
    }
  });

  it('never retries a purchase itself', async () => {
    const stub = stubFetch({ 'POST /api/v1/gift-cards/order': { status: 503, body: {} } });
    await giftCards().purchase(request);
    expect(stub.count('POST /api/v1/gift-cards/order')).toBe(1);
  });

  it('does not place a second order when the same key is replayed after an UNKNOWN answer', async () => {
    const stub = stubFetch({ 'POST /api/v1/gift-cards/order': { throws: new TypeError('fetch failed') } });
    const adapter = giftCards();

    const first = await adapter.purchase(request);
    const second = await adapter.purchase(request);

    expect(first.status).toBe('UNKNOWN');
    expect(second).toEqual(first);
    expect(stub.count('POST /api/v1/gift-cards/order')).toBe(1);
  });

  it('collapses concurrent calls on one key into a single order', async () => {
    const stub = stubFetch({
      'POST /api/v1/gift-cards/order': { body: { number: 1, status: 'completed', codes: ['X'] } },
    });
    const adapter = giftCards();

    const [a, b] = await Promise.all([adapter.purchase(request), adapter.purchase(request)]);

    expect(a).toEqual(b);
    expect(stub.count('POST /api/v1/gift-cards/order')).toBe(1);
  });

  it('allows a retry after a throttled call, because nothing was charged', async () => {
    const stub = stubFetch({
      'POST /api/v1/gift-cards/order': [
        { status: 429, body: {} },
        { body: { number: 2, status: 'completed', codes: ['X'] } },
      ],
    });
    const adapter = giftCards();

    expect((await adapter.purchase(request)).failureCode).toBe('RATE_LIMITED');
    expect((await adapter.purchase(request)).status).toBe('SUCCEEDED');
    expect(stub.count('POST /api/v1/gift-cards/order')).toBe(2);
  });

  it('keeps different keys independent', async () => {
    const stub = stubFetch({ 'POST /api/v1/gift-cards/order': { body: { number: 1, status: 'processing' } } });
    const adapter = giftCards();
    await adapter.purchase({ ...request, idempotencyKey: 'a' });
    await adapter.purchase({ ...request, idempotencyKey: 'b' });
    expect(stub.count('POST /api/v1/gift-cards/order')).toBe(2);
  });

  it('does not leak the code or the key through any thrown or returned value', async () => {
    stubFetch({
      'POST /api/v1/gift-cards/order': { body: { number: 3, status: 'completed', codes: ['SECRET-CODE-1'] } },
    });
    const result = await giftCards().purchase(request);
    const { asset, ...rest } = result;
    expect(JSON.stringify(rest)).not.toContain('SECRET-CODE-1');
    expect(JSON.stringify(rest)).not.toContain(KEY);
    expect(asset).toBeDefined();
  });
});

describe('purchase status polling', () => {
  it('maps the lifecycle: created/processing pending, completed succeeded, failed failed', async () => {
    stubFetch({
      'GET /api/v1/orders/7': [
        { body: { number: 7, status: 'created' } },
        { body: { number: 7, status: 'processing' } },
        { body: { number: 7, status: 'completed', codes: ['K'] } },
        { body: { number: 7, status: 'failed', fail_code: 'stock_short' } },
      ],
    });
    const adapter = giftCards();
    expect((await adapter.getPurchaseStatus('7')).status).toBe('PENDING');
    expect((await adapter.getPurchaseStatus('7')).status).toBe('PENDING');
    expect(await adapter.getPurchaseStatus('7')).toMatchObject({ status: 'SUCCEEDED', asset: { code: 'K' } });
    expect(await adapter.getPurchaseStatus('7')).toMatchObject({ status: 'FAILED', failureCode: 'RESELL_STOCK_SHORT' });
  });

  it('is UNKNOWN for a missing order, a bad reference, or an unreadable answer', async () => {
    stubFetch({
      'GET /api/v1/orders/8': { status: 404, body: { error: { type: 'not_found' } } },
      'GET /api/v1/orders/9': { status: 500, body: {} },
    });
    const adapter = giftCards();
    expect(await adapter.getPurchaseStatus('8')).toMatchObject({ status: 'UNKNOWN', failureCode: 'ORDER_NOT_FOUND' });
    expect((await adapter.getPurchaseStatus('9')).status).toBe('UNKNOWN');
    expect(await adapter.getPurchaseStatus('../me')).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'INVALID_PROVIDER_REFERENCE',
    });
  });
});

describe('top-up catalogue', () => {
  const routes = {
    'GET /api/v1/top-ups/categories': { body: { data: [{ category_id: 'pubg', name: 'PUBG Mobile', image: 'https://img/p.png' }] } },
    'GET /api/v1/top-ups/brands': {
      body: { data: [{ brand: 'PUBG', subcategories: [{ category_id: 'pubg', name: 'PUBG', region: 'GLOBAL', variant: 'x' }] }] },
    },
    'GET /api/v1/top-ups/categories/pubg/offers': TOPUP_OFFERS,
  };

  it('returns games with their account fields, region and priced offers', async () => {
    stubFetch(routes);

    const [game] = await topUps().getTopUpCatalog();

    expect(game).toMatchObject({
      categoryId: 'pubg',
      name: 'PUBG Mobile',
      region: 'GLOBAL',
      imageUrl: 'https://img/p.png',
      requiresCredentials: false,
      fields: [{ key: 'player_id', label: 'Player ID', type: 'TEXT', required: true, credential: false }],
      offers: [{ offerId: '60uc', name: '60 UC', cost: { amount: '0.9900', currency: 'USD' } }],
    });
  });

  it('flags a game that asks for a password so it is never sold', async () => {
    stubFetch({
      ...routes,
      'GET /api/v1/top-ups/categories/pubg/offers': {
        body: {
          fields: [
            { key: 'login', label: 'Login', type: 'text' },
            { key: 'pw', label: 'Account password', type: 'password' },
          ],
          offers: [{ offer_id: '1', name: 'x', price_usd: '1.0000' }],
        },
      },
    });
    const [game] = await topUps().getTopUpCatalog();
    expect(game?.requiresCredentials).toBe(true);
  });

  it('refuses a non-https image and still imports the game', async () => {
    stubFetch({
      ...routes,
      'GET /api/v1/top-ups/categories': { body: { data: [{ category_id: 'pubg', name: 'P', image: 'javascript:alert(1)' }] } },
    });
    const [game] = await topUps().getTopUpCatalog();
    expect(game?.imageUrl).toBeNull();
  });

  it('keeps going without regions when the brands call fails', async () => {
    stubFetch({ ...routes, 'GET /api/v1/top-ups/brands': { status: 500, body: {} } });
    const [game] = await topUps().getTopUpCatalog();
    expect(game?.region).toBe('GLOBAL');
  });

  it('skips a category the venue 404s, but fails the whole read on any other error', async () => {
    stubFetch({ ...routes, 'GET /api/v1/top-ups/categories/pubg/offers': { status: 404, body: {} } });
    expect(await topUps().getTopUpCatalog()).toEqual([]);

    stubFetch({ ...routes, 'GET /api/v1/top-ups/categories/pubg/offers': { status: 500, body: {} } });
    await expect(topUps({ sleep: noSleep }).getTopUpCatalog()).rejects.toBeInstanceOf(ResellCodesSupplierError);
  });

  it('reports an unreadable game in the tolerant read instead of failing every other game', async () => {
    stubFetch({
      ...routes,
      'GET /api/v1/top-ups/categories': {
        body: { data: [{ category_id: 'pubg', name: 'PUBG' }, { category_id: 'bad', name: 'Bad' }] },
      },
      'GET /api/v1/top-ups/categories/bad/offers': { status: 500, body: {} },
    });

    const read = await topUps().readTopUpCatalog();

    expect(read.games.map((game) => game.categoryId)).toEqual(['pubg']);
    expect(read.unreadable).toEqual([{ categoryId: 'bad', name: 'Bad', failureCode: 'CATALOG_UNAVAILABLE' }]);
  });

  it('flattens into purchasable catalogue items', async () => {
    stubFetch(routes);
    expect(await topUps().getCatalog()).toEqual([
      expect.objectContaining({
        providerSku: 'pubg:60uc',
        assetType: 'DIRECT_TOPUP',
        groupLabel: 'PUBG Mobile',
        requiredAccountFields: ['player_id'],
      }),
    ]);
  });
});

describe('top-up purchase', () => {
  const request = {
    providerSku: 'pubg:60uc',
    quantity: 1,
    idempotencyKey: 'order-2:attempt-1',
    accountFields: { player_id: '5001234567' },
  } as const;

  it('sends the venue field keys verbatim and returns a DIRECT_TOPUP asset with no secret', async () => {
    const stub = stubFetch({
      'POST /api/v1/top-ups/order': { body: { number: 12, status: 'completed', charged_usd: '0.9900' } },
    });

    const result = await topUps().purchase(request);

    expect(result).toEqual({
      status: 'SUCCEEDED',
      providerReference: '12',
      cost: { amount: '0.9900', currency: 'USD' },
      asset: { assetType: 'DIRECT_TOPUP', accountReference: 'player_id=5001234567' },
    });
    expect(stub.calls[0]?.body).toEqual({
      category_id: 'pubg',
      offer_id: '60uc',
      fields: { player_id: '5001234567' },
    });
  });

  it('refuses without account fields, with more than one unit, or with a bad SKU, before any call', async () => {
    const stub = stubFetch({});
    expect(await topUps().purchase({ ...request, accountFields: {} })).toEqual({
      status: 'FAILED',
      failureCode: 'ACCOUNT_FIELDS_MISSING',
    });
    expect(await topUps().purchase({ ...request, quantity: 2 })).toEqual({
      status: 'FAILED',
      failureCode: 'QUANTITY_NOT_SUPPORTED',
    });
    expect(await topUps().purchase({ ...request, providerSku: 'x' })).toEqual({
      status: 'FAILED',
      failureCode: 'INVALID_PROVIDER_SKU',
    });
    expect(stub.calls).toHaveLength(0);
  });

  it('maps account_problem to a settled failure', async () => {
    stubFetch({
      'POST /api/v1/top-ups/order': { body: { number: 1, status: 'failed', fail_code: 'account_problem' } },
    });
    expect(await topUps().purchase(request)).toMatchObject({ status: 'FAILED', failureCode: 'RESELL_ACCOUNT_PROBLEM' });
  });

  it('is UNKNOWN when the answer is lost, and a replay of the key does not buy again', async () => {
    const stub = stubFetch({ 'POST /api/v1/top-ups/order': { throws: new TypeError('fetch failed') } });
    const adapter = topUps();

    const first = await adapter.purchase(request);
    const second = await adapter.purchase(request);

    expect(first).toEqual({ status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' });
    expect(second).toEqual(first);
    expect(stub.count('POST /api/v1/top-ups/order')).toBe(1);
  });

  it('polls a status without inventing an account, and is not mistaken for a gift card route', async () => {
    stubFetch({ 'GET /api/v1/orders/12': { body: { number: 12, status: 'processing' } } });
    expect(await topUps().getPurchaseStatus('12')).toMatchObject({ status: 'PENDING', providerReference: '12' });
  });

  it('is AVAILABLE for a listed offer and UNAVAILABLE for a delisted one', async () => {
    stubFetch({ 'GET /api/v1/top-ups/categories/pubg/offers': TOPUP_OFFERS });
    expect((await topUps().checkAvailability('pubg:60uc')).availability).toBe('AVAILABLE');
    expect((await topUps().checkAvailability('pubg:gone')).availability).toBe('UNAVAILABLE');
  });
});
