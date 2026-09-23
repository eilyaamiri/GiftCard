import { afterEach, describe, expect, it, vi } from 'vitest';

import { FxProviderError } from '../fx-rate-provider.interface';
import { FrankfurterCrossRateProvider } from './frankfurter-cross-rate.provider';

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(payload: unknown, ok = true): Response {
  return { ok, json: async () => payload } as unknown as Response;
}

function stubFetch(response: Response | (() => never)): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => (typeof response === 'function' ? response() : response));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

/** Verbatim from api.frankfurter.dev on 2026-09-23, mixed dates included. */
const LIVE_SAMPLE = [
  { date: '2026-09-23', base: 'USD', quote: 'AED', rate: 3.6725 },
  { date: '2026-09-22', base: 'USD', quote: 'ANG', rate: 1.79 },
  { date: '2026-09-23', base: 'USD', quote: 'GBP', rate: 0.74756 },
  { date: '2026-09-23', base: 'USD', quote: 'JPY', rate: 157.39 },
];

async function tableOf(payload: unknown): Promise<Record<string, string>> {
  stubFetch(jsonResponse(payload));
  const entries = await new FrankfurterCrossRateProvider().getUsdTable();
  return Object.fromEntries(entries.map((entry) => [entry.currency, entry.unitsPerUsd]));
}

describe('FrankfurterCrossRateProvider', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('asks for the whole table in one dollar-based request', async () => {
    const spy = stubFetch(jsonResponse(LIVE_SAMPLE));

    await new FrankfurterCrossRateProvider().getUsdTable();

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.frankfurter.dev/v2/rates?base=USD');
    expect(init.method).toBe('GET');
    /* One call per quote would be ~170 requests for one page of search results. */
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps the published digits rather than a float', async () => {
    const table = await tableOf(LIVE_SAMPLE);

    /* Strings, and the exact digits the endpoint sent — not 0.7475600000000001. */
    expect(table['GBP']).toBe('0.74756');
    expect(table['JPY']).toBe('157.39');
    expect(table['AED']).toBe('3.6725');
  });

  it('keeps the rate in the direction it was published', async () => {
    const [entry] = await (async () => {
      stubFetch(jsonResponse([LIVE_SAMPLE[2]]));
      return new FrankfurterCrossRateProvider().getUsdTable();
    })();

    /* One dollar buys 0.74756 pounds. Inverting here would quantize away
     * precision that the caller's Decimal division keeps. */
    expect(entry?.unitsPerUsd).toBe('0.74756');
    expect(Number(entry?.unitsPerUsd)).toBeLessThan(1);
  });

  it('dates each currency separately, because the feed does', async () => {
    stubFetch(jsonResponse(LIVE_SAMPLE));

    const entries = await new FrankfurterCrossRateProvider().getUsdTable();

    /* A quiet currency keeps yesterday's print while the rest move on. */
    expect(entries.find((entry) => entry.currency === 'ANG')?.publishedOn).toBe('2026-09-22');
    expect(entries.find((entry) => entry.currency === 'GBP')?.publishedOn).toBe('2026-09-23');
  });

  it('stamps the receive time and reports the source as a category', async () => {
    const clock = () => new Date('2026-09-23T09:00:00.000Z');
    stubFetch(jsonResponse([LIVE_SAMPLE[2]]));

    const [entry] = await new FrankfurterCrossRateProvider({ clock }).getUsdTable();

    expect(entry?.receivedAt.toISOString()).toBe('2026-09-23T09:00:00.000Z');
    expect(entry?.source).toBe('API');
  });

  it('rejects a non-200, including the documented 503', async () => {
    stubFetch(jsonResponse([], false));

    await expect(new FrankfurterCrossRateProvider().getUsdTable()).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    });
  });

  it('reports a timeout as a timeout, not as a generic network fault', async () => {
    stubFetch(() => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(new FrankfurterCrossRateProvider().getUsdTable()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it.each([
    ['an empty table', []],
    ['a non-array body', { GBP: 0.74756 }],
    ['a foreign base', [{ date: '2026-09-23', base: 'EUR', quote: 'GBP', rate: 0.87 }]],
    ['a malformed currency', [{ date: '2026-09-23', base: 'USD', quote: 'gb', rate: 0.87 }]],
    ['a malformed date', [{ date: '23/09/2026', base: 'USD', quote: 'GBP', rate: 0.87 }]],
    ['a zero rate', [{ date: '2026-09-23', base: 'USD', quote: 'GBP', rate: 0 }]],
    ['a negative rate', [{ date: '2026-09-23', base: 'USD', quote: 'GBP', rate: -0.87 }]],
    ['a string rate', [{ date: '2026-09-23', base: 'USD', quote: 'GBP', rate: '0.87' }]],
    ['a rate below decimal notation', [{ date: '2026-09-23', base: 'USD', quote: 'GBP', rate: 1e-9 }]],
  ])('refuses %s', async (_label, payload) => {
    stubFetch(jsonResponse(payload));

    const error = await new FrankfurterCrossRateProvider()
      .getUsdTable()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FxProviderError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE', provider: 'frankfurter' });
  });

  it('keeps the first of a repeated currency rather than the last', async () => {
    const table = await tableOf([
      { date: '2026-09-23', base: 'USD', quote: 'GBP', rate: 0.74756 },
      { date: '2026-09-23', base: 'USD', quote: 'GBP', rate: 9.9 },
    ]);

    /* A repeated currency is a malformed page, not a correction. */
    expect(table['GBP']).toBe('0.74756');
  });

  it('never carries a URL or body into the error it raises', async () => {
    stubFetch(jsonResponse([], false));

    const error = await new FrankfurterCrossRateProvider({ baseUrl: 'https://secret.example/v2' })
      .getUsdTable()
      .catch((caught: unknown) => caught);

    expect(String((error as Error).message)).not.toContain('secret.example');
  });
});
