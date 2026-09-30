import {
  Injectable,
  Inject,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TopUpFulfillmentService } from './topup-fulfillment.service';
import { TOP_UP_STORE } from './suppliers.types';
import type { TopUpStore } from './suppliers.types';

const SWEEP_INTERVAL_MS = 60_000;
const ALERT_AFTER_FAILURES = 3;

/**
 * Drives direct-top-up retries in the API process. The database remains the
 * source of truth: a restart or a missed interval is recovered by listDue().
 * No supplier call is made here; all provider interaction stays behind the
 * fulfillment service and its provider interface.
 */
@Injectable()
export class TopUpSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TopUpSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private consecutiveFailures = 0;

  constructor(
    @Inject(TOP_UP_STORE) private readonly store: TopUpStore,
    private readonly fulfillment: TopUpFulfillmentService,
  ) {}

  onApplicationBootstrap(): void {
    void this.runGuarded();
    this.timer = setInterval(() => void this.runGuarded(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sweepOnce(): Promise<{ readonly scanned: number; readonly completed: number }> {
    if (this.inFlight) {
      return { scanned: 0, completed: 0 };
    }
    this.inFlight = true;
    try {
      const due = await this.store.listDue();
      let completed = 0;
      let failedItems = 0;
      for (const item of due) {
        try {
          const outcome =
            item.action === 'POLL'
              ? await this.fulfillment.poll(item.orderId)
              : await this.fulfillment.onTopUpOrderPaid(item.orderId);
          if (outcome.decision !== 'AWAITING_PROVIDER' && outcome.decision !== 'WAITING_FUNDS') {
            completed += 1;
          }
        } catch {
          /* The pass continues for other orders. This is visible through the
           * counter and warning below; the next pass retries the failed order. */
          failedItems += 1;
        }
      }
      if (failedItems > 0) {
        this.consecutiveFailures += 1;
        this.logger.warn(
          `Top-up sweep encountered ${failedItems} failed order attempt(s)`,
        );
      } else {
        this.consecutiveFailures = 0;
      }
      return { scanned: due.length, completed };
    } catch {
      this.consecutiveFailures += 1;
      this.logger.error(
        `Top-up sweep failed (${this.consecutiveFailures} consecutive failure pass(es))`,
      );
      throw new Error('top-up sweep failed');
    } finally {
      this.inFlight = false;
    }
  }

  get status(): { readonly consecutiveFailures: number } {
    return { consecutiveFailures: this.consecutiveFailures };
  }

  private async runGuarded(): Promise<void> {
    try {
      await this.sweepOnce();
    } catch {
      /* The failure was recorded by sweepOnce; timer callbacks never reject. */
      if (this.consecutiveFailures >= ALERT_AFTER_FAILURES) {
        this.logger.error(
          `Top-up sweep remains unavailable after ${this.consecutiveFailures} failures`,
        );
      }
    }
  }
}
