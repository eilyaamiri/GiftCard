import { describe, expect, it } from 'vitest';

import { FxProviderError } from '../fx-rate-provider.interface';
import { MockFxRateProvider } from './mock-fx-rate.provider';

const FIXED_NOW = new Date('2026-08-30T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

describe('MockFxRateProvider', () => {
  it('defaults to 1,920,000 IRR (192,000 toman) per USD', async () => {
    const provider = new MockFxRateProvider({ jitterSequenceBps: [0], clock });

    const rate = await provider.getRate('USD_IRR');

    expect(rate.midRate).toBe('1920000');
    expect(rate.pair).toBe('USD_IRR');
    expect(rate.effectiveAt.toISOString()).toBe(FIXED_NOW.toISOString());
  });

  it('is deterministic: two instances produce the identical sequence', async () => {
    const first = new MockFxRateProvider({ clock });
    const second = new MockFxRateProvider({ clock });

    const a = [await first.getRate('USD_IRR'), await first.getRate('USD_IRR')];
    const b = [await second.getRate('USD_IRR'), await second.getRate('USD_IRR')];

    expect(a.map((r) => r.midRate)).toEqual(b.map((r) => r.midRate));
    expect(a[0]?.midRate).not.toBe(a[1]?.midRate);
  });

  it('honours a configured base rate and produces a buy above the sell', async () => {
    const provider = new MockFxRateProvider({
      baseRate: '2000000',
      jitterSequenceBps: [0],
      buySellHalfSpreadBps: 10,
      clock,
    });

    const rate = await provider.getRate('USD_IRR');

    expect(rate.midRate).toBe('2000000');
    expect(rate.buyRate).toBe('2002000');
    expect(rate.sellRate).toBe('1998000');
  });

  it('can be forced unhealthy and then throws instead of guessing', async () => {
    const provider = new MockFxRateProvider({ clock });
    provider.setHealthy(false);

    await expect(provider.getRate('USD_IRR')).rejects.toBeInstanceOf(FxProviderError);
    await expect(provider.getHealth()).resolves.toMatchObject({
      isHealthy: false,
      lastErrorCode: 'FORCED_UNHEALTHY',
    });
  });

  it('can be forced stale by backdating effectiveAt while staying healthy', async () => {
    const provider = new MockFxRateProvider({ clock });
    provider.setStale(true, 3_600);

    const rate = await provider.getRate('USD_IRR');

    expect(await provider.getHealth()).toMatchObject({ isHealthy: true });
    expect(FIXED_NOW.getTime() - rate.effectiveAt.getTime()).toBe(3_600_000);
    expect(rate.receivedAt.toISOString()).toBe(FIXED_NOW.toISOString());
  });

  it('rejects a base rate that is not a clean fixed-point decimal', () => {
    expect(() => new MockFxRateProvider({ baseRate: '1e6' })).toThrow(TypeError);
    expect(() => new MockFxRateProvider({ baseRate: '-100' })).toThrow(TypeError);
    expect(() => new MockFxRateProvider({ baseRate: '0' })).toThrow(RangeError);
  });
});
