import { afterEach, describe, expect, it } from 'vitest';

import {
  G4a4GiftCardSupplierProvider,
  G4a4SupplierError,
  G4a4TopUpSupplierProvider,
  parseG4a4TopUpProviderSku,
} from './g4a4.provider';

const ORIGINAL_FETCH = globalThis.fetch;
const KEY = 'g4a4_testkey_000000000000000000000000';
const BASE = '/wp-json/reseller/v1';

interface Route {
  readonly status?: number;
  readonly body?: unknown;
  readonly text?: string;
  readonly headers?: Record<string, string>;
  readonly throws?: Error;
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** Routes by "METHOD path" (query kept apart); an array serves successive calls in order. */
function stubFetch(routes: Record<string, Route | readonly Route[]>): { calls: Call[]; count: (key: string) => number } {
  const calls: Call[] = [];
  const counters = new Map<string, number>();

  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname.replace(BASE, '')}`;
    calls.push({
      method,
      path: key,
      query: Object.fromEntries(url.searchParams.entries()),
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

function giftCards(options: Record<string, unknown> = {}): G4a4GiftCardSupplierProvider {
  return new G4a4GiftCardSupplierProvider({ apiKey: KEY, sleep: noSleep, ...options });
}

function topUps(options: Record<string, unknown> = {}): G4a4TopUpSupplierProvider {
  return new G4a4TopUpSupplierProvider({ apiKey: KEY, sleep: noSleep, ...options });
}

function ok(data: Record<string, unknown>): Route {
  return { body: { data: { status: 200, ...data } } };
}

function variation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 607055,
    name: 'PlayStation US $10',
    price: 1_735_270,
    currency: 'IRT',
    discount: 5,
    in_stock: true,
    delivery_type: 'code',
    attributes: [{ key: 'pa_region', name: 'Region', value: 'us', label: 'US' }],
    fields: [],
    ...overrides,
  };
}

const CODE_VARIATION = ok({ variation: variation() });

function order(status: string, extra: Record<string, unknown> = {}): Route {
  return ok({ order: { id: 310414, status, total: '1735270', currency: 'IRT', created_at: '2024-08-09 01:36:45', ...extra } });
}

const CODE_NOTE = {
  note: '<p>Your code:</p><pre class="instant-delivery" onclick="copyToClipboard(`exl-dsispM4SbCxq`)">exl-dsispM4SbCxq</pre>',
  created_at: '2024-08-09 01:40:00',
};

const NAME_FIELD = { data_name: 'player_id', type: 'text', required: true, name: 'Player ID' };

const TOPUP_VARIATION = ok({
  variation: variation({ id: 9001, name: '60 UC', delivery_type: 'topup', fields: [NAME_FIELD], attributes: [] }),
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('construction', () => {
  it('needs a key, a sane timeout and numeric category ids', () => {
    expect(() => new G4a4GiftCardSupplierProvider({ apiKey: '  ' })).toThrow(RangeError);
    expect(() => new G4a4TopUpSupplierProvider({ apiKey: KEY, timeoutMs: 0 })).toThrow(RangeError);
    expect(() => new G4a4TopUpSupplierProvider({ apiKey: KEY, categoryIds: ['5', 'x'] })).toThrow(RangeError);
  });

  it('keys the adapters the way the Supplier rows are coded', () => {
    expect(giftCards().key).toBe('g4a4');
    expect(topUps().key).toBe('g4a4-topup');
    expect(giftCards().idempotentPurchases).toBeUndefined();
    expect(topUps().idempotentPurchases).toBeUndefined();
  });
});

describe('top-up provider SKU', () => {
  it('splits product and variation, and refuses anything else', () => {
    expect(parseG4a4TopUpProviderSku('12:99')).toEqual({ productId: '12', variationId: '99' });
    for (const bad of ['', '12', '12:', ':99', '1:2:3', 'a:1']) {
      expect(() => parseG4a4TopUpProviderSku(bad)).toThrow(G4a4SupplierError);
    }
  });
});

describe('balance', () => {
  it('reads the toman balance as an exact decimal string, sending the key in `api-key`', async () => {
    const { calls } = stubFetch({ 'GET /get-balance': ok({ balance: 7_430_250, currency: 'IRT' }) });

    const balance = await giftCards().getBalance();

    expect(balance).toMatchObject({ amount: '7430250', currency: 'IRT' });
    expect(calls[0]?.headers['api-key']).toBe(KEY);
    expect(calls[0]?.headers['authorization']).toBeUndefined();
  });

  it('refuses a balance it cannot read exactly', async () => {
    stubFetch({ 'GET /get-balance': ok({ balance: -5, currency: 'IRT' }) });
    await expect(giftCards().getBalance()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    stubFetch({ 'GET /get-balance': ok({ balance: 10, currency: '' }) });
    await expect(giftCards().getBalance()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('names a bad key without echoing the venue prose', async () => {
    stubFetch({
      'GET /get-balance': { status: 403, body: { code: 403, message: 'Invalid API key', data: { status: 403 } } },
    });

    await expect(giftCards().getBalance()).rejects.toMatchObject({ code: 'INVALID_API_KEY', httpStatus: 403 });
  });
});

describe('gift-card catalogue', () => {
  it('keeps in-stock code variations, priced in toman, with the region the venue gives', async () => {
    stubFetch({
      'GET /product/get-categories': ok({ categories: [{ id: 53, name: 'Gift cards' }, { id: 6113, name: 'Accounts' }] }),
      'GET /product/get-products': ok({ products: [{ id: 5939, name: 'PlayStation' }] }),
      'GET /product/get-product': ok({
        product: {
          id: 5939,
          name: 'PlayStation',
          variations: [
            variation(),
            variation({ id: 607056, in_stock: false }),
            variation({ id: 607057, delivery_type: 'manual' }),
            variation({ id: 607058, delivery_type: 'topup' }),
            variation({ id: 607059, price: 'free' }),
          ],
        },
      }),
    });

    const items = await giftCards().getCatalog();

    expect(items).toEqual([
      {
        providerSku: '607055',
        name: 'PlayStation US $10',
        brand: 'PlayStation',
        region: 'US',
        faceValue: { amount: '1735270', currency: 'IRT' },
        assetType: 'CODE',
      },
    ]);
  });

  it('walks only the configured categories, and a product listed twice once', async () => {
    const { calls, count } = stubFetch({
      'GET /product/get-products': ok({ products: [{ id: 5939, name: 'PlayStation' }] }),
      'GET /product/get-product': ok({ product: { id: 5939, name: 'PlayStation', variations: [variation()] } }),
    });

    await giftCards({ categoryIds: ['53', '47'] }).getCatalog();

    expect(calls.some((call) => call.path === 'GET /product/get-categories')).toBe(false);
    expect(count('GET /product/get-products')).toBe(2);
    expect(count('GET /product/get-product')).toBe(1);
  });

  it('fails whole when the venue cannot be read, rather than returning a short list', async () => {
    stubFetch({
      'GET /product/get-categories': ok({ categories: [{ id: 53, name: 'Gift cards' }] }),
      'GET /product/get-products': { status: 500, body: { code: 500, message: 'boom' } },
    });

    await expect(giftCards().getCatalog()).rejects.toBeInstanceOf(G4a4SupplierError);
  });
});

describe('gift-card price and availability', () => {
  it('prices a variation in its own currency', async () => {
    const { calls } = stubFetch({ 'GET /product/get-variation': CODE_VARIATION });

    const price = await giftCards().getPrice('607055');

    expect(price.cost).toEqual({ amount: '1735270', currency: 'IRT' });
    expect(calls[0]?.query).toEqual({ variation_id: '607055' });
  });

  it('reports sold-out, wrong-kind and missing variations as unavailable, and an outage as unknown', async () => {
    stubFetch({ 'GET /product/get-variation': ok({ variation: variation() }) });
    expect((await giftCards().checkAvailability('607055')).availability).toBe('AVAILABLE');

    stubFetch({ 'GET /product/get-variation': ok({ variation: variation({ in_stock: false }) }) });
    expect((await giftCards().checkAvailability('607055')).availability).toBe('UNAVAILABLE');

    stubFetch({ 'GET /product/get-variation': ok({ variation: variation({ delivery_type: 'manual' }) }) });
    expect((await giftCards().checkAvailability('607055')).availability).toBe('UNAVAILABLE');

    stubFetch({ 'GET /product/get-variation': { status: 404, body: { code: 404 } } });
    expect((await giftCards().checkAvailability('607055')).availability).toBe('UNAVAILABLE');

    expect((await giftCards().checkAvailability('not-a-sku')).availability).toBe('UNAVAILABLE');

    stubFetch({ 'GET /product/get-variation': { status: 503, body: {} } });
    expect((await giftCards().checkAvailability('607055')).availability).toBe('UNKNOWN');
  });
});

describe('gift-card purchase', () => {
  const REQUEST = { providerSku: '607055', quantity: 1, idempotencyKey: 'auto-fulfillment:o1' };

  it('orders one variation, carries our key as the venue reference, and answers PENDING with the order id', async () => {
    const { calls } = stubFetch({
      'GET /product/get-variation': CODE_VARIATION,
      'POST /order/add-order': ok({ order_id: 310414, total: 1_735_270, currency: 'IRT' }),
    });

    const result = await giftCards().purchase(REQUEST);

    expect(result).toEqual({
      status: 'PENDING',
      providerReference: '310414',
      cost: { amount: '1735270', currency: 'IRT' },
    });
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toEqual({ variation_id: '607055', quantity: 1, client_reference: 'auto-fulfillment:o1' });
    expect(JSON.stringify(post?.body)).not.toContain('test_mode');
  });

  it('never sends the same key twice, even when asked to', async () => {
    const { count } = stubFetch({
      'GET /product/get-variation': CODE_VARIATION,
      'POST /order/add-order': ok({ order_id: 310414, total: 1, currency: 'IRT' }),
    });
    const provider = giftCards();

    const first = await provider.purchase(REQUEST);
    const second = await provider.purchase(REQUEST);

    expect(second).toEqual(first);
    expect(count('POST /order/add-order')).toBe(1);
  });

  it('shares one request between calls racing on a key', async () => {
    const { count } = stubFetch({
      'GET /product/get-variation': CODE_VARIATION,
      'POST /order/add-order': ok({ order_id: 310414, total: 1, currency: 'IRT' }),
    });
    const provider = giftCards();

    await Promise.all([provider.purchase(REQUEST), provider.purchase(REQUEST)]);

    expect(count('POST /order/add-order')).toBe(1);
  });

  it('refuses before sending when the SKU or quantity is unusable', async () => {
    const { count } = stubFetch({});
    const provider = giftCards();

    expect(await provider.purchase({ ...REQUEST, quantity: 2 })).toEqual({ status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' });
    expect(await provider.purchase({ ...REQUEST, providerSku: '12:99' })).toEqual({ status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' });
    expect(await provider.purchase({ ...REQUEST, idempotencyKey: '  ' })).toEqual({ status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' });
    expect(count('POST /order/add-order')).toBe(0);
  });

  it('does not buy a variation that is manual, sold out, or asks for account data', async () => {
    for (const [overrides, code] of [
      [{ delivery_type: 'manual' }, 'DELIVERY_TYPE_MISMATCH'],
      [{ in_stock: false }, 'OUT_OF_STOCK'],
      [{ fields: [NAME_FIELD] }, 'ACCOUNT_FIELDS_REQUIRED'],
    ] as const) {
      const { count } = stubFetch({ 'GET /product/get-variation': ok({ variation: variation(overrides) }) });

      expect(await giftCards().purchase({ ...REQUEST, idempotencyKey: `k-${code}` })).toEqual({ status: 'FAILED', failureCode: code });
      expect(count('POST /order/add-order')).toBe(0);
    }
  });

  it('retries after a refusal that happened before anything was sent', async () => {
    const { count } = stubFetch({
      'GET /product/get-variation': [ok({ variation: variation({ in_stock: false }) }), CODE_VARIATION],
      'POST /order/add-order': ok({ order_id: 310414, total: 1, currency: 'IRT' }),
    });
    const provider = giftCards();

    expect((await provider.purchase(REQUEST)).failureCode).toBe('OUT_OF_STOCK');
    expect((await provider.purchase(REQUEST)).status).toBe('PENDING');
    expect(count('POST /order/add-order')).toBe(1);
  });

  it('classifies the venue answers: insufficient balance fails, a 5xx or dropped line is unknown', async () => {
    stubFetch({
      'GET /product/get-variation': CODE_VARIATION,
      'POST /order/add-order': { status: 400, body: { code: 400, message: 'Insufficient balance', data: { status: 400 } } },
    });
    expect(await giftCards().purchase(REQUEST)).toEqual({ status: 'FAILED', failureCode: 'INSUFFICIENT_BALANCE' });

    stubFetch({ 'GET /product/get-variation': CODE_VARIATION, 'POST /order/add-order': { status: 500, body: {} } });
    expect((await giftCards().purchase(REQUEST)).status).toBe('UNKNOWN');

    stubFetch({ 'GET /product/get-variation': CODE_VARIATION, 'POST /order/add-order': { status: 502, text: '<html>' } });
    expect((await giftCards().purchase({ ...REQUEST, idempotencyKey: 'k2' })).status).toBe('UNKNOWN');

    stubFetch({ 'GET /product/get-variation': CODE_VARIATION, 'POST /order/add-order': { throws: new Error('socket hang up') } });
    expect(await giftCards().purchase({ ...REQUEST, idempotencyKey: 'k3' })).toEqual({ status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' });
  });

  it('treats a 429 on the order as nothing charged and does not retry it by itself', async () => {
    const { count } = stubFetch({
      'GET /product/get-variation': CODE_VARIATION,
      'POST /order/add-order': { status: 429, body: {}, headers: { 'retry-after': '1' } },
    });

    expect(await giftCards().purchase(REQUEST)).toEqual({ status: 'FAILED', failureCode: 'RATE_LIMITED' });
    expect(count('POST /order/add-order')).toBe(1);
  });

  it('answers UNKNOWN when an accepted order carries no usable id', async () => {
    stubFetch({ 'GET /product/get-variation': CODE_VARIATION, 'POST /order/add-order': ok({ total: 5, currency: 'IRT' }) });

    expect(await giftCards().purchase(REQUEST)).toEqual({ status: 'UNKNOWN', failureCode: 'ORDER_ID_MISSING' });
  });
});

describe('gift-card status', () => {
  it('is PENDING while the order is processing', async () => {
    const { calls } = stubFetch({ 'GET /order/get-order': order('processing', { notes: '' }) });

    const result = await giftCards().getPurchaseStatus('310414');

    expect(result).toMatchObject({ status: 'PENDING', providerReference: '310414' });
    expect(result.asset).toBeUndefined();
    expect(calls[0]?.query).toEqual({ order_id: '310414' });
  });

  it('reads the code from the delivery note once completed', async () => {
    stubFetch({ 'GET /order/get-order': order('completed', { items: [{ name: 'PS', quantity: 1 }], notes: [CODE_NOTE] }) });

    const result = await giftCards().getPurchaseStatus('310414');

    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      providerReference: '310414',
      cost: { amount: '1735270', currency: 'IRT' },
      asset: { assetType: 'CODE', code: 'exl-dsispM4SbCxq' },
    });
  });

  it('counts one code once even when it appears in two notes', async () => {
    stubFetch({ 'GET /order/get-order': order('completed', { notes: [CODE_NOTE, CODE_NOTE] }) });

    expect((await giftCards().getPurchaseStatus('310414')).asset).toEqual({ assetType: 'CODE', code: 'exl-dsispM4SbCxq' });
  });

  it('sends a completed order with no code, or with several, to a human, never to a guess', async () => {
    stubFetch({ 'GET /order/get-order': order('completed', { notes: [{ note: 'Thank you for your order' }] }) });
    expect(await giftCards().getPurchaseStatus('310414')).toMatchObject({ status: 'UNKNOWN', failureCode: 'DELIVERY_MISSING' });

    stubFetch({ 'GET /order/get-order': order('completed', { notes: '' }) });
    expect(await giftCards().getPurchaseStatus('310414')).toMatchObject({ status: 'UNKNOWN', failureCode: 'DELIVERY_MISSING' });

    const second = { note: 'copyToClipboard(`other-code`)' };
    stubFetch({ 'GET /order/get-order': order('completed', { notes: [CODE_NOTE, second] }) });
    expect(await giftCards().getPurchaseStatus('310414')).toMatchObject({ status: 'UNKNOWN', failureCode: 'DELIVERY_AMBIGUOUS' });
  });

  it('ignores a code that is not a plain token', async () => {
    stubFetch({ 'GET /order/get-order': order('completed', { notes: [{ note: 'copyToClipboard(`<script>x</script>`)' }] }) });

    expect(await giftCards().getPurchaseStatus('310414')).toMatchObject({ status: 'UNKNOWN', failureCode: 'DELIVERY_MISSING' });
  });

  it('maps refused statuses to a settled failure and anything unfamiliar to unknown', async () => {
    for (const status of ['failed', 'cancelled', 'refunded']) {
      stubFetch({ 'GET /order/get-order': order(status) });
      expect(await giftCards().getPurchaseStatus('310414')).toMatchObject({
        status: 'FAILED',
        failureCode: `G4A4_${status.toUpperCase()}`,
      });
    }

    stubFetch({ 'GET /order/get-order': order('mystery') });
    expect((await giftCards().getPurchaseStatus('310414')).status).toBe('UNKNOWN');
  });

  it('answers UNKNOWN for a missing order, an outage, or a reference that is not an id', async () => {
    stubFetch({ 'GET /order/get-order': { status: 404, body: { code: 404 } } });
    expect(await giftCards().getPurchaseStatus('310414')).toMatchObject({ status: 'UNKNOWN', failureCode: 'ORDER_NOT_FOUND' });

    stubFetch({ 'GET /order/get-order': { status: 500, body: {} } });
    expect((await giftCards().getPurchaseStatus('310414')).status).toBe('UNKNOWN');

    const { count } = stubFetch({});
    expect(await giftCards().getPurchaseStatus('../etc')).toMatchObject({ status: 'UNKNOWN', failureCode: 'INVALID_PROVIDER_REFERENCE' });
    expect(count('GET /order/get-order')).toBe(0);
  });

  it('waits out a 429 on a read for the stated time, then answers', async () => {
    const waits: number[] = [];
    stubFetch({
      'GET /order/get-order': [{ status: 429, body: {}, headers: { 'retry-after': '3' } }, order('processing')],
    });

    const result = await giftCards({ sleep: async (ms: number) => void waits.push(ms) }).getPurchaseStatus('310414');

    expect(result.status).toBe('PENDING');
    expect(waits).toEqual([3_000]);
  });
});

describe('top-up catalogue', () => {
  const PRODUCT = ok({
    product: {
      id: 1034,
      name: 'PUBG Mobile',
      variations: [
        variation({ id: 9001, name: '60 UC', delivery_type: 'topup', price: 120_000, fields: [NAME_FIELD], attributes: [] }),
        variation({ id: 9002, name: '325 UC', delivery_type: 'topup', price: 600_000, fields: [NAME_FIELD], attributes: [] }),
        variation({ id: 9003, name: 'sold out', delivery_type: 'topup', in_stock: false, fields: [NAME_FIELD], attributes: [] }),
        variation({ id: 9004, name: 'a card', delivery_type: 'code' }),
      ],
    },
  });

  const ROUTES = {
    'GET /product/get-categories': ok({ categories: [{ id: 47, name: 'Game points' }] }),
    'GET /product/get-products': ok({ products: [{ id: 1034, name: 'PUBG Mobile' }] }),
    'GET /product/get-product': PRODUCT,
  };

  it('groups top-up variations by product, with the fields they declare, and drops sold-out ones', async () => {
    stubFetch(ROUTES);

    const games = await topUps().getTopUpCatalog();

    expect(games).toEqual([
      {
        categoryId: '1034',
        name: 'PUBG Mobile',
        region: 'GLOBAL',
        note: null,
        imageUrl: null,
        fields: [{ key: 'player_id', label: 'Player ID', type: 'TEXT', required: true, credential: false }],
        offers: [
          { offerId: '9001', name: '60 UC', cost: { amount: '120000', currency: 'IRT' } },
          { offerId: '9002', name: '325 UC', cost: { amount: '600000', currency: 'IRT' } },
        ],
        requiresCredentials: false,
      },
    ]);
  });

  it('flags a game that wants a password, in English or Persian, or a file, so it is never sold', async () => {
    const cases: Record<string, unknown>[] = [
      { data_name: 'game_password', type: 'password', required: true, name: 'Password' },
      { data_name: 'field_x', type: 'text', required: true, name: 'رمز عبور' },
      { data_name: 'proof', type: 'upload', required: true, name: 'Screenshot' },
      { data_name: 'amount', type: 'measure_input', required: true, name: 'Amount' },
    ];
    for (const field of cases) {
      stubFetch({
        ...ROUTES,
        'GET /product/get-product': ok({
          product: { id: 1, name: 'G', variations: [variation({ delivery_type: 'topup', fields: [NAME_FIELD, field], attributes: [] })] },
        }),
      });

      const [game] = await topUps().getTopUpCatalog();

      expect(game?.requiresCredentials).toBe(true);
    }
  });

  it('does not ask for an optional upload', async () => {
    stubFetch({
      ...ROUTES,
      'GET /product/get-product': ok({
        product: {
          id: 1,
          name: 'G',
          variations: [variation({ delivery_type: 'topup', fields: [NAME_FIELD, { data_name: 'shot', type: 'upload', required: false, name: 'Shot' }], attributes: [] })],
        },
      }),
    });

    const [game] = await topUps().getTopUpCatalog();

    expect(game?.fields.map((field) => field.key)).toEqual(['player_id']);
    expect(game?.requiresCredentials).toBe(false);
  });

  it('flattens to catalogue items keyed `<product>:<variation>`', async () => {
    stubFetch(ROUTES);

    const items = await topUps().getCatalog();

    expect(items.map((item) => item.providerSku)).toEqual(['1034:9001', '1034:9002']);
    expect(items[0]).toMatchObject({
      assetType: 'DIRECT_TOPUP',
      groupLabel: 'PUBG Mobile',
      requiredAccountFields: ['player_id'],
      faceValue: { amount: '120000', currency: 'IRT' },
    });
  });

  it('skips a product with no top-up variation, and reports an unreadable one only in the tolerant read', async () => {
    stubFetch({
      ...ROUTES,
      'GET /product/get-products': ok({ products: [{ id: 1034, name: 'PUBG Mobile' }, { id: 2, name: 'Broken' }] }),
      'GET /product/get-product': [PRODUCT, { status: 500, body: {} }],
    });

    const read = await topUps().readTopUpCatalog();

    expect(read.games.map((game) => game.name)).toEqual(['PUBG Mobile']);
    expect(read.unreadable).toEqual([{ categoryId: '2', name: 'Broken', failureCode: 'CATALOG_UNAVAILABLE' }]);
  });

  it('fails whole in the strict read when any product cannot be read', async () => {
    stubFetch({
      ...ROUTES,
      'GET /product/get-products': ok({ products: [{ id: 1034, name: 'PUBG Mobile' }, { id: 2, name: 'Broken' }] }),
      'GET /product/get-product': [PRODUCT, { status: 500, body: {} }],
    });

    await expect(topUps().getTopUpCatalog()).rejects.toBeInstanceOf(G4a4SupplierError);
  });
});

describe('top-up purchase', () => {
  const REQUEST = {
    providerSku: '1034:9001',
    quantity: 1,
    idempotencyKey: 'topup:o1',
    accountFields: { player_id: '5001234567' },
  };

  it('sends the declared fields under `data`, with our key as the venue reference', async () => {
    const { calls } = stubFetch({
      'GET /product/get-variation': TOPUP_VARIATION,
      'POST /order/add-order': ok({ order_id: 310500, total: 120_000, currency: 'IRT' }),
    });

    const result = await topUps().purchase(REQUEST);

    expect(result).toEqual({ status: 'PENDING', providerReference: '310500', cost: { amount: '120000', currency: 'IRT' } });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      variation_id: '9001',
      quantity: 1,
      client_reference: 'topup:o1',
      data: { player_id: '5001234567' },
    });
  });

  it('sends only the fields the variation declares, so a stray value is not forwarded', async () => {
    const { calls } = stubFetch({
      'GET /product/get-variation': TOPUP_VARIATION,
      'POST /order/add-order': ok({ order_id: 310500, total: 1, currency: 'IRT' }),
    });

    await topUps().purchase({ ...REQUEST, accountFields: { player_id: '5001234567', extra: 'x' } });

    expect((calls.find((call) => call.method === 'POST')?.body as { data: unknown }).data).toEqual({ player_id: '5001234567' });
  });

  it('refuses before sending when account data is missing or the SKU is unusable', async () => {
    const { count } = stubFetch({ 'GET /product/get-variation': TOPUP_VARIATION });
    const provider = topUps();

    expect(await provider.purchase({ ...REQUEST, accountFields: {} })).toEqual({ status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' });
    expect(await provider.purchase({ ...REQUEST, providerSku: '9001' })).toEqual({ status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' });
    expect(await provider.purchase({ ...REQUEST, quantity: 3 })).toEqual({ status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' });
    expect(await provider.purchase({ ...REQUEST, accountFields: { other: 'x' } })).toEqual({ status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' });
    expect(count('POST /order/add-order')).toBe(0);
  });

  it('refuses a variation that wants a credential, is sold out, or is not a top-up', async () => {
    const wantsPassword = ok({
      variation: variation({
        delivery_type: 'topup',
        fields: [NAME_FIELD, { data_name: 'game_password', type: 'password', required: true, name: 'Password' }],
      }),
    });
    for (const [route, code] of [
      [wantsPassword, 'CREDENTIALS_REQUIRED'],
      [ok({ variation: variation({ delivery_type: 'topup', in_stock: false, fields: [NAME_FIELD] }) }), 'OUT_OF_STOCK'],
      [CODE_VARIATION, 'DELIVERY_TYPE_MISMATCH'],
    ] as const) {
      const { count } = stubFetch({ 'GET /product/get-variation': route });

      expect(await topUps().purchase({ ...REQUEST, idempotencyKey: `k-${code}` })).toEqual({ status: 'FAILED', failureCode: code });
      expect(count('POST /order/add-order')).toBe(0);
    }
  });

  it('never sends the same key twice', async () => {
    const { count } = stubFetch({
      'GET /product/get-variation': TOPUP_VARIATION,
      'POST /order/add-order': ok({ order_id: 310500, total: 1, currency: 'IRT' }),
    });
    const provider = topUps();

    await provider.purchase(REQUEST);
    await provider.purchase(REQUEST);

    expect(count('POST /order/add-order')).toBe(1);
  });

  it('answers UNKNOWN when the line drops after sending', async () => {
    stubFetch({ 'GET /product/get-variation': TOPUP_VARIATION, 'POST /order/add-order': { throws: new Error('reset') } });

    expect(await topUps().purchase(REQUEST)).toEqual({ status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' });
  });
});

describe('top-up status', () => {
  it('is PENDING while processing and DIRECT_TOPUP with no secret once completed', async () => {
    stubFetch({ 'GET /order/get-order': order('processing') });
    expect((await topUps().getPurchaseStatus('310500')).status).toBe('PENDING');

    stubFetch({ 'GET /order/get-order': order('completed', { notes: [CODE_NOTE] }) });
    const done = await topUps().getPurchaseStatus('310500');

    expect(done).toMatchObject({ status: 'SUCCEEDED', asset: { assetType: 'DIRECT_TOPUP', accountReference: 'credited' } });
    expect(JSON.stringify(done)).not.toContain('exl-dsispM4SbCxq');
  });

  it('settles a refused order as failed', async () => {
    stubFetch({ 'GET /order/get-order': order('refunded') });

    expect(await topUps().getPurchaseStatus('310500')).toMatchObject({ status: 'FAILED', failureCode: 'G4A4_REFUNDED' });
  });
});

describe('top-up price and availability', () => {
  it('prices and checks a variation through its own id', async () => {
    const { calls } = stubFetch({ 'GET /product/get-variation': TOPUP_VARIATION });

    expect((await topUps().getPrice('1034:9001')).cost).toEqual({ amount: '1735270', currency: 'IRT' });
    expect((await topUps().checkAvailability('1034:9001')).availability).toBe('AVAILABLE');
    expect(calls[0]?.query).toEqual({ variation_id: '9001' });
  });

  it('marks a gone, sold-out or malformed offer unavailable, and an outage unknown', async () => {
    stubFetch({ 'GET /product/get-variation': { status: 404, body: {} } });
    expect((await topUps().checkAvailability('1034:9001')).availability).toBe('UNAVAILABLE');

    stubFetch({ 'GET /product/get-variation': ok({ variation: variation({ delivery_type: 'topup', in_stock: false }) }) });
    expect((await topUps().checkAvailability('1034:9001')).availability).toBe('UNAVAILABLE');

    expect((await topUps().checkAvailability('nope')).availability).toBe('UNAVAILABLE');

    stubFetch({ 'GET /product/get-variation': { status: 500, body: {} } });
    expect((await topUps().checkAvailability('1034:9001')).availability).toBe('UNKNOWN');
  });
});
