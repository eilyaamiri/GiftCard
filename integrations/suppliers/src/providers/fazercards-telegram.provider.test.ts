import { afterEach, describe, expect, it } from 'vitest';

import {
  FazerCardsTelegramSupplierError,
  FazerCardsTelegramSupplierProvider,
  formatFazerCardsTelegramProviderSku,
  parseFazerCardsTelegramProviderSku,
  TELEGRAM_PREMIUM_MONTHS,
  TELEGRAM_STARS_QUANTITIES,
} from './fazercards-telegram.provider';

const ORIGINAL_FETCH = globalThis.fetch;

interface Route {
  readonly status?: number;
  readonly body?: unknown;
  readonly text?: string;
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Routes by "METHOD path", where `path` is what the adapter appended to its base
 * URL — `url.pathname` alone would carry the `/api/v2` prefix, so routes would
 * never match and every call would look like a transport failure.
 */
function routeKey(method: string, url: string): string {
  return `${method} ${new URL(url).pathname.replace(/^\/api\/v2/u, '')}`;
}

function stubFetch(routes: Record<string, Route | readonly Route[]>): {
  calls: Call[];
  find: (key: string) => Call | undefined;
  count: (key: string) => number;
} {
  const calls: Call[] = [];
  const counters = new Map<string, number>();

  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const key = routeKey(method, url);
    calls.push({
      url,
      method,
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    const route = routes[key];
    if (route === undefined) {
      throw new Error(`unrouted call: ${key}`);
    }
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const chosen = (Array.isArray(route) ? route[Math.min(index, route.length - 1)] : route) as Route;

    return {
      status: chosen.status ?? 200,
      json: async () => {
        if (chosen.text !== undefined) {
          throw new SyntaxError('not json');
        }
        return chosen.body;
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;

  return {
    calls,
    find: (key) => calls.find((call) => routeKey(call.method, call.url) === key),
    count: (key) => calls.filter((call) => routeKey(call.method, call.url) === key).length,
  };
}

/** Live-verified rates, 2026-09-29. */
function starsRoute(overrides: Record<string, unknown> = {}): Route {
  return {
    body: {
      ok: true,
      kind: 'telegram_stars',
      price_per_star: '0.0152625',
      min_amount: 50,
      max_amount: 10000,
      rates_updated_at: '2026-09-29T00:00:00Z',
      ...overrides,
    },
  };
}

function premiumRoute(overrides: Record<string, unknown> = {}): Route {
  return {
    body: {
      ok: true,
      kind: 'telegram_premium',
      plans: [
        { months: 3, price_usd: '12.1999' },
        { months: 6, price_usd: '16.2699' },
        { months: 12, price_usd: '29.4974' },
      ],
      rates_updated_at: '2026-09-29T00:00:00Z',
      ...overrides,
    },
  };
}

const CATALOG_ROUTES = {
  'GET /telegram/stars': starsRoute(),
  'GET /telegram/premium': premiumRoute(),
} as const;

function provider(options: { readonly clock?: () => Date; readonly timeoutMs?: number } = {}) {
  return new FazerCardsTelegramSupplierProvider({
    apiKey: 'fzr_test_key',
    ...options,
  });
}

function purchaseRequest(overrides: Record<string, unknown> = {}): never {
  return {
    providerSku: 'telegram:stars:500',
    quantity: 1,
    idempotencyKey: 'idem-1',
    accountFields: { telegram_username: '@buyer' },
    ...overrides,
  } as never;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('SKU space', () => {
  it('round-trips every Stars package', () => {
    for (const quantity of TELEGRAM_STARS_QUANTITIES) {
      const sku = formatFazerCardsTelegramProviderSku('stars', quantity);
      expect(sku).toBe(`telegram:stars:${String(quantity)}`);
      expect(parseFazerCardsTelegramProviderSku(sku)).toEqual({ kind: 'stars', quantity });
    }
  });

  it('round-trips every Premium plan', () => {
    for (const months of TELEGRAM_PREMIUM_MONTHS) {
      const sku = formatFazerCardsTelegramProviderSku('premium', months);
      expect(parseFazerCardsTelegramProviderSku(sku)).toEqual({ kind: 'premium', months });
    }
  });

  it('ships exactly the twelve documented Stars packages', () => {
    expect([...TELEGRAM_STARS_QUANTITIES]).toEqual([
      50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000,
    ]);
  });

  it.each([
    ['telegram:stars:51', 'a quantity outside the ladder'],
    ['telegram:stars:13', 'the smallest rejected quantity'],
    ['telegram:stars:0', 'zero'],
    ['telegram:stars:-50', 'a negative quantity'],
    ['telegram:stars:50.5', 'a fractional quantity'],
    ['telegram:stars:1e3', 'exponent notation'],
    ['telegram:stars:050', 'a zero-padded quantity'],
    ['telegram:premium:1', 'an unsold Premium duration'],
    ['telegram:premium:4', 'the first duration past the ladder'],
    ['telegram:premium:03', 'a zero-padded duration'],
    ['telegram:gamekeys:5', 'an unknown product family'],
    ['telegram:stars', 'a missing amount'],
    ['telegram:stars:500:extra', 'a trailing segment'],
    ['stars:500', 'a missing family prefix'],
    ['', 'an empty string'],
  ])('rejects %s (%s)', (sku) => {
    expect(() => parseFazerCardsTelegramProviderSku(sku)).toThrow(FazerCardsTelegramSupplierError);
    expect(() => parseFazerCardsTelegramProviderSku(sku)).toThrow(/INVALID_PROVIDER_SKU|Invalid/u);
  });

  it('refuses to format a quantity the venue does not sell', () => {
    expect(() => formatFazerCardsTelegramProviderSku('stars', 51)).toThrow(FazerCardsTelegramSupplierError);
    expect(() => formatFazerCardsTelegramProviderSku('premium', 1)).toThrow(FazerCardsTelegramSupplierError);
  });
});

describe('getCatalog', () => {
  it('returns 12 Stars packages and 3 Premium plans, priced from the live rate', async () => {
    stubFetch(CATALOG_ROUTES);

    const items = await provider().getCatalog();

    const stars = items.filter((item) => item.providerSku.startsWith('telegram:stars:'));
    const premium = items.filter((item) => item.providerSku.startsWith('telegram:premium:'));
    expect(stars).toHaveLength(12);
    expect(premium).toHaveLength(3);

    /*
     * Computed from the live rate, never stored — and these are the venue's own
     * published prices, which is the point: every one of the twelve matches to
     * the cent, including the six where rounding the product to four places
     * half-up would land a unit low (50 stars: 0.763125 -> 0.7632, not 0.7631).
     */
    const bySku = new Map(items.map((item) => [item.providerSku, item]));
    const published: readonly (readonly [number, string])[] = [
      [50, '0.7632'], [100, '1.5263'], [200, '3.0525'], [250, '3.8157'],
      [500, '7.6313'], [750, '11.4469'], [1000, '15.2625'], [1500, '22.8938'],
      [2000, '30.5250'], [3000, '45.7875'], [5000, '76.3125'], [10000, '152.6250'],
    ];
    for (const [quantity, amount] of published) {
      expect(bySku.get(`telegram:stars:${String(quantity)}`)?.faceValue.amount).toBe(amount);
    }
    expect(bySku.get('telegram:premium:3')?.faceValue.amount).toBe('12.1999');
    expect(bySku.get('telegram:premium:12')?.faceValue.amount).toBe('29.4974');

    for (const item of items) {
      expect(item.faceValue.currency).toBe('USD');
      expect(item.region).toBe('GLOBAL');
      expect(item.assetType).toBe('DIRECT_TOPUP');
      expect(item.requiredAccountFields).toEqual(['telegram_username']);
    }
  });

  it('scales to a changed rate rather than replaying a stored price', async () => {
    stubFetch({ ...CATALOG_ROUTES, 'GET /telegram/stars': starsRoute({ price_per_star: '0.02' }) });

    const items = await provider().getCatalog();

    expect(items.find((item) => item.providerSku === 'telegram:stars:1000')?.faceValue.amount).toBe('20.0000');
  });

  it('drops packages the venue has narrowed its own range past', async () => {
    stubFetch({ ...CATALOG_ROUTES, 'GET /telegram/stars': starsRoute({ min_amount: 500, max_amount: 2000 }) });

    const items = await provider().getCatalog();
    const stars = items.filter((item) => item.providerSku.startsWith('telegram:stars:'));

    expect(stars.map((item) => item.providerSku)).toEqual([
      'telegram:stars:500',
      'telegram:stars:750',
      'telegram:stars:1000',
      'telegram:stars:1500',
      'telegram:stars:2000',
    ]);
  });

  it('is UNKNOWN, not empty, when the venue is down', async () => {
    stubFetch({ 'GET /telegram/stars': { status: 503, body: { ok: false } } });

    await expect(provider().getCatalog()).rejects.toThrow(FazerCardsTelegramSupplierError);
  });

  it('refuses a payload that is not a Stars rate', async () => {
    stubFetch({ ...CATALOG_ROUTES, 'GET /telegram/stars': { body: { ok: true, kind: 'telegram_premium' } } });

    await expect(provider().getCatalog()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('getPrice', () => {
  it('reads the live rate every time, never a cached price', async () => {
    const calls = stubFetch({
      ...CATALOG_ROUTES,
      'GET /telegram/stars': [starsRoute(), starsRoute({ price_per_star: '0.02' })],
    });

    const first = await provider().getPrice('telegram:stars:500');
    const second = await provider().getPrice('telegram:stars:500');

    expect(first.cost.amount).toBe('7.6313');
    expect(second.cost.amount).toBe('10.0000');
    expect(calls.count('GET /telegram/stars')).toBe(2);
  });

  it('prices a Premium plan from the live plan list', async () => {
    const calls = stubFetch({ ...CATALOG_ROUTES });
    const observedAt = new Date('2026-09-29T12:00:00Z');

    const price = await provider({ clock: () => observedAt }).getPrice('telegram:premium:6');

    expect(price.providerSku).toBe('telegram:premium:6');
    expect(price.cost).toEqual({ amount: '16.2699', currency: 'USD' });
    expect(price.observedAt).toBe(observedAt);
    expect(calls.find('GET /telegram/premium')?.headers['x-api-key']).toBe('fzr_test_key');
  });

  it('refuses a SKU outside the ladder instead of pricing it', async () => {
    stubFetch(CATALOG_ROUTES);

    await expect(provider().getPrice('telegram:stars:51')).rejects.toThrow(/Invalid/u);
  });
});

describe('checkAvailability', () => {
  it.each(['telegram:stars:50', 'telegram:stars:10000', 'telegram:premium:3', 'telegram:premium:12'])(
    'reports %s as available',
    async (sku) => {
      stubFetch(CATALOG_ROUTES);

      expect((await provider().checkAvailability(sku)).availability).toBe('AVAILABLE');
    },
  );

  it('reports a malformed SKU as unavailable rather than guessing', async () => {
    stubFetch(CATALOG_ROUTES);

    expect((await provider().checkAvailability('telegram:stars:51')).availability).toBe('UNAVAILABLE');
  });

  it('reports a package outside the venue range as unavailable', async () => {
    stubFetch({ ...CATALOG_ROUTES, 'GET /telegram/stars': starsRoute({ max_amount: 200 }) });

    expect((await provider().checkAvailability('telegram:stars:500')).availability).toBe('UNAVAILABLE');
  });

  it('reports a withdrawn Premium plan as unavailable', async () => {
    stubFetch({
      ...CATALOG_ROUTES,
      'GET /telegram/premium': premiumRoute({ plans: [{ months: 3, price_usd: '12.1999' }] }),
    });

    expect((await provider().checkAvailability('telegram:premium:12')).availability).toBe('UNAVAILABLE');
  });

  it.each([
    ['a 5xx', { status: 503, body: { ok: false } }],
    ['an unreadable body', { status: 200, text: 'not json' }],
  ])('reports %s as UNKNOWN, never sold out', async (_label, route) => {
    stubFetch({ ...CATALOG_ROUTES, 'GET /telegram/stars': route as Route });

    // An unreachable venue is not a sold-out one: saying UNAVAILABLE would
    // silently divert the order to a costlier supplier.
    expect((await provider().checkAvailability('telegram:stars:500')).availability).toBe('UNKNOWN');
  });

  it('reports a network failure as UNKNOWN', async () => {
    stubFetch(CATALOG_ROUTES);
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    expect((await provider().checkAvailability('telegram:stars:500')).availability).toBe('UNKNOWN');
  });
});

describe('purchase', () => {
  const buyRoute = { status: 201, body: { ok: true, order: { id: 'ord-98765', status: 'completed' } } };

  it('buys Stars at the documented path and body', async () => {
    const calls = stubFetch({ 'POST /telegram/stars/buy': buyRoute });

    const result = await provider().purchase(purchaseRequest());

    expect(result.status).toBe('SUCCEEDED');
    expect(result.providerReference).toBe('ord-98765');
    const call = calls.find('POST /telegram/stars/buy');
    expect(call?.body).toEqual({ telegram_username: '@buyer', quantity: 500 });
    expect(call?.headers['x-api-key']).toBe('fzr_test_key');
    // Telegram is not on the venue's Idempotency-Key list; sending one would be a
    // false promise of venue-side deduplication.
    expect(call?.headers['idempotency-key']).toBeUndefined();
    expect(result.asset).toEqual({ assetType: 'DIRECT_TOPUP', accountReference: '@buyer' });
  });

  it('buys Premium at its own path with `months`, not `quantity`', async () => {
    const calls = stubFetch({ 'POST /telegram/premium/buy': buyRoute });

    const result = await provider().purchase(
      purchaseRequest({ providerSku: 'telegram:premium:12' }),
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(calls.find('POST /telegram/premium/buy')?.body).toEqual({
      telegram_username: '@buyer',
      months: 12,
    });
    expect(calls.count('POST /telegram/stars/buy')).toBe(0);
  });

  it.each([...TELEGRAM_STARS_QUANTITIES])('accepts the Stars package %i', async (quantity) => {
    stubFetch({ 'POST /telegram/stars/buy': buyRoute });

    const result = await provider().purchase(
      purchaseRequest({ providerSku: `telegram:stars:${String(quantity)}` }),
    );

    expect(result.status).toBe('SUCCEEDED');
  });

  it.each([...TELEGRAM_PREMIUM_MONTHS])('accepts the Premium plan %i', async (months) => {
    stubFetch({ 'POST /telegram/premium/buy': buyRoute });

    const result = await provider().purchase(
      purchaseRequest({ providerSku: `telegram:premium:${String(months)}` }),
    );

    expect(result.status).toBe('SUCCEEDED');
  });

  it.each([13, 51, 9999])('refuses the quantity %i without calling the venue', async (quantity) => {
    const calls = stubFetch({});

    const result = await provider().purchase(
      purchaseRequest({ providerSku: `telegram:stars:${String(quantity)}` }),
    );

    expect(result).toMatchObject({ status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' });
    expect(calls.calls).toHaveLength(0);
  });

  it.each([1, 4, 24])('refuses the Premium duration %i without calling the venue', async (months) => {
    const calls = stubFetch({});

    const result = await provider().purchase(
      purchaseRequest({ providerSku: `telegram:premium:${String(months)}` }),
    );

    expect(result).toMatchObject({ status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' });
    expect(calls.calls).toHaveLength(0);
  });

  it.each([2, 0, -1, 1.5])('refuses product quantity %s', async (quantity) => {
    const calls = stubFetch({});

    const result = await provider().purchase(purchaseRequest({ quantity }));

    expect(result).toMatchObject({ status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' });
    expect(calls.calls).toHaveLength(0);
  });

  it('refuses a blank idempotency key', async () => {
    const calls = stubFetch({});

    const result = await provider().purchase(purchaseRequest({ idempotencyKey: '   ' }));

    expect(result).toMatchObject({ status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' });
    expect(calls.calls).toHaveLength(0);
  });

  it.each([
    ['no account fields at all', {}],
    ['a blank username', { telegram_username: '  ' }],
    ['only an unrelated field', { player_id: '123' }],
    ['a username that is not a string', { telegram_username: 42 }],
  ])('refuses %s without calling the venue', async (_label, accountFields) => {
    const calls = stubFetch({});

    const result = await provider().purchase(purchaseRequest({ accountFields }));

    expect(result).toMatchObject({ status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' });
    expect(calls.calls).toHaveLength(0);
  });

  it('trims the username before sending it', async () => {
    const calls = stubFetch({ 'POST /telegram/stars/buy': buyRoute });

    await provider().purchase(purchaseRequest({ accountFields: { telegram_username: '  @buyer  ' } }));

    expect(calls.find('POST /telegram/stars/buy')?.body).toMatchObject({ telegram_username: '@buyer' });
  });

  it('maps 429 to RATE_LIMITED', async () => {
    stubFetch({ 'POST /telegram/stars/buy': { status: 429, body: { ok: false, error: 'slow down' } } });

    expect(await provider().purchase(purchaseRequest())).toMatchObject({
      status: 'FAILED',
      failureCode: 'RATE_LIMITED',
    });
  });

  it('maps a stated 4xx to a normalised provider code', async () => {
    stubFetch({
      'POST /telegram/stars/buy': { status: 400, body: { ok: false, error: 'bad username', code: 'invalid recipient' } },
    });

    const result = await provider().purchase(purchaseRequest());

    expect(result).toMatchObject({ status: 'FAILED', failureCode: 'PROVIDER_INVALID_RECIPIENT' });
  });

  it('falls back when a 4xx carries no code', async () => {
    stubFetch({ 'POST /telegram/stars/buy': { status: 403, body: { ok: false, error: 'forbidden' } } });

    expect(await provider().purchase(purchaseRequest())).toMatchObject({
      status: 'FAILED',
      failureCode: 'PROVIDER_REJECTED',
    });
  });

  it.each([
    ['a 5xx', { status: 500, body: { ok: false } }],
    ['an unreadable body', { status: 201, text: 'not json' }],
  ])('maps %s to UNKNOWN — the order may already have been placed', async (_label, route) => {
    stubFetch({ 'POST /telegram/stars/buy': route as Route });

    const result = await provider().purchase(purchaseRequest());

    expect(result).toMatchObject({ status: 'UNKNOWN' });
  });

  it('maps a network failure to UNKNOWN', async () => {
    stubFetch({});
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    expect(await provider().purchase(purchaseRequest())).toMatchObject({ status: 'UNKNOWN' });
  });

  it('polls a created order without delivery status instead of declaring success', async () => {
    stubFetch({ 'POST /telegram/stars/buy': { status: 201, body: { ok: true, order: { id: 'ord-1' } } } });

    const result = await provider().purchase(purchaseRequest());

    expect(result).toMatchObject({ status: 'PENDING', providerReference: 'ord-1' });
    expect(result.asset).toBeUndefined();
  });

  it('does not claim delivery when a created order has no pollable reference', async () => {
    stubFetch({ 'POST /telegram/stars/buy': { status: 201, body: { ok: true, order: {} } } });

    expect(await provider().purchase(purchaseRequest())).toMatchObject({
      status: 'UNKNOWN', failureCode: 'ORDER_STATUS_UNKNOWN',
    });
  });

  it('does not assume success when the order states an unfamiliar status', async () => {
    stubFetch({
      'POST /telegram/stars/buy': { status: 201, body: { ok: true, order: { id: 'ord-1', status: 'pending_review' } } },
    });

    const result = await provider().purchase(purchaseRequest());

    expect(result).toMatchObject({ status: 'UNKNOWN', failureCode: 'ORDER_STATUS_UNKNOWN' });
  });

  it('reports a failed order as FAILED with the venue reason', async () => {
    stubFetch({
      'POST /telegram/stars/buy': {
        status: 201,
        body: { ok: true, order: { id: 'ord-1', status: 'failed', code: 'recipient_not_found' } },
      },
    });

    expect(await provider().purchase(purchaseRequest())).toMatchObject({
      status: 'FAILED',
      failureCode: 'PROVIDER_RECIPIENT_NOT_FOUND',
    });
  });

  it('never leaks the API key into a thrown error', async () => {
    stubFetch({ 'GET /telegram/stars': { status: 500, body: { ok: false, error: 'boom', code: 'oops' } } });

    await expect(provider().getCatalog()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof FazerCardsTelegramSupplierError && !error.message.includes('fzr_test_key'),
    );
  });
});

describe('process-local purchase memory', () => {
  const buyRoute = { status: 201, body: { ok: true, order: { id: 'ord-98765', status: 'completed' } } };

  it('collapses concurrent calls sharing one key into a single purchase', async () => {
    const calls = stubFetch({ 'POST /telegram/stars/buy': buyRoute });
    const instance = provider();

    const results = await Promise.all([
      instance.purchase(purchaseRequest()),
      instance.purchase(purchaseRequest()),
      instance.purchase(purchaseRequest()),
    ]);

    expect(results.every((result) => result.status === 'SUCCEEDED')).toBe(true);
    expect(calls.count('POST /telegram/stars/buy')).toBe(1);
  });

  it('answers a sequential retry with the same key using zero further calls', async () => {
    const calls = stubFetch({ 'POST /telegram/stars/buy': buyRoute });
    const instance = provider();

    const first = await instance.purchase(purchaseRequest());
    const retry = await instance.purchase(purchaseRequest());

    // The whole reason this cache exists: the venue has no Idempotency-Key for
    // Telegram, so a retry after a timeout would otherwise buy the Stars twice.
    expect(calls.count('POST /telegram/stars/buy')).toBe(1);
    expect(retry).toEqual(first);
  });

  it('remembers an UNKNOWN outcome, because retrying could charge twice', async () => {
    const calls = stubFetch({
      'POST /telegram/stars/buy': [{ status: 500, body: { ok: false } }, buyRoute],
    });
    const instance = provider();

    expect(await instance.purchase(purchaseRequest())).toMatchObject({ status: 'UNKNOWN' });
    expect(await instance.purchase(purchaseRequest())).toMatchObject({ status: 'UNKNOWN' });
    expect(calls.count('POST /telegram/stars/buy')).toBe(1);
  });

  it('remembers PENDING until status polling resolves it, without buying twice', async () => {
    const calls = stubFetch({
      'POST /telegram/stars/buy': [
        { status: 201, body: { ok: true, order: { id: 'ord-555', status: 'processing' } } },
        buyRoute,
      ],
    });
    const instance = provider();

    expect(await instance.purchase(purchaseRequest())).toMatchObject({ status: 'PENDING' });
    expect(await instance.purchase(purchaseRequest())).toMatchObject({ status: 'PENDING' });
    expect(calls.count('POST /telegram/stars/buy')).toBe(1);
  });

  it('remembers a terminal FAILED so a retry does not re-attempt a refused buy', async () => {
    const calls = stubFetch({ 'POST /telegram/stars/buy': { status: 400, body: { ok: false } } });
    const instance = provider();

    await instance.purchase(purchaseRequest());
    await instance.purchase(purchaseRequest());

    expect(calls.count('POST /telegram/stars/buy')).toBe(1);
  });

  it('keeps a distinct key buying separately', async () => {
    const calls = stubFetch({ 'POST /telegram/stars/buy': buyRoute });
    const instance = provider();

    await instance.purchase(purchaseRequest());
    await instance.purchase(purchaseRequest({ idempotencyKey: 'idem-2' }));

    expect(calls.count('POST /telegram/stars/buy')).toBe(2);
  });

  it('lets a retry through once the remembered result is past its TTL', async () => {
    const calls = stubFetch({ 'POST /telegram/stars/buy': buyRoute });
    let now = new Date('2026-09-29T00:00:00Z');
    const instance = provider({ clock: () => now });

    await instance.purchase(purchaseRequest());
    now = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1);
    await instance.purchase(purchaseRequest());

    expect(calls.count('POST /telegram/stars/buy')).toBe(2);
  });
});

describe('getPurchaseStatus', () => {
  it.each([
    ['completed', 'SUCCEEDED'],
    ['created', 'PENDING'],
    ['processing', 'PENDING'],
    ['failed', 'FAILED'],
    ['refunded', 'FAILED'],
    ['COMPLETED', 'SUCCEEDED'],
  ])('maps the order status %s to %s', async (status, expected) => {
    stubFetch({
      'GET /orders/ord-555': {
        body: { ok: true, order: { id: 'ord-555', status, account_reference: 'player=@buyer' } },
      },
    });

    expect((await provider().getPurchaseStatus('ord-555')).status).toBe(expected);
  });

  it('reads back the username the order credited', async () => {
    stubFetch({
      'GET /orders/ord-555': {
        body: { ok: true, order: { id: 'ord-555', status: 'completed', account_reference: '@buyer' } },
      },
    });

    const result = await provider().getPurchaseStatus('ord-555');

    expect(result.asset).toEqual({ assetType: 'DIRECT_TOPUP', accountReference: '@buyer' });
  });

  it('reports UNKNOWN, never success, when a completed order names no account', async () => {
    stubFetch({ 'GET /orders/ord-555': { body: { ok: true, order: { id: 'ord-555', status: 'completed' } } } });

    // Unlike purchase(), there is no request here to fall back on — so an
    // unverifiable success is reported as unverified.
    expect(await provider().getPurchaseStatus('ord-555')).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'ACCOUNT_REFERENCE_MISSING',
    });
  });

  it('reports UNKNOWN for an unrecognised or missing status', async () => {
    stubFetch({ 'GET /orders/ord-555': { body: { ok: true, order: { id: 'ord-555' } } } });

    expect(await provider().getPurchaseStatus('ord-555')).toMatchObject({ status: 'UNKNOWN' });
  });

  it.each(['ord-abc', 'ord-', 'ORD-555', 'order-555', '', 'ord-555-6'])(
    'refuses the reference %s locally',
    async (reference) => {
      const calls = stubFetch({});

      expect(await provider().getPurchaseStatus(reference)).toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'INVALID_PROVIDER_REFERENCE',
      });
      expect(calls.calls).toHaveLength(0);
    },
  );

  it('reports a missing order as UNKNOWN', async () => {
    stubFetch({ 'GET /orders/ord-555': { status: 404, body: { ok: false, error: 'no such order' } } });

    expect(await provider().getPurchaseStatus('ord-555')).toMatchObject({
      status: 'UNKNOWN',
      failureCode: 'ORDER_NOT_FOUND',
    });
  });

  it('reports a 5xx as UNKNOWN', async () => {
    stubFetch({ 'GET /orders/ord-555': { status: 503, body: { ok: false } } });

    expect(await provider().getPurchaseStatus('ord-555')).toMatchObject({ status: 'UNKNOWN' });
  });
});

describe('getBalance', () => {
  it('reads the amount and the currency the venue reports', async () => {
    stubFetch({ 'GET /balance': { body: { ok: true, balance: '1.0200', currency: 'USD' } } });

    expect(await provider().getBalance()).toMatchObject({ amount: '1.0200', currency: 'USD' });
  });

  it('never hardcodes USD over the venue currency', async () => {
    stubFetch({ 'GET /balance': { body: { ok: true, balance: '10.5000', currency: 'EUR' } } });

    expect((await provider().getBalance()).currency).toBe('EUR');
  });

  it('refuses a balance payload with no currency rather than assuming one', async () => {
    stubFetch({ 'GET /balance': { body: { ok: true, balance: '1.0200' } } });

    await expect(provider().getBalance()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('construction', () => {
  it.each(['', '   '])('refuses the blank API key %s', (apiKey) => {
    expect(() => new FazerCardsTelegramSupplierProvider({ apiKey })).toThrow(RangeError);
  });

  it.each([0, -1, 60_001, 1.5])('refuses the timeout %s', (timeoutMs) => {
    expect(() => new FazerCardsTelegramSupplierProvider({ apiKey: 'k', timeoutMs })).toThrow(RangeError);
  });

  it('keeps the documented key and default base URL', async () => {
    const calls = stubFetch({ 'GET /balance': { body: { ok: true, balance: '1.0000', currency: 'USD' } } });
    const instance = provider();

    expect(instance.key).toBe('fazercards-telegram');
    await instance.getBalance();
    expect(calls.find('GET /balance')?.url).toBe('https://api.fzr.cards/api/v2/balance');
  });
});
