import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { PAYMENT_WINDOW_MS } from './order-payment-window';
import { OrdersService } from './orders.service';

/**
 * How often the sweep looks for orders whose payment window has closed.
 *
 * A minute is close enough that "cancelled after ten minutes" reads as true to
 * a customer watching the countdown, and far enough apart that the query — a
 * single indexed scan on `(status, createdAt)` — costs the database nothing on
 * a box that also serves every request.
 */
const SWEEP_INTERVAL_MS = 60_000;

/** Transient failures are noise; a run of them is an outage worth paging on. */
const ALERT_AFTER_FAILURES = 3;

/**
 * Closes orders nobody paid for.
 *
 * This runs inside the API process rather than in `apps/worker`, where the
 * other sweeps live, for a plain operational reason: no worker service is
 * installed on the production host, so a BullMQ job added there would never
 * run. It follows `FxRateRefresherService` instead — an unref'd interval owned
 * by the Nest lifecycle, guarded so that a slow pass cannot stack on itself and
 * a failed pass cannot take the process down.
 *
 * Correctness does not depend on this timer. `OrdersService.cancelExpiredOrders`
 * re-derives the whole candidate set from the database on every pass, so a
 * missed tick, a restart, or two instances running at once all converge on the
 * same result — the state machine's conditional update decides the winner.
 */
@Injectable()
export class OrderPaymentWindowService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OrderPaymentWindowService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private consecutiveFailures = 0;

  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  onApplicationBootstrap(): void {
    /* One pass immediately: a restart should not hand every order that expired
     * while the process was down another minute of life. */
    void this.runGuarded();
    this.timer = setInterval(() => void this.runGuarded(), SWEEP_INTERVAL_MS);
    /* Never hold the process open: shutdown should not wait on a sweep timer. */
    this.timer.unref();

    this.logger.log(
      `Unpaid orders are cancelled ${PAYMENT_WINDOW_MS / 60_000} minutes after they are placed ` +
        `(swept every ${SWEEP_INTERVAL_MS / 1_000}s)`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One sweep. Public because it is the whole unit of behaviour worth testing,
   * and because it gives an operator a way to force a pass.
   */
  async sweepOnce(): Promise<{ readonly scanned: number; readonly cancelled: number }> {
    if (this.inFlight) {
      /* A slow pass must not have another piled on top of it: both would read
       * the same candidates and race each other's transitions for no gain. */
      return { scanned: 0, cancelled: 0 };
    }
    this.inFlight = true;
    try {
      const result = await this.orders.cancelExpiredOrders();
      if (result.cancelled > 0) {
        this.logger.log(`Cancelled ${result.cancelled} order(s) past the payment window`);
      }
      if (this.consecutiveFailures >= ALERT_AFTER_FAILURES) {
        this.logger.log(
          `Order payment-window sweep recovered after ${this.consecutiveFailures} failed passes`,
        );
      }
      this.consecutiveFailures = 0;
      return result;
    } finally {
      this.inFlight = false;
    }
  }

  /** Failure counters, for an operator asking "is the sweep alive?". */
  get status(): { readonly consecutiveFailures: number } {
    return { consecutiveFailures: this.consecutiveFailures };
  }

  /**
   * The timer callback can never reject: an unhandled rejection here would take
   * the API down over a momentarily unavailable database.
   */
  private async runGuarded(): Promise<void> {
    try {
      await this.sweepOnce();
    } catch (error) {
      this.consecutiveFailures += 1;
      const message = `Order payment-window sweep failed: ${describe(error)}`;
      if (this.consecutiveFailures >= ALERT_AFTER_FAILURES) {
        this.logger.error(`${message} (${this.consecutiveFailures} passes in a row)`);
      } else {
        this.logger.warn(message);
      }
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
