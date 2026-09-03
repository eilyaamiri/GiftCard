import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { FxPair } from '@barat/contracts';

import { FxAggregatorService } from './fx-aggregator.service';
import {
  FX_REFRESH_CONFIG,
  type FxRefreshConfig,
  type FxRefreshOutcome,
} from './fx.types';

/** Below this the poller would spend its life waiting on its own HTTP calls. */
const MIN_INTERVAL_MS = 10_000;
/** Transient failures are noise; a run of them is an outage worth paging on. */
const ALERT_AFTER_FAILURES = 3;

const NOTHING: FxRefreshOutcome = { refreshed: [], failed: [], skipped: true };

/**
 * Keeps the market rate current on a timer instead of on customer traffic.
 *
 * Without this, an FX observation is only ever recorded when someone asks for a
 * quote: on a quiet night the newest row in `FxRate` is hours old, the admin
 * dashboard shows a stale rate, and the first customer of the morning pays the
 * latency of a cold provider call. Polling makes the recorded rate a continuous
 * series that tracks the USDT/IRR market on its own.
 *
 * It deliberately reuses `getRateSnapshot` rather than calling a provider
 * directly, so the poller obeys the same policy a quote does — primary first,
 * secondary on failure, and every observation persisted before use. There is
 * one behaviour worth naming: the aggregator's own fallback order means a
 * failed primary silently becomes a secondary rate here too, which is correct,
 * and the provider name on each row records which one answered.
 *
 * This is a read-and-record loop. It never sets a rate, never touches a manual
 * override, and cannot change what a quote is priced at beyond supplying the
 * market observation the pricing engine already asks for.
 */
@Injectable()
export class FxRateRefresherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FxRateRefresherService.name);
  private readonly config: FxRefreshConfig;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private consecutiveFailures = 0;

  constructor(
    @Inject(FxAggregatorService) private readonly aggregator: FxAggregatorService,
    @Inject(FX_REFRESH_CONFIG) config: FxRefreshConfig,
  ) {
    if (!Number.isSafeInteger(config.intervalMs) || config.intervalMs < MIN_INTERVAL_MS) {
      throw new RangeError(`FX refresh interval must be at least ${MIN_INTERVAL_MS / 1_000}s`);
    }
    /*
     * A slower poll than the stale window is not a tuning choice, it is a
     * broken configuration: the rate would age out before its replacement
     * arrived and quoting would fail on a schedule.
     */
    if (config.intervalMs > config.staleThresholdMs) {
      throw new RangeError(
        'FX refresh interval must not exceed FX_STALE_THRESHOLD_SECONDS — the automatic rate ' +
          'would go stale between polls',
      );
    }
    if (config.pairs.length === 0) {
      throw new RangeError('FX refresh needs at least one pair');
    }
    this.config = config;
  }

  onApplicationBootstrap(): void {
    if (!this.config.enabled) {
      this.logger.warn('FX auto-refresh is disabled; rates update only when a quote asks for one');
      return;
    }

    /*
     * One cycle immediately, so a freshly deployed instance has a current rate
     * before the first customer arrives rather than one interval later.
     */
    void this.runGuarded();
    this.timer = setInterval(() => void this.runGuarded(), this.config.intervalMs);
    /* Never hold the process open: shutdown should not wait on a poll timer. */
    this.timer.unref();

    this.logger.log(
      `FX auto-refresh every ${this.config.intervalMs / 1_000}s for ${this.config.pairs.join(', ')}`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One polling cycle. Public because it is the whole unit of behaviour worth
   * testing, and because it gives an operator a way to force a refresh.
   *
   * Each pair is attempted independently: one venue refusing to price EUR must
   * not stop USD from being refreshed.
   */
  async refreshOnce(): Promise<FxRefreshOutcome> {
    if (this.inFlight) {
      /* A slow provider must not pile cycles on top of each other. */
      return NOTHING;
    }
    this.inFlight = true;
    const refreshed: FxPair[] = [];
    const failed: FxPair[] = [];

    try {
      for (const pair of this.config.pairs) {
        try {
          const snapshot = await this.aggregator.getRateSnapshot(pair);
          refreshed.push(pair);
          this.logger.debug(
            `${pair} = ${snapshot.midRate} from ${snapshot.provider} (${snapshot.source})`,
          );
        } catch (error) {
          failed.push(pair);
          this.report(pair, error);
        }
      }
    } finally {
      this.inFlight = false;
    }

    if (failed.length === 0) {
      if (this.consecutiveFailures >= ALERT_AFTER_FAILURES) {
        this.logger.log(`FX auto-refresh recovered after ${this.consecutiveFailures} failed cycles`);
      }
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
    }

    return { refreshed, failed, skipped: false };
  }

  /** Failure counters and health, for an operator asking "is polling alive?". */
  get status(): { readonly enabled: boolean; readonly consecutiveFailures: number } {
    return { enabled: this.config.enabled, consecutiveFailures: this.consecutiveFailures };
  }

  /**
   * The timer callback can never reject: an unhandled rejection here would take
   * the process down over a temporarily unreachable exchange.
   */
  private async runGuarded(): Promise<void> {
    try {
      await this.refreshOnce();
    } catch (error) {
      this.logger.error(`FX auto-refresh cycle failed: ${describe(error)}`);
    }
  }

  private report(pair: FxPair, error: unknown): void {
    const message = `FX auto-refresh could not obtain ${pair}: ${describe(error)}`;
    /*
     * `consecutiveFailures` has not been incremented for this cycle yet, so the
     * comparison is against the runs that came before it.
     */
    if (this.consecutiveFailures + 1 >= ALERT_AFTER_FAILURES) {
      this.logger.error(`${message} (${this.consecutiveFailures + 1} cycles in a row)`);
    } else {
      this.logger.warn(message);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
