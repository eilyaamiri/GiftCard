import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FxPair } from '@barat/contracts';
import type { FxRateProvider, ProviderHealth, RawFxRate } from '@barat/fx';

import { FxAggregatorService, StaleFxRateError } from './fx-aggregator.service';
import type {
  FxAggregatorConfig,
  FxClock,
  FxRateCreateData,
  FxRateRecord,
  FxRateRepository,
  FxStaffActor,
} from './fx.types';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const STALE_THRESHOLD_SECONDS = 900;
const PAIR: FxPair = 'USD_IRR';
const ACTOR: FxStaffActor = { id: 'staff-1', role: 'FINANCE' };

class MutableClock implements FxClock {
  constructor(private current: Date = new Date(NOW)) {}

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }
}

/** In-memory repository with the same expiry semantics as the Prisma adapter. */
class InMemoryFxRateRepository implements FxRateRepository {
  readonly rows: FxRateRecord[] = [];
  private sequence = 0;

  async createRate(data: FxRateCreateData): Promise<FxRateRecord> {
    this.sequence += 1;
    const row: FxRateRecord = {
      id: `fx-${this.sequence}`,
      pair: data.pair,
      buyRate: data.buyRate,
      sellRate: data.sellRate,
      midRate: data.midRate,
      source: data.source,
      provider: data.provider,
      receivedAt: data.receivedAt,
      effectiveAt: data.effectiveAt,
      expiresAt: data.expiresAt,
      isManualOverride: data.isManualOverride,
      overrideReason: data.overrideReason ?? null,
    };
    this.rows.push(row);
    return row;
  }

  async findActiveManualOverride(pair: FxPair, now: Date): Promise<FxRateRecord | null> {
    const matches = this.rows
      .filter(
        (row) =>
          row.pair === pair &&
          row.isManualOverride &&
          row.expiresAt !== null &&
          row.expiresAt.getTime() > now.getTime(),
      )
      .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
    return matches[0] ?? null;
  }

  async findHistory(pair: FxPair, skip: number, take: number): Promise<readonly FxRateRecord[]> {
    return this.rows
      .filter((row) => row.pair === pair)
      .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())
      .slice(skip, skip + take);
  }

  async countHistory(pair: FxPair): Promise<number> {
    return this.rows.filter((row) => row.pair === pair).length;
  }

  async expireManualOverrides(pair: FxPair, now: Date): Promise<number> {
    let expired = 0;
    for (let index = 0; index < this.rows.length; index += 1) {
      const row = this.rows[index];
      if (
        row &&
        row.pair === pair &&
        row.isManualOverride &&
        row.expiresAt !== null &&
        row.expiresAt.getTime() > now.getTime()
      ) {
        this.rows[index] = { ...row, expiresAt: now };
        expired += 1;
      }
    }
    return expired;
  }
}

interface StubOptions {
  readonly name: string;
  readonly midRate?: string;
  readonly healthy?: boolean;
  readonly ageSeconds?: number;
  readonly throwOnGetRate?: boolean;
  readonly throwOnHealth?: boolean;
  readonly expiresAt?: Date | null;
  readonly pair?: FxPair;
}

class StubProvider implements FxRateProvider {
  readonly name: string;
  readonly getRateCalls: FxPair[] = [];
  private options: StubOptions;

  constructor(options: StubOptions) {
    this.name = options.name;
    this.options = options;
  }

  update(patch: Partial<StubOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  async getHealth(): Promise<ProviderHealth> {
    if (this.options.throwOnHealth) {
      throw new Error('health probe exploded');
    }
    return {
      provider: this.name,
      isHealthy: this.options.healthy ?? true,
      checkedAt: new Date(NOW),
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorCode: this.options.healthy === false ? 'FORCED_UNHEALTHY' : null,
      consecutiveFailures: this.options.healthy === false ? 3 : 0,
    };
  }

  async getRate(pair: FxPair): Promise<RawFxRate> {
    this.getRateCalls.push(pair);
    if (this.options.throwOnGetRate) {
      throw new Error('provider exploded');
    }
    const age = (this.options.ageSeconds ?? 0) * 1_000;
    const mid = this.options.midRate ?? '1920000';
    return {
      pair: this.options.pair ?? pair,
      buyRate: mid,
      sellRate: mid,
      midRate: mid,
      source: 'API',
      receivedAt: new Date(NOW),
      effectiveAt: new Date(NOW.getTime() - age),
      expiresAt: this.options.expiresAt ?? null,
    };
  }
}

interface Harness {
  readonly service: FxAggregatorService;
  readonly repository: InMemoryFxRateRepository;
  readonly primary: StubProvider;
  readonly secondary: StubProvider;
  readonly clock: MutableClock;
  readonly audit: { record: ReturnType<typeof vi.fn> };
}

function buildHarness(
  primaryOptions: StubOptions = { name: 'primary' },
  secondaryOptions: StubOptions = { name: 'secondary', midRate: '1930000' },
  config: FxAggregatorConfig = { staleThresholdSeconds: STALE_THRESHOLD_SECONDS },
): Harness {
  const primary = new StubProvider(primaryOptions);
  const secondary = new StubProvider(secondaryOptions);
  const repository = new InMemoryFxRateRepository();
  const clock = new MutableClock();
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new FxAggregatorService(
    primary,
    secondary,
    repository,
    config,
    audit as never,
    clock,
  );
  return { service, repository, primary, secondary, clock, audit };
}

describe('FxAggregatorService selection policy', () => {
  it('uses the primary provider when it is healthy and fresh', async () => {
    const harness = buildHarness();

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('primary');
    expect(snapshot.midRate).toBe('1920000');
    expect(snapshot.isStale).toBe(false);
    expect(snapshot.isManualOverride).toBe(false);
    /* The secondary must not even be asked when the primary answers. */
    expect(harness.secondary.getRateCalls).toHaveLength(0);
  });

  it('falls back to the secondary when the primary rate is stale', async () => {
    const harness = buildHarness(
      { name: 'primary', ageSeconds: STALE_THRESHOLD_SECONDS + 60 },
      { name: 'secondary', midRate: '1930000' },
    );

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('secondary');
    expect(snapshot.midRate).toBe('1930000');
    expect(snapshot.isStale).toBe(false);
    /* The stale primary observation is still recorded for audit. */
    expect(harness.repository.rows.map((row) => row.provider)).toEqual(['primary', 'secondary']);
  });

  it('falls back to the secondary when the primary reports unhealthy', async () => {
    const harness = buildHarness(
      { name: 'primary', healthy: false },
      { name: 'secondary', midRate: '1930000' },
    );

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('secondary');
    /* An unhealthy provider is not called for a rate at all. */
    expect(harness.primary.getRateCalls).toHaveLength(0);
  });

  it('falls back when the primary throws on getRate or on getHealth', async () => {
    const throwing = buildHarness({ name: 'primary', throwOnGetRate: true });
    await expect(throwing.service.getRateSnapshot(PAIR)).resolves.toMatchObject({
      provider: 'secondary',
    });

    const probeFails = buildHarness({ name: 'primary', throwOnHealth: true });
    await expect(probeFails.service.getRateSnapshot(PAIR)).resolves.toMatchObject({
      provider: 'secondary',
    });
  });

  it('uses an active manual override when both providers are stale', async () => {
    const harness = buildHarness(
      { name: 'primary', ageSeconds: STALE_THRESHOLD_SECONDS + 1 },
      { name: 'secondary', ageSeconds: STALE_THRESHOLD_SECONDS + 1 },
    );
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Providers offline during a market holiday',
        ttlSeconds: 3_600,
      },
      ACTOR,
    );

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('manual');
    expect(snapshot.source).toBe('MANUAL');
    expect(snapshot.isManualOverride).toBe(true);
    expect(snapshot.midRate).toBe('1945000');
    expect(snapshot.overrideReason).toBe('Providers offline during a market holiday');
  });

  it('prefers a fresh provider over an active manual override', async () => {
    const harness = buildHarness();
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '9000000',
        sellRate: '9000000',
        midRate: '9000000',
        reason: 'Override left active by mistake',
        ttlSeconds: 3_600,
      },
      ACTOR,
    );

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('primary');
    expect(snapshot.isManualOverride).toBe(false);
  });

  it('throws StaleFxRateError when every source is stale and no override exists', async () => {
    const harness = buildHarness(
      { name: 'primary', ageSeconds: STALE_THRESHOLD_SECONDS + 120 },
      { name: 'secondary', ageSeconds: STALE_THRESHOLD_SECONDS + 300 },
    );

    const error = await harness.service.getRateSnapshot(PAIR).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StaleFxRateError);
    expect((error as StaleFxRateError).code).toBe('FX_RATE_STALE');
    expect((error as StaleFxRateError).status).toBe(503);
    expect((error as StaleFxRateError).ageSeconds).toBe(STALE_THRESHOLD_SECONDS + 300);
  });

  it('throws when both providers are unavailable — no rate is ever estimated', async () => {
    const harness = buildHarness(
      { name: 'primary', healthy: false },
      { name: 'secondary', healthy: false },
    );

    await expect(harness.service.getRateSnapshot(PAIR)).rejects.toBeInstanceOf(StaleFxRateError);
    expect(harness.repository.rows).toHaveLength(0);
  });

  it('discards a provider payload for the wrong pair instead of pricing with it', async () => {
    const harness = buildHarness({ name: 'primary', pair: 'USD_IRR' });
    harness.primary.update({ pair: 'EUR_IRR' as FxPair });

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('secondary');
    expect(harness.repository.rows.map((row) => row.provider)).toEqual(['secondary']);
  });

  it('treats a provider-supplied expiry in the past as stale', async () => {
    const harness = buildHarness(
      { name: 'primary', expiresAt: new Date(NOW.getTime() - 1_000) },
      { name: 'secondary', midRate: '1930000' },
    );

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('secondary');
  });

  it('rejects a rate exactly at the stale threshold — the boundary is not fresh', async () => {
    const harness = buildHarness(
      { name: 'primary', ageSeconds: STALE_THRESHOLD_SECONDS },
      { name: 'secondary', ageSeconds: STALE_THRESHOLD_SECONDS - 1, midRate: '1930000' },
    );

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('secondary');
    expect(snapshot.ageSeconds).toBe(STALE_THRESHOLD_SECONDS - 1);
  });

  it('refuses to be constructed with a nonsensical stale threshold', () => {
    expect(() =>
      buildHarness({ name: 'primary' }, { name: 'secondary' }, { staleThresholdSeconds: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      buildHarness({ name: 'primary' }, { name: 'secondary' }, { staleThresholdSeconds: 1.5 }),
    ).toThrow(RangeError);
  });
});

describe('FxAggregatorService persistence and provenance', () => {
  it('persists every field of a fetched rate with the provider identity', async () => {
    const harness = buildHarness({ name: 'primary', midRate: '1920000', ageSeconds: 30 });

    const snapshot = await harness.service.getRateSnapshot(PAIR);
    const row = harness.repository.rows[0];

    expect(harness.repository.rows).toHaveLength(1);
    expect(row).toMatchObject({
      pair: 'USD_IRR',
      buyRate: '1920000',
      sellRate: '1920000',
      midRate: '1920000',
      source: 'API',
      provider: 'primary',
      isManualOverride: false,
      overrideReason: null,
      expiresAt: null,
    });
    expect(row?.receivedAt.toISOString()).toBe(NOW.toISOString());
    expect(row?.effectiveAt.toISOString()).toBe(new Date(NOW.getTime() - 30_000).toISOString());

    /* The snapshot points back at the persisted row so a Quote can cite it. */
    expect(snapshot.id).toBe(row?.id);
    expect(snapshot.provider).toBe('primary');
    expect(snapshot.ageSeconds).toBe(30);
  });

  it('records which provider was used when the secondary wins', async () => {
    const harness = buildHarness(
      { name: 'primary', ageSeconds: STALE_THRESHOLD_SECONDS + 1 },
      { name: 'secondary', midRate: '1930000' },
    );

    const snapshot = await harness.service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('secondary');
    expect(snapshot.source).toBe('API');
    const persisted = harness.repository.rows.find((row) => row.id === snapshot.id);
    expect(persisted?.provider).toBe('secondary');
    expect(persisted?.midRate).toBe('1930000');
  });

  it('propagates a persistence failure instead of pricing with an unrecorded rate', async () => {
    const harness = buildHarness();
    vi.spyOn(harness.repository, 'createRate').mockRejectedValueOnce(new Error('db down'));

    await expect(harness.service.getRateSnapshot(PAIR)).rejects.toThrow('db down');
  });

  it('returns paginated history newest first, including manual rows', async () => {
    const harness = buildHarness();
    await harness.service.getRateSnapshot(PAIR);
    harness.clock.advanceSeconds(60);
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Manual pin for the pilot',
        ttlSeconds: 600,
      },
      ACTOR,
    );

    const page = await harness.service.getHistory(PAIR, 1, 10);

    expect(page.meta).toEqual({ page: 1, pageSize: 10, total: 2, totalPages: 1 });
    expect(page.items[0]?.provider).toBe('manual');
    expect(page.items[1]?.provider).toBe('primary');
  });

  it('rejects invalid pagination', async () => {
    const harness = buildHarness();

    await expect(harness.service.getHistory(PAIR, 0, 10)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(harness.service.getHistory(PAIR, 1, 101)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('FxAggregatorService manual override', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness(
      { name: 'primary', healthy: false },
      { name: 'secondary', healthy: false },
    );
  });

  it('stores the override with an expiry, the reason and the staff author', async () => {
    const snapshot = await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Market closed; rate agreed with finance',
        ttlSeconds: 1_800,
      },
      ACTOR,
    );

    expect(snapshot.isManualOverride).toBe(true);
    expect(snapshot.expiresAt).toBe(new Date(NOW.getTime() + 1_800_000).toISOString());
    expect(snapshot.isStale).toBe(false);
    expect(harness.repository.rows[0]).toMatchObject({
      provider: 'manual',
      source: 'MANUAL',
      isManualOverride: true,
      overrideReason: 'Market closed; rate agreed with finance',
    });
  });

  it('audits the override with the acting staff member and never a raw secret', async () => {
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Market closed',
        ttlSeconds: 600,
      },
      ACTOR,
    );

    expect(harness.audit.record).toHaveBeenCalledTimes(1);
    expect(harness.audit.record.mock.calls[0]?.[0]).toMatchObject({
      actor: 'staff-1',
      actorType: 'STAFF',
      actorRole: 'FINANCE',
      action: 'FX_RATE_OVERRIDE_CREATED',
      entity: 'FxRate',
    });
  });

  it('stops using the override once its TTL has elapsed', async () => {
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Short pin during a provider outage',
        ttlSeconds: 300,
      },
      ACTOR,
    );

    await expect(harness.service.getRateSnapshot(PAIR)).resolves.toMatchObject({
      provider: 'manual',
    });

    harness.clock.advanceSeconds(299);
    await expect(harness.service.getRateSnapshot(PAIR)).resolves.toMatchObject({
      provider: 'manual',
    });

    harness.clock.advanceSeconds(2);
    await expect(harness.service.getRateSnapshot(PAIR)).rejects.toBeInstanceOf(StaleFxRateError);
  });

  it('ignores an expired override even if the repository hands one back', async () => {
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Expired pin',
        ttlSeconds: 60,
      },
      ACTOR,
    );
    harness.clock.advanceSeconds(120);
    const expiredRow = harness.repository.rows[0];
    vi.spyOn(harness.repository, 'findActiveManualOverride').mockResolvedValueOnce(
      expiredRow as never,
    );

    await expect(harness.service.getRateSnapshot(PAIR)).rejects.toBeInstanceOf(StaleFxRateError);
  });

  it('uses the newest override when several are active', async () => {
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1900000',
        sellRate: '1900000',
        midRate: '1900000',
        reason: 'First pin',
        ttlSeconds: 3_600,
      },
      ACTOR,
    );
    harness.clock.advanceSeconds(60);
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1960000',
        sellRate: '1960000',
        midRate: '1960000',
        reason: 'Corrected pin',
        ttlSeconds: 3_600,
      },
      ACTOR,
    );

    await expect(harness.service.getRateSnapshot(PAIR)).resolves.toMatchObject({
      midRate: '1960000',
      overrideReason: 'Corrected pin',
    });
  });

  it('rejects an override without a usable reason, TTL or rate', async () => {
    const base = {
      pair: PAIR,
      buyRate: '1950000',
      sellRate: '1940000',
      midRate: '1945000',
      reason: 'Valid reason',
      ttlSeconds: 600,
    };

    await expect(
      harness.service.setManualOverride({ ...base, reason: 'x' }, ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      harness.service.setManualOverride({ ...base, ttlSeconds: 0 }, ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      harness.service.setManualOverride({ ...base, ttlSeconds: 86_401 }, ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      harness.service.setManualOverride({ ...base, midRate: '0' }, ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      harness.service.setManualOverride({ ...base, buyRate: '-1920000' }, ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(harness.repository.rows).toHaveLength(0);
  });

  it('expires the active override on delete and audits the change', async () => {
    await harness.service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Temporary pin',
        ttlSeconds: 3_600,
      },
      ACTOR,
    );

    const result = await harness.service.clearManualOverride(PAIR, ACTOR);

    expect(result).toEqual({ expired: 1 });
    /* Status change, not deletion: the history row survives. */
    expect(harness.repository.rows).toHaveLength(1);
    expect(harness.audit.record.mock.calls[1]?.[0]).toMatchObject({
      action: 'FX_RATE_OVERRIDE_CLEARED',
      actor: 'staff-1',
    });
    await expect(harness.service.getRateSnapshot(PAIR)).rejects.toBeInstanceOf(StaleFxRateError);
  });
});

describe('FxAggregatorService current endpoint payload', () => {
  it('reports the selected snapshot alongside safe provider health', async () => {
    const harness = buildHarness(
      { name: 'primary', healthy: false },
      { name: 'secondary', midRate: '1930000' },
    );

    const response = await harness.service.getCurrent(PAIR);

    expect(response.snapshot.provider).toBe('secondary');
    expect(response.effectiveRate).toBe('1930000');
    expect(response.providers).toEqual([
      {
        provider: 'primary',
        isHealthy: false,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: 'FORCED_UNHEALTHY',
        consecutiveFailures: 3,
      },
      {
        provider: 'secondary',
        isHealthy: true,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorCode: null,
        consecutiveFailures: 0,
      },
    ]);
  });

  it('never lets a health-probe exception escape the endpoint', async () => {
    const harness = buildHarness({ name: 'primary', throwOnHealth: true });

    const health = await harness.service.getProviderHealth();

    expect(health[0]).toMatchObject({
      provider: 'primary',
      isHealthy: false,
      lastErrorCode: 'HEALTH_CHECK_FAILED',
    });
  });
});
