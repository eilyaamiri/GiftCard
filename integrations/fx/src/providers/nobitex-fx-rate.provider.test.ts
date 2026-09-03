import { afterEach, describe, expect, it, vi } from 'vitest';

import { NobitexFxRateProvider } from './nobitex-fx-rate.provider';

const ORIGINAL_FETCH = globalThis.fetch;

/** A response in Nobitex's documented shape: ten fraction digits, rial-quoted. */
function statsResponse(
  overrides: Record<string, unknown> = {},
  pairKey = 'usdt-rls',
  ok = true,
): Response {
  return {
    ok,
    json: async () => ({
      status: 'ok',
      stats: {
        [pairKey]: {
          isClosed: false,
          bestSell: '1002000.0000000000',
          bestBuy: '998000.0000000000',
          latest: '1000500.0000000000',
          dayLow: '990000.0000000000',
          dayHigh: '1010000.0000000000',
          ...overrides,
        },
      },
    }),
  } as unknown as Response;
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => response);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe('NobitexFxRateProvider', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('asks for the rial market, never the toman one', async () => {
    const spy = stubFetch(statsResponse());

    await new NobitexFxRateProvider().getRate('USD_IRR');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    /* `api.nobitex.ir` is NXDOMAIN; the venue answers on apiv2. */
    expect(url).toBe('https://apiv2.nobitex.ir/market/stats');
    expect(init.method).toBe('POST');
    /* `irt` returns rial values under a toman key — a silent tenfold error. */
    expect(JSON.parse(String(init.body))).toEqual({ srcCurrency: 'usdt', dstCurrency: 'rls' });
  });

  it('parses a payload recorded from the live venue', async () => {
    /* Verbatim from apiv2.nobitex.ir on 2026-09-03, extra fields included. */
    stubFetch({
      ok: true,
      json: async () => ({
        status: 'ok',
        stats: {
          'usdt-rls': {
            isClosed: false,
            bestSell: '2207900',
            bestBuy: '2207890',
            volumeSrc: '6914929.6682209518',
            volumeDst: '15211516204443.73154012',
            latest: '2207890',
            mark: '2207900',
            dayLow: '2180010',
            dayHigh: '2224580',
            dayOpen: '2188480',
            dayClose: '2207890',
            dayChange: '0.89',
          },
        },
        global: { binance: {} },
      }),
    } as unknown as Response);

    const rate = await new NobitexFxRateProvider().getRate('USD_IRR');

    expect(rate.buyRate).toBe('2207890');
    expect(rate.sellRate).toBe('2207900');
    /* Half-up on the ten-rial spread, so the mid lands above the midpoint. */
    expect(rate.midRate).toBe('2207895');
  });

  it('sends no credential: the market endpoint is public', async () => {
    const spy = stubFetch(statsResponse());

    await new NobitexFxRateProvider().getRate('USD_IRR');

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const headerNames = Object.keys(init.headers as Record<string, string>).map((name) =>
      name.toLowerCase(),
    );
    expect(headerNames).not.toContain('authorization');
    expect(headerNames).not.toContain('x-api-key');
  });

  it('mids the two best prices and keeps buy <= mid <= sell', async () => {
    stubFetch(statsResponse());

    const rate = await new NobitexFxRateProvider().getRate('USD_IRR');

    expect(rate.buyRate).toBe('998000');
    expect(rate.sellRate).toBe('1002000');
    expect(rate.midRate).toBe('1000000');
    expect(rate.pair).toBe('USD_IRR');
    /* The category the FxRate schema documents; the venue rides on the name. */
    expect(rate.source).toBe('API');
  });

  it('gives the same mid whichever way Nobitex labels bid and ask', async () => {
    stubFetch(statsResponse({ bestBuy: '1002000.0000000000', bestSell: '998000.0000000000' }));

    const rate = await new NobitexFxRateProvider().getRate('USD_IRR');

    expect(rate.midRate).toBe('1000000');
    expect(rate.buyRate).toBe('998000');
    expect(rate.sellRate).toBe('1002000');
  });

  it('keeps sub-rial precision instead of rounding through a float', async () => {
    stubFetch(statsResponse({ bestBuy: '1000000.1234560000', bestSell: '1000000.1234580000' }));

    const rate = await new NobitexFxRateProvider().getRate('USD_IRR');

    expect(rate.midRate).toBe('1000000.123457');
  });

  it('refuses to price a halted market', async () => {
    stubFetch(statsResponse({ isClosed: true }));

    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      name: 'FxProviderError',
      code: 'MARKET_CLOSED',
      provider: 'nobitex',
    });
  });

  it('rejects an implausible spread rather than pricing from a broken book', async () => {
    stubFetch(statsResponse({ bestBuy: '100000.0000000000', bestSell: '1000000.0000000000' }));

    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a failed payload that still arrives as HTTP 200', async () => {
    stubFetch({
      ok: true,
      json: async () => ({ status: 'failed', code: 'InvalidMarketPair' }),
    } as unknown as Response);

    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a missing or non-numeric price instead of substituting one', async () => {
    stubFetch(statsResponse({ bestBuy: undefined }));
    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    stubFetch(statsResponse({ bestSell: 'not-a-number' }));
    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    stubFetch(statsResponse({ bestBuy: '0.0000000000' }));
    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a response for a different market', async () => {
    stubFetch(statsResponse({}, 'btc-rls'));

    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('normalizes an HTTP failure and a network failure without leaking the cause', async () => {
    stubFetch(statsResponse({}, 'usdt-rls', false));
    await expect(new NobitexFxRateProvider().getRate('USD_IRR')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    });

    globalThis.fetch = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    const error = await new NobitexFxRateProvider()
      .getRate('USD_IRR')
      .catch((caught: unknown) => caught as Error);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR' });
    expect(error.message).not.toContain('socket hang up');
  });

  it('tracks health from the same observation', async () => {
    stubFetch(statsResponse());
    const provider = new NobitexFxRateProvider();

    await expect(provider.getHealth()).resolves.toMatchObject({
      provider: 'nobitex',
      isHealthy: true,
      consecutiveFailures: 0,
    });

    stubFetch(statsResponse({ isClosed: true }));
    await expect(provider.getHealth()).resolves.toMatchObject({
      isHealthy: false,
      lastErrorCode: 'MARKET_CLOSED',
      consecutiveFailures: 1,
    });
  });

  it('carries the position and venue so failover reporting stays readable', async () => {
    stubFetch(statsResponse());

    await expect(
      new NobitexFxRateProvider({ name: 'primary-nobitex' }).getHealth(),
    ).resolves.toMatchObject({ provider: 'primary-nobitex' });

    stubFetch(statsResponse({ isClosed: true }));
    await expect(
      new NobitexFxRateProvider({ name: 'primary-nobitex' }).getRate('USD_IRR'),
    ).rejects.toMatchObject({ provider: 'primary-nobitex', code: 'MARKET_CLOSED' });
  });
});
