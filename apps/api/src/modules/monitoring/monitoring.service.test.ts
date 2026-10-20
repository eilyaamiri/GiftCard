import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupplierProvider } from '@barat/suppliers';

import type { AlertInput, AlertLogger } from '../../common/alert';
import type { AppConfigService } from '../../common/config/app-config.service';
import type { FxAggregatorService } from '../fx/fx-aggregator.service';
import { MonitoringService, SUPPLIER_PROBE_INTERVAL_MS } from './monitoring.service';
import type { MonitoringDatabase } from './monitoring.tokens';

/** A supplier whose balance read succeeds or throws on command. */
function fakeSupplier(key: string) {
  const state = { failing: false, calls: 0 };
  const provider = {
    key,
    getBalance: async () => {
      state.calls += 1;
      if (state.failing) throw new Error('upstream said: {"merchant_secret":"x"}');
      return { amount: '120.00', currency: 'USD' };
    },
  } as unknown as SupplierProvider;
  return { provider, state };
}

function build(suppliers: SupplierProvider[], isTest = true) {
  const alerts: AlertInput[] = [];
  const alertLogger = { log: (input: AlertInput) => alerts.push(input) } as unknown as AlertLogger;
  const service = new MonitoringService(
    { getProviderHealth: async () => [] } as unknown as FxAggregatorService,
    suppliers,
    { order: { findMany: async () => [] } } as unknown as MonitoringDatabase,
    { isTest } as AppConfigService,
    alertLogger,
  );
  return { service, alerts };
}

async function supplierRow(service: MonitoringService, key: string) {
  return (await service.getSnapshot()).suppliers.find((s) => s.key === key);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MonitoringService supplier probe', () => {
  it('records a healthy supplier with its balance', async () => {
    const { provider } = fakeSupplier('tillo');
    const { service, alerts } = build([provider]);

    await service.probeSuppliers();

    expect(await supplierRow(service, 'tillo')).toMatchObject({
      status: 'HEALTHY',
      balanceAmount: '120.00',
      balanceCurrency: 'USD',
    });
    expect(alerts).toEqual([]);
  });

  it('never exposes the provider error text, only a fixed code', async () => {
    const { provider, state } = fakeSupplier('reloadly');
    state.failing = true;
    const { service } = build([provider]);

    await service.probeSuppliers();

    const row = await supplierRow(service, 'reloadly');
    expect(row?.status).toBe('OFFLINE');
    expect(row?.errorMessage).toBe('BALANCE_READ_FAILED');
    expect(JSON.stringify(row)).not.toContain('merchant_secret');
  });

  it('warns once, pages once after the second failure, then stays quiet', async () => {
    const { provider, state } = fakeSupplier('runa');
    state.failing = true;
    const { service, alerts } = build([provider]);

    await service.probeSuppliers();
    expect(alerts.map((a) => a.severity)).toEqual(['WARNING']);

    await service.probeSuppliers();
    expect(alerts.map((a) => a.severity)).toEqual(['WARNING', 'ERROR']);
    expect(alerts[1]).toMatchObject({ source: 'SUPPLIER' });

    // A third, fourth... failed probe must not resend the page every 5 minutes.
    await service.probeSuppliers();
    await service.probeSuppliers();
    expect(alerts).toHaveLength(2);
  });

  it('announces recovery only after a real outage', async () => {
    const { provider, state } = fakeSupplier('giftbit');
    const { service, alerts } = build([provider]);

    // A single blip that heals: no recovery notice.
    state.failing = true;
    await service.probeSuppliers();
    state.failing = false;
    await service.probeSuppliers();
    expect(alerts.map((a) => a.severity)).toEqual(['WARNING']);

    // A real outage that heals: one INFO.
    state.failing = true;
    await service.probeSuppliers();
    await service.probeSuppliers();
    state.failing = false;
    await service.probeSuppliers();
    expect(alerts.map((a) => a.severity)).toEqual(['WARNING', 'WARNING', 'ERROR', 'INFO']);
  });

  it('does not stack a second probe on one still running', async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const slow = {
      key: 'slow',
      getBalance: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve({ amount: '1', currency: 'USD' });
        });
      },
    } as unknown as SupplierProvider;
    const { service } = build([slow]);

    const first = service.probeSuppliers();
    await service.probeSuppliers(); // returns immediately: one already in flight
    release();
    await first;

    expect(calls).toBe(1);
  });

  it('probes on boot and then every five minutes', async () => {
    vi.useFakeTimers();
    const { provider, state } = fakeSupplier('fazercards');
    const { service } = build([provider], false);

    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(SUPPLIER_PROBE_INTERVAL_MS);
    expect(state.calls).toBe(2);

    await vi.advanceTimersByTimeAsync(SUPPLIER_PROBE_INTERVAL_MS);
    expect(state.calls).toBe(3);

    service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(SUPPLIER_PROBE_INTERVAL_MS);
    expect(state.calls).toBe(3);
  });

  it('starts no timer under test', async () => {
    vi.useFakeTimers();
    const { provider, state } = fakeSupplier('mock');
    const { service } = build([provider], true);

    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(SUPPLIER_PROBE_INTERVAL_MS * 2);

    expect(state.calls).toBe(0);
  });
});
