import { Logger } from '@nestjs/common';
import type { FxPair, FxRateSnapshot } from '@barat/contracts';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StaleFxRateError, type FxAggregatorService } from './fx-aggregator.service';
import { FxRateRefresherService } from './fx-rate-refresher.service';
import type { FxRefreshConfig } from './fx.types';

const BASE_CONFIG: FxRefreshConfig = {
  enabled: true,
  intervalMs: 60_000,
  staleThresholdMs: 900_000,
  pairs: ['USD_IRR'],
};

function snapshot(pair: FxPair): FxRateSnapshot {
  return {
    id: `fx-${pair}`,
    pair,
    buyRate: '998000',
    sellRate: '1002000',
    midRate: '1000000',
    provider: 'primary',
    source: 'nobitex:usdt-rls',
    receivedAt: '2026-09-02T12:00:00.000Z',
    effectiveAt: '2026-09-02T12:00:00.000Z',
    expiresAt: null,
    isManualOverride: false,
    overrideReason: null,
    ageSeconds: 0,
    isStale: false,
  } as FxRateSnapshot;
}

/** An aggregator stub that records what the poller asked for. */
function aggregatorStub(
  getRateSnapshot: (pair: FxPair) => Promise<FxRateSnapshot>,
): { service: FxAggregatorService; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(getRateSnapshot);
  return { service: { getRateSnapshot: spy } as unknown as FxAggregatorService, spy };
}

function refresher(
  overrides: Partial<FxRefreshConfig>,
  getRateSnapshot: (pair: FxPair) => Promise<FxRateSnapshot> = async (pair) => snapshot(pair),
) {
  const { service, spy } = aggregatorStub(getRateSnapshot);
  return {
    poller: new FxRateRefresherService(service, { ...BASE_CONFIG, ...overrides }),
    spy,
  };
}

describe('FxRateRefresherService', () => {
  beforeAll(() => {
    /* The poller logs on every cycle; tests assert on behaviour, not output. */
    Logger.overrideLogger(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('configuration', () => {
    it('refuses to poll slower than the rate goes stale', () => {
      expect(
        () => refresher({ intervalMs: 900_001, staleThresholdMs: 900_000 }),
      ).toThrow(RangeError);
    });

    it('accepts an interval exactly at the stale window', () => {
      expect(() => refresher({ intervalMs: 900_000, staleThresholdMs: 900_000 })).not.toThrow();
    });

    it('refuses an interval below the ten-second floor', () => {
      expect(() => refresher({ intervalMs: 9_999 })).toThrow(RangeError);
      expect(() => refresher({ intervalMs: 60_500 })).not.toThrow();
    });

    it('refuses to run with no pair to poll', () => {
      expect(() => refresher({ pairs: [] })).toThrow(RangeError);
    });
  });

  describe('a polling cycle', () => {
    it('records a fresh observation for every configured pair', async () => {
      const { poller, spy } = refresher({});

      const outcome = await poller.refreshOnce();

      expect(outcome).toEqual({ refreshed: ['USD_IRR'], failed: [], skipped: false });
      expect(spy).toHaveBeenCalledWith('USD_IRR');
    });

    it('keeps polling the remaining pairs when one cannot be priced', async () => {
      const asked: FxPair[] = [];
      const { poller } = refresher(
        /* A second pair is used here only to prove failures are isolated. */
        { pairs: ['USD_IRR', 'EUR_IRR' as FxPair] },
        async (pair) => {
          asked.push(pair);
          if (pair === 'USD_IRR') {
            throw new StaleFxRateError(1_200);
          }
          return snapshot(pair);
        },
      );

      const outcome = await poller.refreshOnce();

      expect(asked).toEqual(['USD_IRR', 'EUR_IRR']);
      expect(outcome.failed).toEqual(['USD_IRR']);
      expect(outcome.refreshed).toEqual(['EUR_IRR']);
    });

    it('stands down instead of stacking cycles on a slow provider', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { poller, spy } = refresher({}, async (pair) => {
        await gate;
        return snapshot(pair);
      });

      const first = poller.refreshOnce();
      const second = await poller.refreshOnce();

      expect(second).toEqual({ refreshed: [], failed: [], skipped: true });
      release();
      await expect(first).resolves.toMatchObject({ refreshed: ['USD_IRR'] });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('releases the overlap guard even when the aggregator throws', async () => {
      const { poller, spy } = refresher({}, async () => {
        throw new StaleFxRateError(1_200);
      });

      await poller.refreshOnce();
      await poller.refreshOnce();

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('counts consecutive failed cycles and clears the count on recovery', async () => {
      let broken = true;
      const { poller } = refresher({}, async (pair) => {
        if (broken) {
          throw new StaleFxRateError(1_200);
        }
        return snapshot(pair);
      });

      await poller.refreshOnce();
      await poller.refreshOnce();
      expect(poller.status.consecutiveFailures).toBe(2);

      broken = false;
      await poller.refreshOnce();
      expect(poller.status.consecutiveFailures).toBe(0);
    });
  });

  describe('the schedule', () => {
    it('polls once at boot and then on every interval', async () => {
      vi.useFakeTimers();
      const { poller, spy } = refresher({ intervalMs: 60_000 });

      poller.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(0);
      expect(spy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(180_000);
      expect(spy).toHaveBeenCalledTimes(4);

      poller.onApplicationShutdown();
    });

    it('keeps the schedule alive across a provider outage', async () => {
      vi.useFakeTimers();
      const { poller, spy } = refresher({ intervalMs: 60_000 }, async () => {
        throw new StaleFxRateError(1_200);
      });

      poller.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(120_000);

      /* Three attempts: the boot cycle plus one per interval, none swallowed. */
      expect(spy).toHaveBeenCalledTimes(3);
      expect(poller.status.consecutiveFailures).toBe(3);

      poller.onApplicationShutdown();
    });

    it('stops polling on shutdown', async () => {
      vi.useFakeTimers();
      const { poller, spy } = refresher({ intervalMs: 60_000 });

      poller.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(60_000);
      const beforeShutdown = spy.mock.calls.length;

      poller.onApplicationShutdown();
      await vi.advanceTimersByTimeAsync(600_000);

      expect(spy).toHaveBeenCalledTimes(beforeShutdown);
    });

    it('never polls when auto-refresh is switched off', async () => {
      vi.useFakeTimers();
      const { poller, spy } = refresher({ enabled: false });

      poller.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(600_000);

      expect(spy).not.toHaveBeenCalled();
      expect(poller.status.enabled).toBe(false);
    });
  });
});
