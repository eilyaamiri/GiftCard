import { monitorEventLoopDelay } from 'node:perf_hooks';

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { SupplierProvider } from '@barat/suppliers';
import { SUPPLIER_PROVIDERS } from '@barat/suppliers';
import type { FxProviderHealth } from '@barat/contracts';

import { AlertLogger } from '../../common/alert';
import { AppConfigService } from '../../common/config/app-config.service';
import { FxAggregatorService } from '../fx/fx-aggregator.service';
import type { MonitoringDatabase } from './monitoring.tokens';
import { MONITORING_DATABASE } from './monitoring.tokens';
import {
  derivePaymentGatewayStatus,
  GATEWAY_ACTIONS,
  PAYMENT_WINDOW_MINUTES,
  type PaymentGatewaySnapshot,
} from './payment-gateway-status';

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

export interface RecentAlert {
  severity: string;
  source: string;
  message: string;
  /** Already redacted by AlertLogger. */
  context: Record<string, unknown> | null;
  at: string;
}

export interface MonitoringSnapshot {
  server: ServerUptimeSnapshot;
  fxProviders: FxProviderSnapshot[];
  suppliers: SupplierSnapshot[];
  paymentGateways: PaymentGatewaySnapshot[];
  stuckOrders: StuckOrder[];
  recentAlerts: RecentAlert[];
  generatedAt: string;
}

/** How many alerts the dashboard shows. */
const RECENT_ALERTS_SHOWN = 20;

/** Thresholds from the plan. */
const STUCK_FULFILLMENT_PENDING_MINUTES = 15;
const STUCK_FULFILLING_MINUTES = 10;

/** Degradation thresholds. */
const HEAP_DEGRADED_PERCENT = 80;
const EVENT_LOOP_DEGRADED_MS = 500;
const ACTIVE_HANDLES_DEGRADED = 10_000;

/** Decided with the product owner: a fixed five-minute supplier probe. */
export const SUPPLIER_PROBE_INTERVAL_MS = 5 * 60_000;

/**
 * Failed probes in a row before a supplier counts as "connection lost".
 *
 * Two consecutive failures five minutes apart is the ">5 min unreachable"
 * trigger agreed for Telegram. A single failed probe is usually a blip and is
 * only logged, so the ops channel is not paged for a timeout that healed itself.
 */
const OFFLINE_ALERT_AFTER_FAILURES = 2;

@Injectable()
export class MonitoringService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MonitoringService.name);

  /** In-memory supplier probe results. */
  private supplierSnapshots: Map<string, SupplierSnapshot> = new Map();
  private readonly failureStreaks = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  /**
   * Event-loop delay, sampled continuously.
   *
   * Lag cannot be measured by timing synchronous code: two back-to-back clock
   * reads are always ~0ms apart. The histogram records how late the loop's own
   * timers actually fire, which is what a blocked loop looks like.
   */
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 20 });

  constructor(
    @Inject(FxAggregatorService) private readonly fxAggregator: FxAggregatorService,
    @Inject(SUPPLIER_PROVIDERS) private readonly suppliers: readonly SupplierProvider[],
    @Inject(MONITORING_DATABASE) private readonly database: MonitoringDatabase,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Optional() @Inject(AlertLogger) private readonly alerts?: AlertLogger,
  ) {}

  onApplicationBootstrap(): void {
    /* Never under test: a live timer would let a real supplier call land in the
     * middle of another test's assertions, exactly as the FX refresher avoids. */
    if (this.config.isTest) {
      return;
    }

    this.loopDelay.enable();

    /* One probe now, so a fresh deploy shows supplier status immediately rather
     * than an empty table for the first five minutes. */
    void this.probeGuarded();
    this.timer = setInterval(() => void this.probeGuarded(), SUPPLIER_PROBE_INTERVAL_MS);
    /* Never hold the process open: shutdown should not wait on a probe timer. */
    this.timer.unref();

    this.logger.log(
      `Supplier probe every ${SUPPLIER_PROBE_INTERVAL_MS / 60_000} min for ${this.suppliers.length} adapter(s)`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.loopDelay.disable();
  }

  async getSnapshot(): Promise<MonitoringSnapshot> {
    const [server, fxProviders, paymentGateways, stuckOrders] = await Promise.all([
      this.getServerUptime(),
      this.getFxProviderStatus(),
      this.getPaymentGatewayStatus(),
      this.getStuckOrders(),
    ]);

    return {
      server,
      fxProviders,
      suppliers: [...this.supplierSnapshots.values()],
      paymentGateways,
      stuckOrders,
      recentAlerts: this.getRecentAlerts(),
      generatedAt: new Date().toISOString(),
    };
  }

  getRecentAlerts(): RecentAlert[] {
    return (this.alerts?.recent(RECENT_ALERTS_SHOWN) ?? []).map((alert) => ({
      severity: alert.severity,
      source: alert.source,
      message: alert.message,
      context: alert.context,
      at: alert.at.toISOString(),
    }));
  }

  /**
   * Gateway status from the attempts our server made in the last hour.
   * Selects status, time and provider only — never a payload or a message.
   */
  async getPaymentGatewayStatus(): Promise<PaymentGatewaySnapshot[]> {
    const since = new Date(Date.now() - PAYMENT_WINDOW_MINUTES * 60_000);
    const rows = await this.database.paymentAttempt.findMany({
      where: { createdAt: { gte: since }, action: { in: [...GATEWAY_ACTIONS] } },
      select: { status: true, createdAt: true, payment: { select: { provider: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return derivePaymentGatewayStatus(rows);
  }

  getServerUptime(): ServerUptimeSnapshot {
    const uptimeSeconds = Math.floor(process.uptime());
    const memory = process.memoryUsage();
    const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(memory.heapTotal / 1024 / 1024);
    const heapPercent = Math.round((memory.heapUsed / memory.heapTotal) * 100);

    // Mean timer delay since the last read, then start a fresh window.
    const eventLoopLagMs = Number.isNaN(this.loopDelay.mean) ? 0 : this.loopDelay.mean / 1_000_000;
    this.loopDelay.reset();

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
   * Probe every supplier adapter once. Runs on the five-minute timer and from
   * `POST /admin/monitoring/probe`.
   *
   * A probe already running is not stacked on: a slow supplier must not pile
   * cycles on top of each other, which would also multiply its rate-limit hits.
   */
  async probeSuppliers(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      for (const supplier of this.suppliers) {
        const snapshot = await this.probeOneSupplier(supplier);
        this.supplierSnapshots.set(supplier.key, snapshot);
        this.reportProbe(snapshot);
      }
    } finally {
      this.inFlight = false;
    }
  }

  /** The timer callback can never reject: that would take the process down. */
  private async probeGuarded(): Promise<void> {
    try {
      await this.probeSuppliers();
    } catch (error) {
      this.logger.error(
        `Supplier probe cycle failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    /* Separate try: a supplier failure must not skip the gateway check, and the
     * other way round. */
    try {
      await this.checkPaymentGateways();
    } catch (error) {
      this.logger.error(
        `Payment gateway check failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  /** Last judged status per gateway, so only transitions raise alerts. */
  private readonly gatewayStatus = new Map<string, ProviderStatus>();

  /**
   * Runs on the same five-minute cycle as the supplier probe — reading our own
   * rows, never calling the gateway — so an outage pages even when nobody has
   * the dashboard open. ERROR (→ Telegram) on entering OFFLINE, INFO on leaving it.
   */
  async checkPaymentGateways(): Promise<void> {
    const gateways = await this.getPaymentGatewayStatus();
    for (const gateway of gateways) {
      const previous = this.gatewayStatus.get(gateway.provider) ?? 'HEALTHY';
      this.gatewayStatus.set(gateway.provider, gateway.status);
      if (gateway.status === previous) continue;

      if (gateway.status === 'OFFLINE') {
        this.alerts?.log({
          severity: 'ERROR',
          source: 'PAYMENT',
          message: `Payment gateway ${gateway.provider} connection lost`,
          context: {
            gateway: gateway.provider,
            connectionFailures: gateway.connectionFailures,
            calls: gateway.calls,
          },
        });
      } else if (previous === 'OFFLINE') {
        /* Checked before DEGRADED: right after an outage the hour still holds
         * the failures, so a gateway that is answering again usually reads as
         * DEGRADED first. Leaving OFFLINE is the news, whatever follows. */
        this.alerts?.log({
          severity: 'INFO',
          source: 'PAYMENT',
          message: `Payment gateway ${gateway.provider} is answering again`,
          context: { gateway: gateway.provider },
        });
      } else if (gateway.status === 'DEGRADED') {
        this.alerts?.log({
          severity: 'WARNING',
          source: 'PAYMENT',
          message: `Payment gateway ${gateway.provider} is failing intermittently`,
          context: { gateway: gateway.provider, connectionFailures: gateway.connectionFailures },
        });
      }
    }
  }

  /**
   * Turn probe results into alerts on state CHANGES only.
   *
   * Alerting on every failed probe would send the same message every five
   * minutes for as long as an outage lasts. Instead: one console warning on the
   * first failure, one ERROR (→ Telegram) once the streak reaches the offline
   * threshold, and one INFO when the supplier answers again.
   */
  private reportProbe(snapshot: SupplierSnapshot): void {
    const previous = this.failureStreaks.get(snapshot.key) ?? 0;

    if (snapshot.status !== 'OFFLINE') {
      if (previous >= OFFLINE_ALERT_AFTER_FAILURES) {
        this.alerts?.log({
          severity: 'INFO',
          source: 'SUPPLIER',
          message: `Supplier ${snapshot.key} is reachable again`,
          context: { supplier: snapshot.key, failedProbes: previous },
        });
      }
      this.failureStreaks.set(snapshot.key, 0);
      return;
    }

    const streak = previous + 1;
    this.failureStreaks.set(snapshot.key, streak);

    if (streak === 1) {
      this.alerts?.log({
        severity: 'WARNING',
        source: 'SUPPLIER',
        message: `Supplier ${snapshot.key} did not answer a health probe`,
        context: { supplier: snapshot.key },
      });
    } else if (streak === OFFLINE_ALERT_AFTER_FAILURES) {
      this.alerts?.log({
        severity: 'ERROR',
        source: 'SUPPLIER',
        message: `Supplier ${snapshot.key} connection lost (${streak} failed probes, >5 min)`,
        context: { supplier: snapshot.key, failedProbes: streak },
      });
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
      } catch {
        /* A fixed code, never the provider's error text: an adapter error can
         * carry a raw response body, and this field is shown in the admin UI. */
        return { ...base, status: 'OFFLINE', errorMessage: 'BALANCE_READ_FAILED' };
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
