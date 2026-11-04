import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

// A VALUE import: Nest resolves the constructor parameter from emitted metadata,
// which a type-only import would erase. See `AutoFulfillmentService`.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AutoFulfillmentService } from './auto-fulfillment.service';

/** A venue can finish a gift card within about half a minute; look that often. */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * Drives the follow-up of gift-card purchases the supplier has accepted but not
 * finished. The database is the source of truth: a restart or a missed interval
 * is recovered by the next list of in-flight attempts. No supplier call is made
 * here; it all stays behind `AutoFulfillmentService` and the provider interface.
 */
@Injectable()
export class PendingPurchaseSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingPurchaseSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly autoFulfillment: AutoFulfillmentService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweepOnce(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One pass. Never rejects: a timer callback must not take the process down. */
  async sweepOnce(): Promise<{ readonly scanned: number; readonly delivered: number }> {
    if (this.inFlight) {
      return { scanned: 0, delivered: 0 };
    }
    this.inFlight = true;
    try {
      const { scanned, delivered } = await this.autoFulfillment.settlePendingPurchases();
      return { scanned, delivered };
    } catch {
      this.logger.warn('Pending gift-card sweep failed; the next pass retries');
      return { scanned: 0, delivered: 0 };
    } finally {
      this.inFlight = false;
    }
  }
}
