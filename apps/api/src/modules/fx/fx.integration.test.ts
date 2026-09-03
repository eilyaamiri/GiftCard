import { describe, expect, it, vi } from 'vitest';
import type { FxPair } from '@barat/contracts';
import { createPrimaryFxRateProvider, createSecondaryFxRateProvider } from '@barat/fx';

import { FxAggregatorService, StaleFxRateError } from './fx-aggregator.service';
import { FX_OVERRIDE_ROLES, FxOverrideGuard, requireStaffActor } from './fx-staff.guard';
import { fxOverrideRequestSchema } from './fx.dto';
import type {
  FxClock,
  FxRateCreateData,
  FxRateRecord,
  FxRateRepository,
} from './fx.types';

const PAIR: FxPair = 'USD_IRR';
const NOW = new Date('2026-08-30T12:00:00.000Z');
const clock: FxClock = { now: () => new Date(NOW) };

class RecordingRepository implements FxRateRepository {
  readonly rows: FxRateRecord[] = [];

  async createRate(data: FxRateCreateData): Promise<FxRateRecord> {
    const row: FxRateRecord = {
      id: `fx-${this.rows.length + 1}`,
      ...data,
      overrideReason: data.overrideReason ?? null,
    };
    this.rows.push(row);
    return row;
  }

  async findActiveManualOverride(): Promise<FxRateRecord | null> {
    return null;
  }

  async findHistory(): Promise<readonly FxRateRecord[]> {
    return this.rows;
  }

  async countHistory(): Promise<number> {
    return this.rows.length;
  }

  async expireManualOverrides(): Promise<number> {
    return 0;
  }
}

/**
 * These tests wire the aggregator to the real adapters from `@barat/fx`, which
 * is the combination the Nest module builds at boot.
 */
describe('FX module wiring', () => {
  it('prices from the deterministic mock pair used in development', async () => {
    const repository = new RecordingRepository();
    const service = new FxAggregatorService(
      createPrimaryFxRateProvider({ kind: 'mock', mock: { jitterSequenceBps: [0], clock: () => new Date(NOW) } }),
      createSecondaryFxRateProvider({ kind: 'mock', mock: { jitterSequenceBps: [3], clock: () => new Date(NOW) } }),
      repository,
      { staleThresholdSeconds: 900 },
      undefined,
      clock,
    );

    const snapshot = await service.getRateSnapshot(PAIR);

    expect(snapshot.provider).toBe('mock-primary');
    expect(snapshot.midRate).toBe('1920000');
    expect(snapshot.isStale).toBe(false);
    expect(repository.rows).toHaveLength(1);
  });

  it('prices USD from the live USDT/rial market when the primary venue is nobitex', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: 'ok',
        stats: {
          'usdt-rls': {
            isClosed: false,
            bestBuy: '1198000.0000000000',
            bestSell: '1202000.0000000000',
          },
        },
      }),
    })) as unknown as typeof fetch;

    try {
      const repository = new RecordingRepository();
      const service = new FxAggregatorService(
        createPrimaryFxRateProvider({ kind: 'nobitex' }),
        createSecondaryFxRateProvider({ kind: 'http' }),
        repository,
        { staleThresholdSeconds: 900 },
        undefined,
        clock,
      );

      const snapshot = await service.getRateSnapshot(PAIR);

      expect(snapshot.midRate).toBe('1200000');
      /* Position and venue on the row; the category stays the schema's own. */
      expect(snapshot.provider).toBe('primary-nobitex');
      expect(snapshot.source).toBe('API');
      expect(snapshot.isStale).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects quoting when both HTTP adapters are unconfigured', async () => {
    delete process.env['FX_PRIMARY_URL'];
    delete process.env['FX_SECONDARY_URL'];
    const repository = new RecordingRepository();
    const service = new FxAggregatorService(
      createPrimaryFxRateProvider({ kind: 'http' }),
      createSecondaryFxRateProvider({ kind: 'http' }),
      repository,
      { staleThresholdSeconds: 900 },
      undefined,
      clock,
    );

    await expect(service.getRateSnapshot(PAIR)).rejects.toBeInstanceOf(StaleFxRateError);
    expect(repository.rows).toHaveLength(0);
    await expect(service.getProviderHealth()).resolves.toEqual([
      expect.objectContaining({ provider: 'primary', isHealthy: false, lastErrorCode: 'NOT_CONFIGURED' }),
      expect.objectContaining({ provider: 'secondary', isHealthy: false, lastErrorCode: 'NOT_CONFIGURED' }),
    ]);
  });
});

function contextFor(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('FxOverrideGuard', () => {
  it('allows only ADMIN and FINANCE', () => {
    expect([...FX_OVERRIDE_ROLES]).toEqual(['ADMIN', 'FINANCE']);
    const guard = new FxOverrideGuard();

    expect(guard.canActivate(contextFor({ user: { id: 'u1', role: 'ADMIN' } }))).toBe(true);
    expect(guard.canActivate(contextFor({ user: { id: 'u2', role: 'FINANCE' } }))).toBe(true);
  });

  it('rejects other staff roles with FORBIDDEN', () => {
    const guard = new FxOverrideGuard();

    for (const role of ['OPERATOR', 'SUPPORT', 'VIEWER', 'OPS_MANAGER', 'MANAGEMENT']) {
      expect(() => guard.canActivate(contextFor({ user: { id: 'u', role } }))).toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' }) as never,
      );
    }
  });

  it('fails closed when the request carries no staff principal', () => {
    const guard = new FxOverrideGuard();

    expect(() => guard.canActivate(contextFor({}))).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }) as never,
    );
    expect(() => guard.canActivate(contextFor({ user: { id: 'u', role: 'NOT_A_ROLE' } }))).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }) as never,
    );
    expect(() => requireStaffActor({})).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }) as never,
    );
  });

  it('never takes the actor from the request body', () => {
    const parsed = fxOverrideRequestSchema.safeParse({
      pair: 'USD_IRR',
      buyRate: '1950000',
      sellRate: '1940000',
      midRate: '1945000',
      reason: 'Attempting to name myself',
      ttlSeconds: 600,
      actorId: 'staff-admin',
    });

    expect(parsed.success).toBe(false);
  });
});

describe('fxOverrideRequestSchema', () => {
  it('requires a reason and a bounded TTL', () => {
    const base = {
      pair: 'USD_IRR',
      buyRate: '1950000',
      sellRate: '1940000',
      midRate: '1945000',
      reason: 'Provider outage',
      ttlSeconds: 600,
    };

    expect(fxOverrideRequestSchema.safeParse(base).success).toBe(true);
    expect(fxOverrideRequestSchema.safeParse({ ...base, reason: '' }).success).toBe(false);
    expect(fxOverrideRequestSchema.safeParse({ ...base, ttlSeconds: 10 }).success).toBe(false);
    expect(fxOverrideRequestSchema.safeParse({ ...base, ttlSeconds: 86_401 }).success).toBe(false);
    expect(fxOverrideRequestSchema.safeParse({ ...base, midRate: '0' }).success).toBe(false);
    expect(fxOverrideRequestSchema.safeParse({ ...base, midRate: 1_945_000 }).success).toBe(false);
  });
});

describe('audit-free operation', () => {
  it('still overrides when no audit service is injected', async () => {
    const repository = new RecordingRepository();
    const service = new FxAggregatorService(
      createPrimaryFxRateProvider({ kind: 'mock', mock: { clock: () => new Date(NOW) } }),
      createSecondaryFxRateProvider({ kind: 'mock', mock: { clock: () => new Date(NOW) } }),
      repository,
      { staleThresholdSeconds: 900 },
      undefined,
      clock,
    );
    const spy = vi.spyOn(repository, 'createRate');

    const snapshot = await service.setManualOverride(
      {
        pair: PAIR,
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'No audit writer configured in this context',
        ttlSeconds: 600,
      },
      { id: 'staff-1', role: 'ADMIN' },
    );

    expect(snapshot.isManualOverride).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });
});
