import { describe, expect, it, vi } from 'vitest';
import type { FxRateSnapshot } from '@barat/contracts';

import { FxController } from './fx.controller';
import type { FxAggregatorService } from './fx-aggregator.service';

const SNAPSHOT = {
  id: 'fx-1',
  pair: 'USD_IRR',
  buyRate: '1921000',
  sellRate: '1919000',
  midRate: '1920000',
  provider: 'primary',
  source: 'API',
  receivedAt: '2026-08-30T12:00:00.000Z',
  effectiveAt: '2026-08-30T12:00:00.000Z',
  expiresAt: null,
  isManualOverride: false,
  overrideReason: null,
  ageSeconds: 0,
  isStale: false,
} as unknown as FxRateSnapshot;

function buildController() {
  const aggregator = {
    getCurrent: vi.fn().mockResolvedValue({ snapshot: SNAPSHOT, effectiveRate: '1920000', providers: [] }),
    getHistory: vi.fn().mockResolvedValue({ items: [SNAPSHOT], meta: { page: 2, pageSize: 5, total: 6, totalPages: 2 } }),
    getProviderHealth: vi.fn().mockResolvedValue([{ provider: 'primary', isHealthy: false }]),
    setManualOverride: vi.fn().mockResolvedValue(SNAPSHOT),
    clearManualOverride: vi.fn().mockResolvedValue({ expired: 1 }),
  };
  return {
    aggregator,
    controller: new FxController(aggregator as unknown as FxAggregatorService),
  };
}

describe('FxController', () => {
  it('passes the validated pair through to the aggregator', async () => {
    const { controller, aggregator } = buildController();

    await controller.current({ pair: 'USD_IRR' });

    expect(aggregator.getCurrent).toHaveBeenCalledWith('USD_IRR');
  });

  it('forwards pagination to the aggregator unchanged', async () => {
    const { controller, aggregator } = buildController();

    const result = await controller.history({ pair: 'USD_IRR', page: 2, pageSize: 5 });

    expect(aggregator.getHistory).toHaveBeenCalledWith('USD_IRR', 2, 5);
    expect(result.meta.totalPages).toBe(2);
  });

  it('answers the health route even while no rate is usable', async () => {
    const { controller } = buildController();

    await expect(controller.health()).resolves.toEqual({
      providers: [{ provider: 'primary', isHealthy: false }],
    });
  });

  it('takes the override actor from the session, never from the body', async () => {
    const { controller, aggregator } = buildController();
    const body = {
      pair: 'USD_IRR' as const,
      buyRate: '1950000' as never,
      sellRate: '1940000' as never,
      midRate: '1945000' as never,
      reason: 'Provider outage',
      ttlSeconds: 600,
    };

    await controller.setOverride(body, { user: { id: 'staff-9', role: 'ADMIN' } });

    expect(aggregator.setManualOverride).toHaveBeenCalledWith(
      {
        pair: 'USD_IRR',
        buyRate: '1950000',
        sellRate: '1940000',
        midRate: '1945000',
        reason: 'Provider outage',
        ttlSeconds: 600,
      },
      { id: 'staff-9', role: 'ADMIN' },
    );
  });

  it('refuses an override when the request has no staff principal', async () => {
    const { controller, aggregator } = buildController();

    await expect(
      controller.setOverride(
        {
          pair: 'USD_IRR' as const,
          buyRate: '1950000' as never,
          sellRate: '1940000' as never,
          midRate: '1945000' as never,
          reason: 'Provider outage',
          ttlSeconds: 600,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(aggregator.setManualOverride).not.toHaveBeenCalled();
  });

  it('clears the override for the requested pair with the session actor', async () => {
    const { controller, aggregator } = buildController();

    const result = await controller.clearOverride(
      { pair: 'USD_IRR' },
      { user: { id: 'staff-3', role: 'FINANCE' } },
    );

    expect(result).toEqual({ expired: 1 });
    expect(aggregator.clearManualOverride).toHaveBeenCalledWith('USD_IRR', {
      id: 'staff-3',
      role: 'FINANCE',
    });
  });
});
