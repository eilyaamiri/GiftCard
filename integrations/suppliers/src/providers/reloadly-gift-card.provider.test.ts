import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ReloadlyGiftCardSupplierProvider,
  ReloadlySupplierError,
  parseProviderSku,
} from './reloadly-gift-card.provider';

const ORIGINAL_FETCH = globalThis.fetch;

const CREDENTIALS = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  recipientEmail: 'vault@baratpay.example',
} as const;

interface Route {
  readonly status?: number;
  readonly body?: unknown;
  /** Non-JSON body, for the parse-failure paths. */
  readonly text?: string;
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Routes by "METHOD path" so a test states only the calls it cares about; an
 * unrouted call fails loudly rather than silently returning an empty object.
 */
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

const TOKEN_ROUTE: Route = {
  body: { access_token: 'test-token', expires_in: 5_184_000, token_type: 'Bearer' },
};

/** Shape recorded from the live venue on 2026-09-04. */
function fixedProduct(overrides: Record<string, unknown> = {}): Route {
  return {
    body: {
      productId: 3943,
      productName: 'Google Play KSA',
      status: 'ACTIVE',
      senderFee: 1.0,
      senderFeePercentage: 0.0,
      discountPercentage: 0.0,
      denominationType: 'FIXED',
      recipientCurrencyCode: 'SAR',
      senderCurrencyCode: 'USD',
      fixedRecipientDenominations: [20.0, 100.0],
      fixedRecipientToSenderDenominationsMap: { '20.0': 5.36, '100.0': 26.79 },
      country: { isoName: 'SA', name: 'Saudi Arabia' },
      brand: { brandId: 25, brandName: 'Google play' },
      ...overrides,
    },
  };
}

/** Amazon US: a RANGE product billed in the currency it is denominated in. */
function rangeProduct(overrides: Record<string, unknown> = {}): Route {
  return {
    body: {
      productId: 5,
      productName: 'Amazon US',
      status: 'ACTIVE',
      senderFee: 0.0,
      senderFeePercentage: 0.0,
      denominationType: 'RANGE',
      recipientCurrencyCode: 'USD',
      senderCurrencyCode: 'USD',
      minRecipientDenomination: 5.0,
      maxRecipientDenomination: 100.0,
      fixedRecipientDenominations: [],
      fixedRecipientToSenderDenominationsMap: null,
      country: { isoName: 'US', name: 'United States' },
      ...overrides,
    },
  };
}

function page(content: readonly unknown[]): Route {
  return { body: { content, last: true, totalElements: content.length } };
}

function transaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transactionId: 4242,
    status: 'SUCCESSFUL',
    amount: 26.79,
    fee: 1.0,
    discount: 0.5,
    currencyCode: 'USD',
    customIdentifier: 'order-1',
    ...overrides,
  };
}

function provider(options: Partial<Parameters<typeof makeProvider>[0]> = {}) {
  return makeProvider(options);
}

function makeProvider(options: Record<string, unknown>) {
  return new ReloadlyGiftCardSupplierProvider({
    ...CREDENTIALS,
    ...options,
  } as ConstructorParameters<typeof ReloadlyGiftCardSupplierProvider>[0]);
}

describe('ReloadlyGiftCardSupplierProvider', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  describe('provider SKU', () => {
    it('requires an explicit denomination', () => {
      expect(parseProviderSku('5:25')).toEqual({ productId: 5, unitPriceScaled: 25_000_000n });
      /* A bare product id would let a default choose the price we pay. */
      expect(() => parseProviderSku('5')).toThrow(ReloadlySupplierError);
      expect(() => parseProviderSku('5:0')).toThrow(ReloadlySupplierError);
      expect(() => parseProviderSku('abc:10')).toThrow(ReloadlySupplierError);
    });
  });

  describe('authentication', () => {
    it('scopes the token to the environment through the audience', async () => {
      const { find } = stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': rangeProduct(),
      });

      await provider({ environment: 'sandbox' }).checkAvailability('5:25');

      const auth = find('POST /oauth/token');
      expect(auth?.body).toEqual({
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        grant_type: 'client_credentials',
        audience: 'https://giftcards-sandbox.reloadly.com',
      });
      expect(find('GET /products/5')?.url).toContain('giftcards-sandbox.reloadly.com');
    });

    it('reuses one token across calls and versions the Accept header', async () => {
      const { calls, find } = stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': rangeProduct(),
      });
      const subject = provider();

      await subject.checkAvailability('5:25');
      await subject.checkAvailability('5:50');

      expect(calls.filter((c) => c.url.includes('oauth/token'))).toHaveLength(1);
      expect(find('GET /products/5')?.headers).toMatchObject({
        accept: 'application/com.reloadly.giftcards-v1+json',
        authorization: 'Bearer test-token',
      });
    });

    it('re-authenticates once on 401 and then gives up', async () => {
      const { calls } = stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': [
          { status: 401, body: { errorCode: 'INVALID_TOKEN' } },
          { status: 401, body: { errorCode: 'INVALID_TOKEN' } },
        ],
      });

      await expect(provider().getPrice('5:25')).rejects.toMatchObject({
        code: 'PROVIDER_INVALID_TOKEN',
      });
      expect(calls.filter((c) => c.url.includes('oauth/token'))).toHaveLength(2);
      expect(calls.filter((c) => c.url.includes('/products/5'))).toHaveLength(2);
    });

    it('never puts the client secret in the error it raises', async () => {
      stubFetch({
        'POST /oauth/token': { status: 401, body: { errorCode: 'CREDENTIAL_VS_ENVIRONMENT_MISMATCH' } },
      });

      const error = await provider()
        .getPrice('5:25')
        .catch((caught: unknown) => caught as ReloadlySupplierError);

      expect(error.code).toBe('PROVIDER_CREDENTIAL_VS_ENVIRONMENT_MISMATCH');
      expect(error.message).not.toContain('test-client-secret');
    });
  });

  describe('getPrice', () => {
    it('adds the flat and percentage sender fees', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': rangeProduct({ senderFee: 0.5, senderFeePercentage: 7.5 }),
      });

      /* 25 + 0.5 flat + 7.5% of 25 = 27.375 */
      await expect(provider().getPrice('5:25')).resolves.toMatchObject({
        cost: { amount: '27.375', currency: 'USD' },
      });
    });

    it('uses the venue’s own cross-currency table rather than repricing the card', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/3943': fixedProduct(),
      });

      /* 100 SAR is published at 26.79 USD; the flat sender fee is 1 USD. */
      await expect(provider().getPrice('3943:100')).resolves.toMatchObject({
        cost: { amount: '27.79', currency: 'USD' },
      });
    });

    it('quotes the undiscounted price, so the estimate never understates cost', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': rangeProduct({ discountPercentage: 10.0 }),
      });

      const price = await provider().getPrice('5:25');
      expect(price.cost.amount).toBe('25');
    });

    it('refuses a denomination the venue publishes no sender price for', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/3943': fixedProduct(),
      });

      await expect(provider().getPrice('3943:30')).rejects.toMatchObject({
        code: 'PRICE_UNAVAILABLE',
      });
    });
  });

  describe('checkAvailability', () => {
    it('accepts a published fixed denomination and refuses an unpublished one', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/3943': fixedProduct(),
      });
      const subject = provider();

      await expect(subject.checkAvailability('3943:100')).resolves.toMatchObject({
        availability: 'AVAILABLE',
      });
      await expect(subject.checkAvailability('3943:30')).resolves.toMatchObject({
        availability: 'UNAVAILABLE',
      });
    });

    it('honours the bounds of a range product', async () => {
      stubFetch({ 'POST /oauth/token': TOKEN_ROUTE, 'GET /products/5': rangeProduct() });
      const subject = provider();

      await expect(subject.checkAvailability('5:100')).resolves.toMatchObject({
        availability: 'AVAILABLE',
      });
      await expect(subject.checkAvailability('5:100.01')).resolves.toMatchObject({
        availability: 'UNAVAILABLE',
      });
    });

    it('treats a retired product as unavailable', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': rangeProduct({ status: 'DISCONTINUED' }),
      });

      await expect(provider().checkAvailability('5:25')).resolves.toMatchObject({
        availability: 'UNAVAILABLE',
      });
    });

    it('reports an unreachable venue as UNKNOWN, never as sold out', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': { status: 503, body: {} },
      });

      /* UNAVAILABLE here would quietly reroute the order to a costlier supplier. */
      await expect(provider().checkAvailability('5:25')).resolves.toMatchObject({
        availability: 'UNKNOWN',
      });
    });

    it('distinguishes a deleted product from an outage', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products/5': { status: 404, body: { errorCode: 'PRODUCT_NOT_FOUND' } },
      });

      await expect(provider().checkAvailability('5:25')).resolves.toMatchObject({
        availability: 'UNAVAILABLE',
      });
    });
  });

  describe('purchase', () => {
    const REQUEST = { providerSku: '5:25', quantity: 1, idempotencyKey: 'order-1' } as const;

    it('buys the card and returns its code and PIN', async () => {
      const { find } = stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 200, body: transaction() },
        'GET /orders/transactions/4242/cards': { body: [{ cardNumber: 'ABC-123', pinCode: '9911' }] },
      });

      const result = await provider().purchase(REQUEST);

      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        providerReference: '4242',
        asset: { assetType: 'CODE_PIN', code: 'ABC-123', pin: '9911' },
      });
      expect(find('POST /orders')?.body).toEqual({
        productId: 5,
        countryCode: 'US',
        quantity: 1,
        unitPrice: 25,
        customIdentifier: 'order-1',
        senderName: 'Barat Pay',
        recipientEmail: 'vault@baratpay.example',
      });
    });

    it('reports the amount actually charged: amount plus fee less discount', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 200, body: transaction() },
        'GET /orders/transactions/4242/cards': { body: [{ cardNumber: 'ABC-123' }] },
      });

      /* 26.79 + 1.00 - 0.50, carried through fixed point rather than doubles. */
      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        cost: { amount: '27.29', currency: 'USD' },
        asset: { assetType: 'CODE', code: 'ABC-123' },
      });
    });

    it('addresses the order to our own mailbox, never to the customer', async () => {
      const { find } = stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 200, body: transaction() },
        'GET /orders/transactions/4242/cards': { body: [{ cardNumber: 'ABC-123' }] },
      });

      await provider().purchase({ ...REQUEST, recipientEmail: 'customer@example.com' });

      /* Reloadly mails the recipient directly, and that mail names the supplier. */
      const body = find('POST /orders')?.body as Record<string, unknown>;
      expect(body['recipientEmail']).toBe('vault@baratpay.example');
      expect(JSON.stringify(body)).not.toContain('customer@example.com');
    });

    it('adopts an order a previous attempt already placed instead of buying twice', async () => {
      const { calls } = stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([transaction()]),
        'GET /orders/transactions/4242/cards': { body: [{ cardNumber: 'ABC-123' }] },
      });

      const result = await provider().purchase(REQUEST);

      expect(result).toMatchObject({ status: 'SUCCEEDED', providerReference: '4242' });
      expect(calls.some((c) => c.url.includes('/orders') && c.method === 'POST')).toBe(false);
    });

    it('ignores a ledger row that does not carry our identifier', async () => {
      const { find } = stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        /* What an unfiltered ledger would look like if the venue dropped the query. */
        'GET /reports/transactions': page([transaction({ customIdentifier: 'someone-else' })]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 200, body: transaction() },
        'GET /orders/transactions/4242/cards': { body: [{ cardNumber: 'ABC-123' }] },
      });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({ status: 'SUCCEEDED' });
      expect(find('POST /orders')).toBeDefined();
    });

    it('refuses to add a third order when two already share the key', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([transaction(), transaction({ transactionId: 4243 })]),
      });

      await expect(provider().purchase(REQUEST)).rejects.toMatchObject({
        code: 'DUPLICATE_CUSTOM_IDENTIFIER',
      });
    });

    it('refuses a multi-unit order before spending anything', async () => {
      const { calls } = stubFetch({});

      await expect(provider().purchase({ ...REQUEST, quantity: 2 })).resolves.toEqual({
        status: 'FAILED',
        failureCode: 'QUANTITY_NOT_SUPPORTED',
      });
      expect(calls).toHaveLength(0);
    });

    it('refuses an idempotency key the venue cannot store', async () => {
      const { calls } = stubFetch({});

      await expect(
        provider().purchase({ ...REQUEST, idempotencyKey: 'x'.repeat(256) }),
      ).resolves.toMatchObject({ failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' });
      expect(calls).toHaveLength(0);
    });

    it('waits rather than abandoning a card that is paid for but not yet issued', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 200, body: transaction() },
        'GET /orders/transactions/4242/cards': { status: 404, body: {} },
      });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'PENDING',
        providerReference: '4242',
      });
    });

    it('escalates when the venue hands back more cards than we ordered', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 200, body: transaction() },
        'GET /orders/transactions/4242/cards': {
          body: [{ cardNumber: 'A' }, { cardNumber: 'B' }],
        },
      });

      /* Delivering the first would strand the second, paid for and unsent. */
      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'UNEXPECTED_CARD_COUNT',
      });
    });

    it('never reads an unrecognised transaction status as success', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 200, body: transaction({ status: 'ON_HOLD' }) },
      });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'UNKNOWN',
        providerReference: '4242',
      });
    });

    it('maps a refund to FAILED and a stated refusal to its provider code', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': [
          { status: 200, body: transaction({ status: 'REFUNDED' }) },
          { status: 400, body: { errorCode: 'INSUFFICIENT_BALANCE' } },
        ],
      });
      const subject = provider();

      await expect(subject.purchase(REQUEST)).resolves.toMatchObject({ status: 'FAILED' });
      await expect(subject.purchase(REQUEST)).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'PROVIDER_INSUFFICIENT_BALANCE',
      });
    });

    it('treats a server error on the order as UNKNOWN, because it may have landed', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': rangeProduct(),
        'POST /orders': { status: 502, text: '<html>gateway</html>' },
      });

      await expect(provider().purchase(REQUEST)).resolves.toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'PROVIDER_UNAVAILABLE',
      });
    });

    it('reports a preparation failure as FAILED, since no order was placed', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': page([]),
        'GET /products/5': { status: 404, body: { errorCode: 'PRODUCT_NOT_FOUND' } },
      });

      /* The adoption lookup already proved nothing exists under this key. */
      await expect(provider().purchase(REQUEST)).resolves.toEqual({
        status: 'FAILED',
        failureCode: 'PRODUCT_NOT_FOUND',
      });
    });

    it('lets a lookup outage surface as a throw, so the caller escalates it', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions': { status: 503, body: {} },
      });

      /* We cannot see whether an earlier attempt bought a card; a human must. */
      await expect(provider().purchase(REQUEST)).rejects.toMatchObject({
        code: 'IDEMPOTENCY_LOOKUP_FAILED',
      });
    });
  });

  describe('getPurchaseStatus', () => {
    it('resolves a completed transaction into its asset', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions/4242': { body: transaction() },
        'GET /orders/transactions/4242/cards': { body: [{ cardNumber: 'ABC-123', pinCode: '11' }] },
      });

      await expect(provider().getPurchaseStatus('4242')).resolves.toMatchObject({
        status: 'SUCCEEDED',
        asset: { assetType: 'CODE_PIN', code: 'ABC-123', pin: '11' },
      });
    });

    it('does not read a missing transaction as proof that nothing was bought', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /reports/transactions/4242': { status: 404, body: {} },
      });

      await expect(provider().getPurchaseStatus('4242')).resolves.toMatchObject({
        status: 'UNKNOWN',
        failureCode: 'TRANSACTION_NOT_FOUND',
      });
    });

    it('rejects a reference that is not a transaction id without calling out', async () => {
      const { calls } = stubFetch({});

      await expect(provider().getPurchaseStatus('../products/5')).resolves.toMatchObject({
        failureCode: 'INVALID_PROVIDER_REFERENCE',
      });
      expect(calls).toHaveLength(0);
    });
  });

  describe('getCatalog', () => {
    it('lists one entry per purchasable denomination', async () => {
      stubFetch({
        'POST /oauth/token': TOKEN_ROUTE,
        'GET /products': page([fixedProduct().body, rangeProduct().body]),
      });

      const items = await provider().getCatalog();

      expect(items.map((i) => i.providerSku)).toEqual(['3943:20', '3943:100', '5:5']);
      expect(items[0]).toMatchObject({
        name: 'Google Play KSA',
        brand: 'Google play',
        region: 'SA',
        assetType: 'CODE',
        faceValue: { amount: '20', currency: 'SAR' },
      });
      /* A range has no single face value, so the bounds are stated in the name. */
      expect(items[2]?.name).toBe('Amazon US (5–100 USD)');
    });
  });

  describe('construction', () => {
    it('refuses to start without a deliverable mailbox', () => {
      expect(() => provider({ recipientEmail: 'not-an-email' })).toThrow(RangeError);
      expect(() => provider({ clientSecret: '  ' })).toThrow(RangeError);
    });
  });
});
