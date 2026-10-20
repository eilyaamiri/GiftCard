import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { SupplierProvider } from '@barat/suppliers';
import { SUPPLIER_PROVIDERS } from '@barat/suppliers';
import type { FxProviderHealth } from '@barat/contracts';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- DI needs value import
import { FxAggregatorService } from '../fx/fx-aggregator.service';
import type { MonitoringDatabase } from './monitoring.tokens';
import { MONITORING_DATABASE } from './monitoring.tokens';

/** Server uptime status. */
export type ServerStatus = 'OPERATIONAL' | 'DEGRADED' | 'DOWN';

/** Provider status for display. */
export type ProviderStatus = 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';

export interface ServerUptimeSnapshot {
  status: ServerStatus;
  uptimeSeconds: number;
  uptimeFormatted: string;
  heapUsedMb: number;
  heapTotalMb: number;
  heapPercent: number;
  eventLoopLagMs: number;
  activeHandles: number;
  lastCheckAt: string;
}

export interface FxProviderSnapshot {
  provider: string;
  status: ProviderStatus;
  isHealthy: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
}

export interface SupplierSnapshot {
  key: string;
  name: string;
  status: ProviderStatus;
  balanceAmount: string | null;
  balanceCurrency: string | null;
  lastCheckAt: string | null;
  errorMessage: string | null;
}

export interface StuckOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  stuckSince: string;
  stuckMinutes: number;
  hasWorkItem: boolean;
}

export interface MonitoringSnapshot {
  server: ServerUptimeSnapshot;
  fxProviders: FxProviderSnapshot[];
  suppliers: SupplierSnapshot[];
  stuckOrders: StuckOrder[];
  generatedAt: string;
}

/** Thresholds from the plan. */
const STUCK_FULFILLMENT_PENDING_MINUTES = 15;
const STUCK_FULFILLING_MINUTES = 10;

/** Degradation thresholds. */
const HEAP_DEGRADED_PERCENT = 80;
const EVENT_LOOP_DEGRADED_MS = 500;
const ACTIVE_HANDLES_DEGRADED = 10_000;

@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);

  /** In-memory supplier probe results. */
  private supplierSnapshots: Map<string, SupplierSnapshot> = new Map();
  private lastProbeAt: Date | null = null;

  constructor(
    private readonly fxAggregator: FxAggregatorService,
    @Inject(SUPPLIER_PROVIDERS) private readonly suppliers: readonly SupplierProvider[],
    @Inject(MONITORING_DATABASE) private readonly database: MonitoringDatabase,
  ) {}

  onModuleInit(): void {
    this.logger.log('MonitoringService initialized');
    // Initial probe
    void this.probeSuppliers();
  }

  async getSnapshot(): Promise<MonitoringSnapshot> {
    const [server, fxProviders, stuckOrders] = await Promise.all([
      this.getServerUptime(),
      this.getFxProviderStatus(),
      this.getStuckOrders(),
    ]);

    return {
      server,
      fxProviders,
      suppliers: [...this.supplierSnapshots.values()],
      stuckOrders,
      generatedAt: new Date().toISOString(),
    };
  }

  getServerUptime(): ServerUptimeSnapshot {
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(memory.heapTotal / 1024 / 1024);
    const heapPercent = Math.round((memory.heapUsed / memory.heapTotal) * 100);

    // Simple event loop lag measurement
    const start = process.hrtime.bigint();
    const eventLoopLagMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    // Active handles (approximate)
    const activeHandles = (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })
      ._getActiveHandles?.()?.length ?? 0;

    let status: ServerStatus = 'OPERATIONAL';
    if (
      heapPercent >= HEAP_DEGRADED_PERCENT ||
      eventLoopLagMs >= EVENT_LOOP_DEGRADED_MS ||
      activeHandles >= ACTIVE_HANDLES_DEGRADED
    ) {
      status = 'DEGRADED';
    }

    return {
      status,
      uptimeSeconds,
      uptimeFormatted: formatUptime(uptimeSeconds),
      heapUsedMb,
      heapTotalMb,
      heapPercent,
      eventLoopLagMs: Math.round(eventLoopLagMs * 100) / 100,
      activeHandles,
      lastCheckAt: new Date().toISOString(),
    };
  }

  async getFxProviderStatus(): Promise<FxProviderSnapshot[]> {
    try {
      const health = await this.fxAggregator.getProviderHealth();
      return health.map((h) => toFxProviderSnapshot(h));
    } catch {
      return [];
    }
  }

  /**
   * Probe all supplier providers for health/balance.
   * Called on init and can be triggered manually.
   */
  async probeSuppliers(): Promise<void> {
    this.lastProbeAt = new Date();

    for (const supplier of this.suppliers) {
      const snapshot = await this.probeOneSupplier(supplier);
      this.supplierSnapshots.set(supplier.key, snapshot);
    }
  }

  private async probeOneSupplier(supplier: SupplierProvider): Promise<SupplierSnapshot> {
    const base: SupplierSnapshot = {
      key: supplier.key,
      name: supplier.key, // SupplierProvider only has key
      status: 'UNKNOWN',
      balanceAmount: null,
      balanceCurrency: null,
      lastCheckAt: new Date().toISOString(),
      errorMessage: null,
    };

    // Try getBalance if available
    if (typeof supplier.getBalance === 'function') {
      try {
        const balance = await supplier.getBalance();
        return {
          ...base,
          status: 'HEALTHY',
          balanceAmount: balance.amount,
          balanceCurrency: balance.currency,
        };
      } catch (err) {
        return {
          ...base,
          status: 'OFFLINE',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }

    // No balance method — status unknown
    return { ...base, status: 'UNKNOWN' };
  }

  async getStuckOrders(): Promise<StuckOrder[]> {
    const now = new Date();
    const pendingThreshold = new Date(now.getTime() - STUCK_FULFILLMENT_PENDING_MINUTES * 60_000);
    const fulfillingThreshold = new Date(now.getTime() - STUCK_FULFILLING_MINUTES * 60_000);

    const orders = await this.database.order.findMany({
      where: {
        OR: [
          { status: 'PAID', paidAt: { lt: pendingThreshold } },
          { status: 'FULFILLMENT_PENDING', updatedAt: { lt: pendingThreshold } },
          { status: 'FULFILLING', updatedAt: { lt: fulfillingThreshold } },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paidAt: true,
        updatedAt: true,
        workItems: { select: { id: true }, take: 1 },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });

    return orders.map((order) => {
      const stuckSince = order.paidAt ?? order.updatedAt;
      const stuckMinutes = Math.floor((now.getTime() - stuckSince.getTime()) / 60_000);
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        stuckSince: stuckSince.toISOString(),
        stuckMinutes,
        hasWorkItem: order.workItems.length > 0,
      };
    });
  }
}

function toFxProviderSnapshot(health: FxProviderHealth): FxProviderSnapshot {
  let status: ProviderStatus = 'UNKNOWN';
  if (health.isHealthy) {
    status = 'HEALTHY';
  } else if (health.consecutiveFailures > 0) {
    status = health.consecutiveFailures >= 3 ? 'OFFLINE' : 'DEGRADED';
  }

  return {
    provider: health.provider,
    status,
    isHealthy: health.isHealthy,
    lastSuccessAt: health.lastSuccessAt,
    lastErrorAt: health.lastErrorAt,
    lastErrorCode: health.lastErrorCode ?? null,
    consecutiveFailures: health.consecutiveFailures,
  };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}
