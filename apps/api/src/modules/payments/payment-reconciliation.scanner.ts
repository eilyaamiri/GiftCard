import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { RIAL_PAYMENT_PROVIDER, type RialPaymentProvider } from '@barat/payments';

import {
  FULFILLMENT_REPAIR_AFTER_MS,
  PAYMENTS_DATABASE,
  PaymentsService,
  type PaymentDatabase,
} from './payments.service';

/** How often the scanner runs. */
export const RECONCILIATION_SWEEP_INTERVAL_MS = 2 * 60_000;

/**
 * A live session older than this is treated as abandoned and the gateway is
 * asked what became of it. Both gateways expire an unpaid session well inside
 * this, so a definite answer is available by then.
 */
export const ABANDONED_SESSION_AFTER_MS = 20 * 60_000;

/** An undecided payment is asked about again at most this often. */
export const RECHECK_INTERVAL_MS = 5 * 60_000;

/** After this the scanner stops asking; the open reconciliation issue remains. */
export const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60_000;

/** Bounded per category, so a backlog is paced rather than fired at the gateway at once. */
const BATCH_SIZE = 25;

/** Transient failures are noise; a run of them is an outage worth paging on. */
const ALERT_AFTER_FAILURES = 3;

interface Delegate {
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  findFirst(args: Record<string, unknown>): Promise<unknown>;
}

export interface ReconciliationSweepResult {
  readonly checked: number;
  readonly changed: number;
  readonly failed: number;
}

/**
 * Settles payments nobody comes back for (PAY-6, PAY-7, ORD-10).
 *
 * Until now an UNKNOWN or abandoned payment was looked at again only when the
 * customer's browser returned. This asks the gateway on its own, on the
 * controlled reconciliation path in `PaymentsService.reconcilePayment`:
 *
 *   - live sessions older than `ABANDONED_SESSION_AFTER_MS` — closing them frees
 *     the order's live slot, so the payment-window sweep can cancel an order
 *     its customer walked away from (ORD-10), or completes one they did pay;
 *   - UNKNOWN payments, which only this path may settle to PAID or FAILED;
 *   - uncommitted two-phase charges in REFUND_PENDING, closed as REFUNDED once
 *     the gateway has handed the money back;
 *   - PAID orders with no work item and no top-up record (PAY-7).
 *
 * Runs in the API process for the reason `OrderPaymentWindowService` does: no
 * worker service is installed on the production host. Two processes running it
 * at once are safe — each payment is processed under its verification lease,
 * and every write is a compare-and-set.
 */
@Injectable()
export class PaymentReconciliationScanner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentReconciliationScanner.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private consecutiveFailures = 0;

  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(PAYMENTS_DATABASE) private readonly db: PaymentDatabase,
    @Inject(RIAL_PAYMENT_PROVIDER) private readonly provider: RialPaymentProvider,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.runGuarded(), RECONCILIATION_SWEEP_INTERVAL_MS);
    /* Never hold the process open: shutdown should not wait on a sweep timer. */
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One pass. Public because it is the unit worth testing and a way to force a pass. */
  async sweepOnce(now: Date = new Date()): Promise<ReconciliationSweepResult> {
    if (this.inFlight) return { checked: 0, changed: 0, failed: 0 };
    this.inFlight = true;
    try {
      const ids = await this.candidates(now);
      let changed = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const result = await this.payments.reconcilePayment(id);
          if (result.changed) changed += 1;
        } catch {
          /* One payment's trouble (a held lease, a gateway error) must not stop
           * the rest of the pass. It is a candidate again next time. */
          failed += 1;
        }
      }
      if (changed > 0) this.logger.log(`Payment reconciliation settled ${changed} payment(s)`);
      this.consecutiveFailures = 0;
      return { checked: ids.length, changed, failed };
    } finally {
      this.inFlight = false;
    }
  }

  private async candidates(now: Date): Promise<string[]> {
    const payment = this.db.payment as Delegate;
    const select = { id: true };
    const provider = this.provider.name;

    const abandoned = await payment.findMany({
      where: {
        provider,
        status: { in: ['CREATED', 'REDIRECTED', 'PENDING'] },
        createdAt: { lt: new Date(now.getTime() - ABANDONED_SESSION_AFTER_MS) },
      },
      select,
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    const undecided = await payment.findMany({
      where: {
        provider,
        status: 'UNKNOWN',
        providerAuthority: { not: null },
        createdAt: { gt: new Date(now.getTime() - GIVE_UP_AFTER_MS) },
      },
      select,
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    /* Only a two-phase gateway hands an uncommitted charge back by itself. */
    const autoReturns =
      this.provider.confirmPayment === undefined
        ? []
        : await payment.findMany({
            where: {
              provider,
              status: 'REFUND_PENDING',
              refunds: { none: {} },
              createdAt: { gt: new Date(now.getTime() - GIVE_UP_AFTER_MS) },
            },
            select,
            orderBy: { createdAt: 'asc' },
            take: BATCH_SIZE,
          });

    const unstarted = await payment.findMany({
      where: {
        status: 'PAID',
        verifiedAt: {
          lt: new Date(now.getTime() - FULFILLMENT_REPAIR_AFTER_MS),
          gt: new Date(now.getTime() - 24 * 60 * 60_000),
        },
        order: { status: 'PAID', workItems: { none: {} }, topUpFulfillments: { none: {} } },
      },
      select,
      orderBy: { verifiedAt: 'asc' },
      take: BATCH_SIZE,
    });

    const due: string[] = [];
    for (const row of [...abandoned, ...undecided, ...autoReturns]) {
      const id = (row as { id: string }).id;
      if (await this.recentlyChecked(id, now)) continue;
      due.push(id);
    }
    for (const row of unstarted) due.push((row as { id: string }).id);
    return [...new Set(due)];
  }

  /** Whether the gateway was asked about this payment within `RECHECK_INTERVAL_MS`. */
  private async recentlyChecked(paymentId: string, now: Date): Promise<boolean> {
    const last = await (this.db.paymentAttempt as Delegate).findFirst({
      where: { paymentId, action: 'VERIFY' },
      orderBy: { createdAt: 'desc' },
    });
    const at = (last as { createdAt?: Date } | null)?.createdAt;
    return at instanceof Date && now.getTime() - at.getTime() < RECHECK_INTERVAL_MS;
  }

  /** The timer callback can never reject: an unhandled rejection would take the API down. */
  private async runGuarded(): Promise<void> {
    try {
      await this.sweepOnce();
    } catch (error) {
      this.consecutiveFailures += 1;
      const message = `Payment reconciliation sweep failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      if (this.consecutiveFailures >= ALERT_AFTER_FAILURES) {
        this.logger.error(`${message} (${this.consecutiveFailures} passes in a row)`);
      } else {
        this.logger.warn(message);
      }
    }
  }
}
