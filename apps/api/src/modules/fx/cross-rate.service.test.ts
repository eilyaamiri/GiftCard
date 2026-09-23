import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { CrossRateProvider, RawCrossRate } from '@barat/fx';

import { CrossRateService } from './cross-rate.service';
import { CrossRateUnavailableError, type CrossRateConfig } from './cross-rate.types';

const FETCHED_AT = new Date('2026-09-23T09:00:00.000Z');

function entry(currency: string, unitsPerUsd: string): RawCrossRate {
  return {
    currency,
    unitsPerUsd,
    publishedOn: '2026-09-23',
    source: 'API',
    receivedAt: FETCHED_AT,
  };
}

const TABLE: readonly RawCrossRate[] = [
  entry('GBP', '0.74756'),
  entry('EUR', '0.84896'),
  entry('JPY', '157.39'),
];

/** A clock the test moves by hand; nothing here should depend on wall time. */
function clock(start = FETCHED_AT): { now: () => Date; advance: (seconds: number) => void } {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (seconds: number) => {
      current += seconds * 1_000;
    },
  };
}

function build(
  getUsdTable: CrossRateProvider['getUsdTable'],
  overrides: Partial<CrossRateConfig> = {},
): { service: CrossRateService; calls: () => number } {
  const spy = vi.fn(getUsdTable);
  const provider: CrossRateProvider = { name: 'frankfurter', getUsdTable: spy };
  const service = new CrossRateService(provider, {
    refreshIntervalSeconds: 3_600,
    staleThresholdSeconds: 21_600,
    warmOnStart: false,
    now: () => FETCHED_AT,
    ...overrides,
  });
  return { service, calls: () => spy.mock.calls.length };
}

describe('CrossRateService', () => {
  beforeEach(() => {
    /* The service logs a warning when it keeps serving a stale table. That is
     * behaviour worth having and noise worth suppressing. */
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('answers USD from identity without touching the feed', async () => {
    const { service, calls } = build(async () => TABLE);

    const snapshot = await service.getSnapshot('USD');

    expect(snapshot).toMatchObject({ unitsPerUsd: '1', isIdentity: true, isStale: false });
    /* The dollar-priced majority of the catalog must not become dependent on a
     * foreign reference feed being up. */
    expect(calls()).toBe(0);
  });

  it('serves the published rate in the published direction', async () => {
    const { service } = build(async () => TABLE);

    const snapshot = await service.getSnapshot('GBP');

    expect(snapshot.unitsPerUsd).toBe('0.74756');
    expect(snapshot).toMatchObject({ provider: 'frankfurter', publishedOn: '2026-09-23' });
  });

  it('fills every currency from one fetch', async () => {
    const { service, calls } = build(async () => TABLE);

    await service.getSnapshot('GBP');
    await service.getSnapshot('EUR');
    await service.getSnapshot('JPY');

    expect(calls()).toBe(1);
  });

  it('collapses a burst on a cold table into one request', async () => {
    const { service, calls } = build(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return TABLE;
    });

    await Promise.all([
      service.getSnapshot('GBP'),
      service.getSnapshot('EUR'),
      service.getSnapshot('JPY'),
    ]);

    expect(calls()).toBe(1);
  });

  it('normalizes the currency it is asked for', async () => {
    const { service } = build(async () => TABLE);

    await expect(service.getSnapshot(' gbp ')).resolves.toMatchObject({ currency: 'GBP' });
  });

  it('re-fetches once the refresh interval has passed', async () => {
    const time = clock();
    const { service, calls } = build(async () => TABLE, {
      now: time.now,
      refreshIntervalSeconds: 3_600,
    });

    await service.getSnapshot('GBP');
    time.advance(3_599);
    await service.getSnapshot('GBP');
    expect(calls()).toBe(1);

    time.advance(2);
    await service.getSnapshot('GBP');
    expect(calls()).toBe(2);
  });

  it('keeps serving the last good table when a refresh fails', async () => {
    const time = clock();
    let healthy = true;
    const { service } = build(
      async () => {
        if (!healthy) throw new Error('feed down');
        return TABLE;
      },
      { now: time.now },
    );

    await service.getSnapshot('GBP');
    healthy = false;
    time.advance(3_601);

    /* A hiccup must not take non-dollar quoting down the instant it happens. */
    await expect(service.getSnapshot('GBP')).resolves.toMatchObject({ unitsPerUsd: '0.74756' });
  });

  it('ages the stale table out rather than serving it forever', async () => {
    const time = clock();
    let healthy = true;
    const { service } = build(
      async () => {
        if (!healthy) throw new Error('feed down');
        return TABLE;
      },
      { now: time.now, staleThresholdSeconds: 21_600 },
    );

    await service.getSnapshot('GBP');
    healthy = false;
    time.advance(21_601);

    /* Still answered — refusing is the caller's policy, not this service's —
     * but flagged, exactly as a stale rial rate is. */
    await expect(service.getSnapshot('GBP')).resolves.toMatchObject({ isStale: true });
  });

  it('does not hammer a feed that is down', async () => {
    const time = clock();
    const { service, calls } = build(
      async () => {
        throw new Error('feed down');
      },
      { now: time.now, refreshIntervalSeconds: 3_600 },
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.getSnapshot('GBP')).rejects.toBeInstanceOf(CrossRateUnavailableError);
    }

    /* Paced by the clock, not by customer traffic — otherwise every quote
     * arriving during an outage becomes another request into it. */
    expect(calls()).toBe(1);

    /* With nothing to serve the wait is the cold one, so recovery is quick. */
    time.advance(31);
    await expect(service.getSnapshot('GBP')).rejects.toBeInstanceOf(CrossRateUnavailableError);
    expect(calls()).toBe(2);
  });

  it('recovers on the cold retry once the feed answers', async () => {
    const time = clock();
    let healthy = false;
    const { service } = build(
      async () => {
        if (!healthy) throw new Error('feed down');
        return TABLE;
      },
      { now: time.now },
    );

    await expect(service.getSnapshot('GBP')).rejects.toBeInstanceOf(CrossRateUnavailableError);
    healthy = true;
    time.advance(31);

    await expect(service.getSnapshot('GBP')).resolves.toMatchObject({ unitsPerUsd: '0.74756' });
  });

  it('reports a feed that has never answered as unavailable', async () => {
    const { service } = build(async () => {
      throw new Error('feed down');
    });

    const error = await service.getSnapshot('GBP').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CrossRateUnavailableError);
    expect(error).toMatchObject({ reason: 'PROVIDER_UNAVAILABLE' });
  });

  it('distinguishes a currency the feed does not carry', async () => {
    const { service } = build(async () => TABLE);

    const error = await service.getSnapshot('XYZ').catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reason: 'UNSUPPORTED_CURRENCY', currency: 'XYZ' });
  });

  it.each(['', 'US', 'USDT', 'US1'])('refuses %o as a currency code', async (code) => {
    const { service, calls } = build(async () => TABLE);

    await expect(service.getSnapshot(code)).rejects.toMatchObject({
      reason: 'UNSUPPORTED_CURRENCY',
    });
    expect(calls()).toBe(0);
  });

  it('refuses an empty table rather than installing it', async () => {
    const { service } = build(async () => []);

    await expect(service.getSnapshot('GBP')).rejects.toMatchObject({
      reason: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('ignores a USD row in the feed', async () => {
    const { service } = build(async () => [...TABLE, entry('USD', '1.02')]);

    /* Identity wins. A feed quoting the base against itself at anything but one
     * is noise, and taking it would move every dollar price. */
    await expect(service.getSnapshot('USD')).resolves.toMatchObject({ unitsPerUsd: '1' });
  });

  it('reports feed liveness without leaking the failure detail into a rate', async () => {
    const { service } = build(async () => TABLE);
    await service.getSnapshot('GBP');

    expect(service.health()).toMatchObject({
      provider: 'frankfurter',
      hasTable: true,
      currencies: 3,
      lastErrorAt: null,
    });
  });

  it('warms the table at boot when configured to', async () => {
    const { service, calls } = build(async () => TABLE, { warmOnStart: true });

    service.onModuleInit();
    await Promise.resolve();

    expect(calls()).toBe(1);
  });
});
