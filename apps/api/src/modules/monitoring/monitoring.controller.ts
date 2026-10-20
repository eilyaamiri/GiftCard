import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../identity/rbac/roles.guard';
import { Roles } from '../identity/rbac/roles.decorator';
import type { MonitoringSnapshot } from './monitoring.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DI needs value import
import { MonitoringService } from './monitoring.service';

/**
 * Admin-only monitoring endpoint.
 *
 * Returns live status of all integrated APIs, server health, and stuck orders.
 * Auto-extends as adapters are added via SUPPLIER_PROVIDERS injection.
 */
@Controller('admin/monitoring')
@UseGuards(RolesGuard)
@Roles('ADMIN', 'MANAGEMENT', 'FINANCE')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  /**
   * GET /api/admin/monitoring
   *
   * Returns the current monitoring snapshot including:
   * - Server uptime and health
   * - FX provider status
   * - Supplier status (from last probe)
   * - Stuck orders
   */
  @Get()
  async getSnapshot(): Promise<MonitoringSnapshot> {
    return this.monitoring.getSnapshot();
  }

  /**
   * POST /api/admin/monitoring/probe
   *
   * Triggers a fresh probe of all suppliers.
   * Use sparingly — probes can hit rate limits.
   */
  @Post('probe')
  async triggerProbe(): Promise<{ probedAt: string; supplierCount: number }> {
    await this.monitoring.probeSuppliers();
    return {
      probedAt: new Date().toISOString(),
      supplierCount: (await this.monitoring.getSnapshot()).suppliers.length,
    };
  }
}
