import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FxProviderError } from '../fx-rate-provider.interface';
import { PrimaryFxRateProvider } from './primary-fx-rate.provider';
import { SecondaryFxRateProvider } from './secondary-fx-rate.provider';

const ORIGINAL_FETCH = globalThis.fetch;

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe('HTTP FX providers', () => {
  beforeEach(() => {
    delete process.env['FX_PRIMARY_URL'];
    delete process.env['FX_SECONDARY_URL'];
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('throws NOT_CONFIGURED rather than inventing an endpoint', async () => {
    const primary = new PrimaryFxRateProvider();
    const secondary = new SecondaryFxRateProvider();

    await expect(primary.getRate('USD_IRR')).rejects.toMatchObject({
      name: 'FxProviderError',
      code: 'NOT_CONFIGURED',
      provider: 'primary',
    });
    await expect(secondary.getRate('USD_IRR')).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
      provider: 'secondary',
    });
  });

  it('reports unhealthy with NOT_CONFIGURED and never calls the network', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const health = await new PrimaryFxRateProvider().getHealth();

    expect(health).toMatchObject({ isHealthy: false, lastErrorCode: 'NOT_CONFIGURED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads its endpoint from the environment when none is passed', async () => {
    process.env['FX_PRIMARY_URL'] = 'https://rates.example.test/usd';
    const fetchSpy = vi.fn(async (url: URL) => {
      expect(url.searchParams.get('pair')).toBe('USD_IRR');
      return jsonResponse({
        buyRate: '1921000',
        sellRate: '1919000',
        midRate: '1920000',
        source: 'API',
        effectiveAt: '2026-08-30T10:00:00.000Z',
        expiresAt: null,
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const rate = await new PrimaryFxRateProvider().getRate('USD_IRR');

    expect(rate.midRate).toBe('1920000');
    expect(rate.source).toBe('API');
    expect(rate.effectiveAt.toISOString()).toBe('2026-08-30T10:00:00.000Z');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('rejects a payload whose rates are numbers or malformed strings', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ buyRate: 1921000, sellRate: '1919000', midRate: '1920000' })) as never;

    const provider = new PrimaryFxRateProvider({ endpoint: 'https://rates.example.test/usd' });

    await expect(provider.getRate('USD_IRR')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('normalises a transport failure without leaking the cause message', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:443 apikey=secret');
    }) as never;

    const provider = new PrimaryFxRateProvider({ endpoint: 'https://rates.example.test/usd' });

    const error = await provider.getRate('USD_IRR').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FxProviderError);
    expect((error as FxProviderError).code).toBe('NETWORK_ERROR');
    expect((error as Error).message).not.toContain('secret');
    expect((error as Error).message).not.toContain('10.0.0.1');

    await provider.getRate('USD_IRR').catch(() => undefined);
    await expect(provider.getHealth()).resolves.toMatchObject({
      isHealthy: false,
      lastErrorCode: 'NETWORK_ERROR',
    });
  });

  it('treats a non-2xx response as HTTP_ERROR', async () => {
    globalThis.fetch = (async () => jsonResponse({}, false)) as never;

    const provider = new SecondaryFxRateProvider({ endpoint: 'https://rates.example.test/usd' });

    await expect(provider.getRate('USD_IRR')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      provider: 'secondary',
    });
  });
});
