import type {
  TopUpEventRecord,
  TopUpFulfillmentStatus,
  TopUpStore,
  TopUpTarget,
} from '../suppliers.types';

/** One step, as the assertions read it. */
export interface RecordedTopUpEvent {
  readonly fulfillmentId: string;
  readonly orderId: string;
  readonly status: TopUpFulfillmentStatus;
  readonly event: TopUpEventRecord;
}

export interface InMemoryTopUpOptions {
  readonly targets?: readonly TopUpTarget[];
  /** Orders the store knows about, for `transitionOrder`'s guard. */
  readonly orderStatuses?: Readonly<Record<string, string>>;
}

/**
 * The top-up port, in memory.
 *
 * It exists for one assertion above all others: that a purchase which succeeds,
 * pends, fails, or goes ambiguous leaves the work-item store untouched. So this
 * double is deliberately *not* free-form — every method records what it was
 * asked to do and refuses transitions the real conditional `updateMany` would
 * refuse, because a double that is more permissive than production turns a
 * passing test into a false one.
 */
export class InMemoryTopUpStore implements TopUpStore {
  private readonly targets = new Map<string, TopUpTarget>();
  private readonly orderStatuses = new Map<string, string>();
  private readonly statuses = new Map<string, TopUpFulfillmentStatus>();
  /** Append-only in the same sense the real table is: nothing is ever rewritten. */
  readonly events: RecordedTopUpEvent[] = [];
  /** Every `transitionOrder` call, successful or not. */
  readonly orderTransitions: { orderId: string; from: readonly string[]; to: string }[] = [];

  constructor(options: InMemoryTopUpOptions = {}) {
    for (const target of options.targets ?? []) {
      this.targets.set(target.orderId, target);
      this.statuses.set(target.fulfillmentId, target.status);
    }
    for (const [orderId, status] of Object.entries(options.orderStatuses ?? {})) {
      this.orderStatuses.set(orderId, status);
    }
  }

  /** The status the service left the fulfillment in, for direct assertions. */
  statusOf(fulfillmentId: string): TopUpFulfillmentStatus | undefined {
    return this.statuses.get(fulfillmentId);
  }

  async ensureFulfillmentForPaidOrder(orderId: string): Promise<TopUpTarget | null> {
    return this.findTargetByOrderId(orderId);
  }

  async findTargetByOrderId(orderId: string): Promise<TopUpTarget | null> {
    const target = this.targets.get(orderId);
    if (target === undefined) {
      return null;
    }
    // The live status, not the seeded one: a second attempt must see what the
    // first one did, exactly as a re-read of the row would.
    return { ...target, status: this.statuses.get(target.fulfillmentId) ?? target.status };
  }

  async listDue(): Promise<readonly { orderId: string; action: 'START' | 'POLL' }[]> {
    return [...this.targets.values()]
      .filter((target) => {
        const status = this.statuses.get(target.fulfillmentId) ?? target.status;
        return status === 'WAITING_FUNDS' || status === 'AWAITING_PROVIDER' || status === 'PURCHASING';
      })
      .map((target) => ({
        orderId: target.orderId,
        action:
          (this.statuses.get(target.fulfillmentId) ?? target.status) === 'WAITING_FUNDS'
            ? 'START'
            : 'POLL',
      }));
  }

  async countConsecutiveUnreachablePolls(fulfillmentId: string): Promise<number> {
    let count = 0;
    for (const row of [...this.events].reverse()) {
      if (row.fulfillmentId !== fulfillmentId || row.event.type !== 'STATUS_POLLED') {
        continue;
      }
      if (row.event.detail?.['reachable'] !== false) {
        break;
      }
      count += 1;
    }
    return count;
  }

  async transition(input: {
    fulfillmentId: string;
    from: readonly TopUpFulfillmentStatus[];
    to: TopUpFulfillmentStatus;
    event: TopUpEventRecord;
    providerOrderNumber?: string | null;
    providerStatus?: string | null;
    failureCode?: string | null;
    chargedAmount?: string | null;
    chargedCurrency?: string | null;
    nextCheckAt?: Date | null;
    incrementPurchaseAttempts?: boolean;
    completedAt?: Date | null;
  }): Promise<boolean> {
    const current = this.statuses.get(input.fulfillmentId);
    if (current === undefined || !input.from.includes(current)) {
      // The compare-and-set lost. No row moves, so no event is written — the
      // real store writes the event inside the same transaction.
      return false;
    }
    this.statuses.set(input.fulfillmentId, input.to);
    const target = [...this.targets.values()].find((it) => it.fulfillmentId === input.fulfillmentId);
    this.events.push({
      fulfillmentId: input.fulfillmentId,
      orderId: target?.orderId ?? '',
      status: input.to,
      event: input.event,
    });
    return true;
  }

  async recordEvent(input: {
    fulfillmentId: string;
    orderId: string;
    status: TopUpFulfillmentStatus;
    event: TopUpEventRecord;
  }): Promise<void> {
    this.events.push({ ...input });
  }

  async transitionOrder(input: {
    orderId: string;
    from: readonly string[];
    to: string;
    failureReason?: string | null;
  }): Promise<boolean> {
    this.orderTransitions.push({ orderId: input.orderId, from: input.from, to: input.to });
    const current = this.orderStatuses.get(input.orderId);
    if (current === undefined || !input.from.includes(current)) {
      return false;
    }
    this.orderStatuses.set(input.orderId, input.to);
    return true;
  }
}
