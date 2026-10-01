import { afterEach, describe, expect, it } from 'vitest';

import {
  FazerCardsTopUpSupplierProvider,
  FazerCardsTopUpSupplierError,
  parseFazerCardsTopUpProviderSku,
} from './fazercards-topup.provider';

const ORIGINAL_FETCH = globalThis.fetch;

const CREDENTIALS = { apiKey: 'fzr_test_key' } as const;

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

/** Routes by "METHOD path" (query string dropped) so pagination shares one entry per page shape. */
function stubFetch(routes: Record<string, Route | readonly Route[]>): {
  calls: Call[];
  find: (key: string) => Call | undefined;
} {
  const calls: Call[] = [];
  const counters = new Map<string, number>();

  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    calls.push({
      url: String(input),
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
    const chosen = Array.isArray(route)
      ? (route[Math.min(index, route.length - 1)] as Route)
      : (route as Route);

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

  return { calls, find: (key) => calls.find((c) => `${c.method} ${new URL(c.url).pathname}` === key) };
}

function categoriesPage(overrides: Record<string, unknown> = {}): Route {
  return {
    body: {
      ok: true,
      kind: 'topup',
      items: [{ category_id: 'pubg_mobile', name: 'PUBG Mobile' }],
      meta: { total: 1, limit: 100, next_cursor: null, has_more: false },
      ...overrides,
    },
  };
}

/** Shape documented at reseller.fazercards.com/en/docs: `fields` sit on the category, offers carry no `stock`. */
function offers(
  overrides: Record<string, unknown> = {},
  categoryOverrides: Record<string, unknown> = {},
): Route {
  return {
    body: {
      ok: true,
      kind: 'topup',
      category_id: 'pubg_mobile',
      name: 'PUBG Mobile',
      fields: [{ key: 'player_id', label: 'Player ID', type: 'text' }],
      offers: [{ offer_id: '60_uc', name: '60 UC', price_usd: '0.9900', ...overrides }],
      ...categoryOverrides,
    },
  };
}

function order(overrides: Record<string, unknown> = {}): Route {
  return {
    body: {
      ok: true,
      order: { id: 'ord-777', kind: 'topup', status: 'completed', ...overrides },
    },
  };
}

function provider(options: Record<string, unknown> = {}) {
  return new FazerCardsTopUpSupplierProvider({
    ...CREDENTIALS,
    ...options,
  } as ConstructorParameters<typeof FazerCardsTopUpSupplierProvider>[0]);
}

const REQUEST = {
  providerSku: 'pubg_mobile:60_uc',
  quantity: 1,
  idempotencyKey: 'order-1',
  accountFields: { player_id: '5001234567' },
} as const;

describe('FazerCardsTopUpSupplierProvider', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  describe('provider SKU', () => {
    it('splits category and offer id', () => {
      expect(parseFazerCardsTopUpProviderSku('pubg_mobile:60_uc')).toEqual({
        categoryId: 'pubg_mobile',
        offerId: '60_uc',
      });
      expect(() => parseFazerCardsTopUpProviderSku('pubg_mobile')).toThrow(FazerCardsTopUpSupplierError);
    });
  });

  describe('getCatalog', () => {
    it('reads categories, offers, and required account fields', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers(),
      });

      const items = await provider().getCatalog();

      expect(items).toEqual([
        {
          providerSku: 'pubg_mobile:60_uc',
          name: '60 UC',
          region: 'GLOBAL',
          faceValue: { amount: '0.9900', currency: 'USD' },
          assetType: 'DIRECT_TOPUP',
          requiredAccountFields: ['player_id'],
          groupLabel: 'PUBG Mobile',
        },
      ]);
    });

    it('omits requiredAccountFields when the venue sends none', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers({}, { fields: undefined }),
      });

      const [item] = await provider().getCatalog();

      expect(item?.requiredAccountFields).toBeUndefined();
    });

    it('sends the API key and follows cursor pagination across pages', async () => {
      const { calls, find } = stubFetch({
        'GET /api/v2/topups': [
          {
            body: {
              ok: true,
              items: [{ category_id: 'pubg_mobile', name: 'PUBG Mobile' }],
              meta: { total: 2, limit: 100, next_cursor: 'page-2', has_more: true },
            },
          },
          {
            body: {
              ok: true,
              items: [{ category_id: 'free_fire', name: 'Free Fire' }],
              meta: { total: 2, limit: 100, next_cursor: null, has_more: false },
            },
          },
        ],
        'GET /api/v2/topups/offers': offers(),
      });

      await provider().getCatalog();

      const topupsCalls = calls.filter((c) => c.url.includes('/topups?') || c.url.includes('/topups&'));
      expect(topupsCalls).toHaveLength(2);
      expect(new URL(topupsCalls[1]?.url ?? '').searchParams.get('cursor')).toBe('page-2');
      expect(find('GET /api/v2/topups')?.headers['x-api-key']).toBe('fzr_test_key');
    });

    it('skips a listed category whose offers are gone', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage({
          items: [
            { category_id: 'arena_breakout_infinite', name: 'Arena Breakout: Infinite' },
            { category_id: 'pubg_mobile', name: 'PUBG Mobile' },
          ],
          meta: { total: 2, limit: 100, next_cursor: null, has_more: false },
        }),
        'GET /api/v2/topups/offers': [
          { status: 404, body: { ok: false, error: 'Unknown category', code: 'NOT_FOUND' } },
          offers(),
        ],
      });

      const items = await provider().getCatalog();

      expect(items.map((item) => item.providerSku)).toEqual(['pubg_mobile:60_uc']);
    });

    it('refuses a category list shorter than its own total once pagination stops', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage({ meta: { total: 5, limit: 100, next_cursor: null, has_more: false } }),
      });

      await expect(provider().getCatalog()).rejects.toMatchObject({ code: 'INCOMPLETE_CATALOG' });
    });

    it('leaves out an offer whose price cannot be read', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers({ price_usd: 'n/a' }),
      });

      await expect(provider().getCatalog()).resolves.toEqual([]);
    });
  });

  describe('getTopUpCatalog', () => {
    it('reads a user-id-only game', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers(),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game).toEqual({
        categoryId: 'pubg_mobile',
        name: 'PUBG Mobile',
        region: 'GLOBAL',
        note: null,
        imageUrl: null,
        fields: [{ key: 'player_id', label: 'Player ID', type: 'TEXT', required: true, credential: false }],
        offers: [{ offerId: '60_uc', name: '60 UC', cost: { amount: '0.9900', currency: 'USD' } }],
        requiresCredentials: false,
      });
    });

    it('reads a user id plus a server chosen from a list', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage({
          items: [{ category_id: 'mlbb', name: 'Mobile Legends', region: 'SEA', note: 'Find both ids in your profile' }],
        }),
        'GET /api/v2/topups/offers': offers(
          {},
          {
            fields: [
              { key: 'user_id', label: 'User ID', type: 'text', pattern: '^\\d{6,12}$' },
              { key: 'zone_id', label: 'Server', type: 'select', options: [{ value: '2001', label: 'Asia' }, 'Europe'] },
            ],
          },
        ),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game?.region).toBe('SEA');
      expect(game?.note).toBe('Find both ids in your profile');
      expect(game?.requiresCredentials).toBe(false);
      expect(game?.fields).toEqual([
        { key: 'user_id', label: 'User ID', type: 'TEXT', required: true, pattern: '^\\d{6,12}$', credential: false },
        {
          key: 'zone_id',
          label: 'Server',
          type: 'SELECT',
          required: true,
          options: [
            { label: 'Asia', value: '2001' },
            { label: 'Europe', value: 'Europe' },
          ],
          credential: false,
        },
      ]);
    });

    it('accepts a server list keyed by value, bare field names, and optional fields', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers(
          {},
          {
            fields: undefined,
            required_fields: ['player_id', { name: 'server', options: { s1: 'Server 1' } }, { key: 'nickname', optional: true }],
          },
        ),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game?.fields).toEqual([
        { key: 'player_id', label: 'Player id', type: 'TEXT', required: true, credential: false },
        {
          key: 'server',
          label: 'Server',
          type: 'SELECT',
          required: true,
          options: [{ label: 'Server 1', value: 's1' }],
          credential: false,
        },
        { key: 'nickname', label: 'Nickname', type: 'TEXT', required: false, credential: false },
      ]);
    });

    it.each([
      ['a password-typed field', { key: 'login', label: 'Login', type: 'password' }],
      ['a field named password', { key: 'account_password', label: 'Account' }],
      ['a field labelled as a password', { key: 'secret_field', label: 'Password' }],
      ['a one-time code', { key: 'otp', label: 'Code from SMS' }],
      ['a PIN', { key: 'pin', label: 'PIN' }],
    ])('marks a game that asks for %s as requiring credentials', async (_name, credentialField) => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers(
          {},
          { fields: [{ key: 'email', label: 'Email', type: 'text' }, credentialField] },
        ),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game?.requiresCredentials).toBe(true);
      expect(game?.fields.map((field) => field.credential)).toEqual([false, true]);
    });

    it('does not mistake an ordinary id for a credential', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers(
          {},
          {
            fields: [
              { key: 'player_id', label: 'Player ID' },
              { key: 'server_id', label: 'Server ID' },
              { key: 'shipping_region', label: 'Region' },
            ],
          },
        ),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game?.requiresCredentials).toBe(false);
    });

    it('drops a pattern that does not compile and a field without a key', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers(
          {},
          { fields: [{ key: 'player_id', pattern: '([' }, { label: 'No key' }, { key: 'player_id', label: 'Dup' }] },
        ),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game?.fields).toEqual([
        { key: 'player_id', label: 'Player id', type: 'TEXT', required: true, credential: false },
      ]);
    });

    it('falls back to fields on the category row when the offers payload has none', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage({
          items: [{ category_id: 'pubg_mobile', name: 'PUBG Mobile', fields: ['character_id'] }],
        }),
        'GET /api/v2/topups/offers': offers({}, { fields: undefined }),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game?.fields.map((field) => field.key)).toEqual(['character_id']);
    });

    it('keeps an https cover image, from the row or its ui block, and refuses plain http', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage({
          items: [
            { category_id: 'a', name: 'A', ui: { image_url: 'https://cdn.example/a.png' } },
            { category_id: 'b', name: 'B', image_url: 'http://cdn.example/b.png' },
          ],
          meta: { total: 2, limit: 100, next_cursor: null, has_more: false },
        }),
        'GET /api/v2/topups/offers': offers(),
      });

      const games = await provider().getTopUpCatalog();

      expect(games.map((game) => game.imageUrl)).toEqual(['https://cdn.example/a.png', null]);
    });

    it('keeps an offer whose price cannot be read, with a null cost', async () => {
      stubFetch({
        'GET /api/v2/topups': categoriesPage(),
        'GET /api/v2/topups/offers': offers({ price_usd: undefined, offer_id: undefined, id: '325_uc' }),
      });

      const [game] = await provider().getTopUpCatalog();

      expect(game?.offers).toEqual([{ offerId: '325_uc', name: '60 UC', cost: null }]);
    });

    it('returns games in the venue order however the offer calls interleave', async () => {
      const names = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
      let inFlight = 0;
      let peak = 0;
      globalThis.fetch = (async (input: string) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v2/topups') {
          return {
            status: 200,
            json: async () => ({
              ok: true,
              items: names.map((id) => ({ category_id: id, name: id })),
              meta: { total: names.length, has_more: false, next_cursor: null },
            }),
          } as unknown as Response;
        }
        const id = url.searchParams.get('category_id') ?? '';
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        /* Earlier games answer later, so completion order is the reverse of request order. */
        await new Promise((resolve) => setTimeout(resolve, (names.length - names.indexOf(id)) * 2));
        inFlight -= 1;
        return {
          status: 200,
          json: async () => ({ ok: true, fields: ['player_id'], offers: [{ offer_id: `${id}-o`, name: 'o', price_usd: '1.0000' }] }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const games = await provider().getTopUpCatalog();

      expect(games.map((game) => game.categoryId)).toEqual(names);
      expect(peak).toBeLessThanOrEqual(4);
      expect(peak).toBeGreaterThan(1);
    });
  });

  describe('getPrice', () => {
    it('reads the price off the matching offer', async () => {
      stubFetch({ 'GET /api/v2/topups/offers': offers() });

      await expect(provider().getPrice('pubg_mobile:60_uc')).resolves.toMatchObject({
        cost: { amount: '0.9900', currency: 'USD' },
      });
    });
  });

  describe('checkAvailability', () => {
    it('treats a listed offer as available', async () => {
      stubFetch({ 'GET /api/v2/topups/offers': offers() });

      await expect(provider().checkAvailability('pubg_mobile:60_uc')).resolves.toMatchObject({
        availability: 'AVAILABLE',
      });
    });

    it('still honours an explicit zero stock', async () => {
      stubFetch({ 'GET /api/v2/topups/offers': offers({ stock: 0 }) });

      await expect(provider().checkAvailability('pubg_mobile:60_uc')).resolves.toMatchObject({
        availability: 'UNAVAILABLE',
      });
    });

    it('treats a missing offer as unavailable and an outage as unknown', async () => {
      const missing = provider();
      stubFetch({ 'GET /api/v2/topups/offers': offers() });
      await expect(missing.checkAvailability('pubg_mobile:other_offer')).resolves.toMatchObject({
        availability: 'UNAVAILABLE',
      });

      const down = provider();
      stubFetch({ 'GET /api/v2/topups/offers': { status: 503, body: {} } });
      await expect(down.checkAvailability('pubg_mobile:60_uc')).resolves.toMatchObject({
        availability: 'UNKNOWN',
      });
    });
  });

  describe('purchase', () => {
    it('refuses to buy without account fields', async () => {
      const { calls } = stubFetch({});

      await expect(
        provider().purchase({ ...REQUEST, accountFields: undefined }),
      ).resolves.toEqual({ status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' });
      expect(calls).toHaveLength(0);
    });

    it('tops up the account, sends the Idempotency-Key header, and returns a confirmation never a code', async () => {
      const { find } = stubFetch({ 'POST /api/v2/topups/order': order() });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'SUCCEEDED',
        providerReference: 'ord-777',
        asset: { assetType: 'DIRECT_TOPUP', accountReference: 'player_id=5001234567' },
      });
      const call = find('POST /api/v2/topups/order');
      expect(call?.body).toEqual({
        category_id: 'pubg_mobile',
        offer_id: '60_uc',
        fields: { player_id: '5001234567' },
      });
      expect(call?.headers['idempotency-key']).toBe('order-1');
      expect(call?.headers['x-api-key']).toBe('fzr_test_key');
    });

    it('refuses a multi-unit order before spending anything', async () => {
      const { calls } = stubFetch({});

      await expect(provider().purchase({ ...REQUEST, quantity: 2 })).resolves.toEqual({
        status: 'FAILED',
        failureCode: 'QUANTITY_NOT_SUPPORTED',
      });
      expect(calls).toHaveLength(0);
    });

    it('refuses an idempotency key longer than the documented 255-character limit', async () => {
      const { calls } = stubFetch({});

      await expect(
        provider().purchase({ ...REQUEST, idempotencyKey: 'x'.repeat(256) }),
      ).resolves.toEqual({ status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' });
      expect(calls).toHaveLength(0);
    });

    it('maps a failed order to FAILED using its reason', async () => {
      stubFetch({
        'POST /api/v2/topups/order': order({ status: 'failed', reason: 'account_not_found' }),
      });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'account_not_found',
      });
    });

    it('maps a refunded order to FAILED with a default reason when the venue gives none', async () => {
      stubFetch({ 'POST /api/v2/topups/order': order({ status: 'refunded' }) });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'PROVIDER_DECLINED',
      });
    });

    it('treats a stated 4xx refusal as FAILED, since nothing was charged', async () => {
      stubFetch({
        'POST /api/v2/topups/order': {
          status: 400,
          body: { ok: false, error: 'offer is retired', code: 'invalid_request' },
        },
      });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'PROVIDER_INVALID_REQUEST',
      });
    });

    it('treats a 409 idempotency-key conflict as FAILED, since nothing was charged', async () => {
      stubFetch({
        'POST /api/v2/topups/order': {
          status: 409,
          body: { ok: false, error: 'key reused with a different body' },
        },
      });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'PROVIDER_REJECTED',
      });
    });

    it('treats a rate-limit refusal as FAILED, since the limiter rejects before any charge', async () => {
      stubFetch({ 'POST /api/v2/topups/order': { status: 429, body: {} } });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'RATE_LIMITED',
      });
    });

    it('treats a server error as UNKNOWN, because the account may already be credited', async () => {
      stubFetch({ 'POST /api/v2/topups/order': { status: 502, text: '<html>gateway</html>' } });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'PROVIDER_UNAVAILABLE',
      });
    });

    it('collapses concurrent calls sharing a key into a single HTTP purchase', async () => {
      const { calls } = stubFetch({ 'POST /api/v2/topups/order': order() });
      const subject = provider();

      const [first, second] = await Promise.all([subject.purchase(REQUEST), subject.purchase(REQUEST)]);

      expect(first).toEqual(second);
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    });

    it('calls the venue again for a sequential retry, relying on its own Idempotency-Key replay', async () => {
      const { calls } = stubFetch({ 'POST /api/v2/topups/order': order() });
      const subject = provider();

      await subject.purchase(REQUEST);
      const second = await subject.purchase(REQUEST);

      // Unlike the ReSellCodes adapters, there is no local settle cache: the
      // venue is trusted to answer the same Idempotency-Key with the same order.
      expect(second).toMatchObject({ status: 'SUCCEEDED', providerReference: 'ord-777' });
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    });
  });

  describe('getPurchaseStatus', () => {
    it('resolves a completed order into its confirmation asset when the venue echoes the account', async () => {
      stubFetch({ 'GET /api/v2/orders/ord-777': order({ account_reference: 'player_id=5001234567' }) });

      await expect(provider().getPurchaseStatus('ord-777')).resolves.toMatchObject({
        status: 'SUCCEEDED',
        asset: { assetType: 'DIRECT_TOPUP', accountReference: 'player_id=5001234567' },
      });
    });

    /*
     * A status lookup (unlike `purchase()`) has no request-side account fields
     * to fall back on, so a completed order the venue does not itself tie to
     * an account cannot be reported as a usable confirmation.
     */
    it('reports a completed order with no account reference as UNKNOWN', async () => {
      stubFetch({ 'GET /api/v2/orders/ord-777': order() });

      const result = await provider().getPurchaseStatus('ord-777');
      expect(result).toMatchObject({ status: 'UNKNOWN', failureCode: 'ACCOUNT_REFERENCE_MISSING' });
    });

    it('does not read a missing order as proof that nothing was bought', async () => {
      stubFetch({ 'GET /api/v2/orders/ord-777': { status: 404, body: {} } });

      await expect(provider().getPurchaseStatus('ord-777')).resolves.toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'ORDER_NOT_FOUND',
      });
    });

    it('rejects a reference that does not look like a FazerCards order id without calling out', async () => {
      const { calls } = stubFetch({});

      await expect(provider().getPurchaseStatus('../me')).resolves.toMatchObject({
        failureCode: 'INVALID_PROVIDER_REFERENCE',
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe('getBalance', () => {
    it('reads the balance and its own stated currency', async () => {
      stubFetch({
        'GET /api/v2/balance': { body: { ok: true, balance: '128.4000', currency: 'USD' } },
      });

      await expect(provider().getBalance()).resolves.toMatchObject({
        amount: '128.4000',
        currency: 'USD',
      });
    });
  });

  describe('construction', () => {
    it('refuses to start without an API key', () => {
      expect(() => provider({ apiKey: '  ' })).toThrow(RangeError);
    });
  });
});
