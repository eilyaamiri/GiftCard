import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { ROLES_METADATA_KEY } from '../identity/rbac/roles.decorator';
import { MonitoringController } from './monitoring.controller';
import type { MonitoringService } from './monitoring.service';

describe('MonitoringController', () => {
  it('runs the dashboard probe as a manual probe, which cannot advance the paging streak', async () => {
    const monitoring = {
      probeSuppliers: vi.fn(async () => undefined),
      getSnapshot: vi.fn(async () => ({ suppliers: [{}, {}] })),
    };
    const controller = new MonitoringController(monitoring as unknown as MonitoringService);

    const result = await controller.triggerProbe();

    expect(monitoring.probeSuppliers).toHaveBeenCalledWith({ manual: true });
    expect(result.supplierCount).toBe(2);
  });

  it('is staff-only at the controller level', () => {
    expect(Reflect.getMetadata(ROLES_METADATA_KEY, MonitoringController)).toEqual([
      'ADMIN',
      'MANAGEMENT',
      'FINANCE',
    ]);
  });
});
