import { Inject, Injectable, Logger } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { DELIVERABLE_ORDER_STATUSES } from '../fulfillment/checklist-evaluation';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { WorkItemsService } from '../workitems/workitems.service';
import type {
  FulfillmentTrigger,
  FulfillmentTriggerInput,
  WorkItemSummary,
} from '../workitems/workitems.types';
import { SuppliersService } from './suppliers.service';
/*
 * A VALUE import, and the lint rule below is disabled on purpose.
 *
 * Nest resolves constructor parameters through `design:paramtypes` metadata,
 * which the compiler erases for a type-only import — the parameter then arrives
 * as `undefined` and the module fails to boot with a dependency-resolution
 * error that names the index rather than the import. `consistent-type-imports`
 * sees the class used only as a type and asks for `import type`; the DI
 * container is the reason it cannot be one. `OrdersService`-style services
 * elsewhere in this codebase are in the same position.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TopUpFulfillmentService } from './topup-fulfillment.service';
import type { AutoFulfillmentTarget } from './suppliers.types';

/**
 * Why an attempt ended the way it did.
 *
 * Everything except `FULFILLED` means the same thing operationally: the work item
 * stays where it is and a person deals with it. They are kept apart anyway,
 * because "the supplier float is empty" and "the supplier said something we did
 * not understand" need very different responses from whoever is on shift.
 */
export type AutoFulfillmentDecision =
  /** Bought, delivered, and (for a paid order) the task was closed. */
  | 'FULFILLED'
  /** Bought and stored; the operator still owns the delivery. */
  | 'PURCHASED'
  /** Never a candidate: wrong type, already has an asset, someone owns it. */
  | 'NOT_ELIGIBLE'
  /** The prepaid float cannot cover this purchase, or could not be read. */
  | 'INSUFFICIENT_FUNDS'
  /** No offer, no adapter, or nothing in stock. */
  | 'SUPPLIER_UNAVAILABLE'
  /** The purchase did not come back SUCCEEDED. Never retried here. */
  | 'PURCHASE_NOT_COMPLETED'
  /** Bought and stored, but the send gate refused. The asset is kept. */
  | 'DELIVERY_BLOCKED';

export interface AutoFulfillmentOutcome {
  readonly decision: AutoFulfillmentDecision;
  readonly workItemId: string;
  /** Set once an asset exists, whatever happened afterwards. */
  readonly assetId: string | null;
  /** A non-secret code naming the specific branch. Never a provider payload. */
  readonly reason: string;
}

/** The audit actor for everything this service does. */
export const AUTO_FULFILLMENT_ACTOR = 'system:auto-fulfillment';

export const AUTO_FULFILLMENT_AUDIT_ACTION = 'AUTO_FULFILLMENT_ATTEMPTED';

/**
 * Only single-card gift-card orders are bought automatically.
 *
 * A quantity above one would need the supplier to return exactly that many cards
 * and every one of them stored; the adapters refuse an unexpected count rather
 * than guess, so the honest thing is to leave those orders to an operator.
 */
const AUTOMATABLE_QUANTITY = 1;

const AUTOMATABLE_WORK_ITEM_TYPE = 'MANUAL_GIFT_CARD_FULFILLMENT';

function notEligible(workItemId: string, reason: string): AutoFulfillmentOutcome {
  return { decision: 'NOT_ELIGIBLE', workItemId, assetId: null, reason };
}

/**
 * The placeholder a top-up order returns to the payment callback.
 *
 * A top-up creates no work item, but `FulfillmentTrigger.onOrderPaid` promises
 * one — a promise made for gift cards, where an operator task is the point. The
 * two honest options are an empty optional or a value that is obviously not a
 * task; the contract cannot yet express the first, and an exception in a
 * payment callback would be worse than either.
 *
 * So this is a fiction with a non-id prefix that cannot be mistaken for a real
 * work item id (`WI-…`), and a queue key that no operator queue uses. Nothing
 * persists it. The callers in the payments module discard the return value
 * entirely; it exists so the type stays honest about what it does *not*
 * represent rather than pretending an order was assigned to someone.
 */
function topUpTriggerSummary(orderId: string, customerId: string | null): WorkItemSummary {
  const syntheticId = `topup-trigger:${orderId}`;
  return {
    id: syntheticId,
    code: syntheticId,
    orderId,
    customerId,
    queueKey: 'UNKNOWN_OUTCOME',
    type: 'UNKNOWN_OUTCOME',
    status: 'COMPLETED',
    priority: 100,
    assignedToStaffId: null,
    assignedToStaffName: null,
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    dueAt: null,
    slaBreachedAt: null,
    title: 'شارژ مستقیم (خودکار)',
    description: null,
    createdAt: new Date(),
  };
}

/**
 * Buys a gift card by itself when the supplier account can pay for it, and hands
 * the work to an operator when it cannot.
 *
 * It is the `FULFILLMENT_TRIGGER` the payments module calls, wrapping — never
 * replacing — `WorkItemsService.onOrderPaid`. The work item is created first and
 * unconditionally, before a single supplier call. That ordering is the whole
 * safety story: if the supplier is empty, slow, or this process dies halfway
 * through the purchase, the task already exists, is unassigned, and an operator
 * picks it up. Automation can only ever take work *away* from the queue.
 */
@Injectable()
export class AutoFulfillmentService implements FulfillmentTrigger {
  private readonly logger = new Logger(AutoFulfillmentService.name);
  constructor(
    @Inject(WorkItemsService) private readonly workItems: WorkItemsService,
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(AuditService) private readonly audit: AuditService,
    /**
     * The automated top-up path.
     *
     * The dependency runs one way — suppliers → top-up service → work items —
     * exactly like the `SuppliersService` edge above, so there is no cycle. It
     * is injected as the concrete class rather than through a token because,
     * unlike a provider adapter, there is only ever one of it.
     */
    private readonly topUps: TopUpFulfillmentService,
  ) {}

  /**
   * The port a verified payment calls.
   *
   * The purchase runs detached on purpose. This method is awaited inside a
   * payment-gateway callback, and a supplier round-trip can take tens of seconds;
   * blocking the callback that long risks the gateway retrying or timing out a
   * payment that already succeeded. The caller gets its work item immediately,
   * and the attempt either upgrades the outcome or leaves the queue untouched.
   */
  async onOrderPaid(input: FulfillmentTriggerInput): Promise<WorkItemSummary> {
    /*
     * Direct top-ups take the automated path and NEVER create a work item here.
     *
     * This check has to happen first, before `workItems.onOrderPaid`, because
     * that call is what creates the task — and a top-up order would land in the
     * gift-card queue as MANUAL_GIFT_CARD_FULFILLMENT, handing an operator work
     * that needs no human at all. That is exactly what the product owner
     * forbade, and it is not something a later step could undo: once the task
     * exists it is in someone's queue.
     *
     * The returned summary is synthetic and never persisted. Its only job is to
     * satisfy the `FulfillmentTrigger` contract, whose callers are payment code
     * that discards the value. The real record lives in `TopUpFulfillment` /
     * `TopUpEvent`, and the one task that MAY be created for a top-up is raised
     * later by `TopUpFulfillmentService`, only on a genuine failure.
     */
    if ((await this.workItems.quoteTargetForOrder(input.orderId)) === 'TOP_UP') {
      void this.topUps.onTopUpOrderPaid(input.orderId).catch(() => {
        /* The scheduler re-derives missing/due rows. Make the detached failure
         * observable without ever logging provider error payloads. */
        this.logger.warn('Top-up paid trigger failed; deferred to the retry sweep');
      });
      return topUpTriggerSummary(input.orderId, input.customerId ?? null);
    }

    const item = await this.workItems.onOrderPaid(input);

    void this.attemptForPaidOrder(item.id).catch(() => {
      // An attempt that throws has already left the work item unassigned and
      // claimable, which is the fallback this whole design is built around. The
      // error is swallowed rather than logged: it may carry a provider payload.
    });

    return item;
  }

  /**
   * Buy, deliver to the customer's order page, and close the task.
   *
   * Public so tests can drive it without a timer, and so an operations tool can
   * re-run it for an order that was left behind.
   */
  async attemptForPaidOrder(workItemId: string): Promise<AutoFulfillmentOutcome> {
    const target = await this.suppliers.findAutoFulfillmentTarget(workItemId);
    if (target === null) {
      return this.record(notEligible(workItemId, 'TARGET_NOT_FOUND'));
    }

    // An assigned item belongs to a person. Automation does not compete with them.
    if (target.workItemStatus !== 'UNASSIGNED' || target.assignedToStaffId !== null) {
      return this.record(notEligible(workItemId, 'WORK_ITEM_CLAIMED'));
    }

    const bought = await this.buy(target);
    if (bought.assetId === null) {
      return this.record(bought);
    }

    return this.record(await this.deliverAndClose(target, bought.assetId));
  }

  /**
   * Buy for a work item an operator is already holding.
   *
   * The operator asked admin for a code; this tries the supplier first so the
   * request only reaches a human when the float cannot pay for it. Delivery is
   * deliberately not performed: the operator owns this item, and taking the send
   * decision away from them mid-task is not automation, it is interference.
   */
  async attemptForOperatorRequest(input: {
    workItemId: string;
    staffId: string;
  }): Promise<AutoFulfillmentOutcome> {
    const target = await this.suppliers.findAutoFulfillmentTarget(input.workItemId);
    if (target === null) {
      return this.record(notEligible(input.workItemId, 'TARGET_NOT_FOUND'));
    }

    if (target.assignedToStaffId !== input.staffId) {
      return this.record(notEligible(input.workItemId, 'WORK_ITEM_NOT_HELD_BY_REQUESTER'));
    }

    const bought = await this.buy(target);
    if (bought.assetId === null) {
      return this.record(bought);
    }

    return this.record({
      decision: 'PURCHASED',
      workItemId: target.workItemId,
      assetId: bought.assetId,
      reason: 'SUPPLIER_PURCHASE_SUCCEEDED',
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * The shared purchase path: eligibility, offer, funding, purchase, checklist.
   *
   * Returns an outcome whose `assetId` is `null` for every branch that must fall
   * back to a human, so a caller cannot mistake "we stopped early" for "we own a
   * card now". None of these branches throws — a purchase we chose not to make
   * is a normal outcome, not an error.
   */
  private async buy(target: AutoFulfillmentTarget): Promise<AutoFulfillmentOutcome> {
    const ineligible = this.checkEligibility(target);
    if (ineligible !== null) {
      return ineligible;
    }

    // Non-null: `checkEligibility` rejects a service order.
    const skuId = target.skuId as string;

    let offerId: string;
    let supplierCode: string;
    try {
      const offer = await this.suppliers.selectOffer(skuId);
      offerId = offer.id;
      supplierCode = offer.supplierCode;
    } catch {
      return {
        decision: 'SUPPLIER_UNAVAILABLE',
        workItemId: target.workItemId,
        assetId: null,
        reason: 'NO_AVAILABLE_OFFER',
      };
    }

    if (!this.suppliers.hasProvider(supplierCode)) {
      // A manual supplier won the selection. There is nothing to call.
      return {
        decision: 'SUPPLIER_UNAVAILABLE',
        workItemId: target.workItemId,
        assetId: null,
        reason: 'SUPPLIER_HAS_NO_ADAPTER',
      };
    }

    const funding = await this.suppliers.checkFunding({ offerId, quantity: target.quantity });
    if (funding.state !== 'SUFFICIENT') {
      // The empty-float case the operator queue exists for. No purchase attempt
      // is made at all, so an empty account can never become a half-placed order.
      return {
        decision: 'INSUFFICIENT_FUNDS',
        workItemId: target.workItemId,
        assetId: null,
        reason: `FUNDING_${funding.state}`,
      };
    }

    const outcome = await this.suppliers.purchase({
      orderId: target.orderId,
      customerId: target.customerId,
      workItemId: target.workItemId,
      offerId,
      quantity: target.quantity,
      // Derived from the order, so a second attempt for the same order reaches
      // the supplier as the same request rather than as a second purchase.
      idempotencyKey: `auto-fulfillment:${target.orderId}`,
    });

    if (outcome.status !== 'SUCCEEDED') {
      // PENDING and UNKNOWN have already opened their own escalations inside
      // `purchase`, and neither is ever retried from here.
      return {
        decision: 'PURCHASE_NOT_COMPLETED',
        workItemId: target.workItemId,
        assetId: null,
        reason: `PURCHASE_${outcome.status}`,
      };
    }

    await this.fulfillment.confirmAutomatedPurchaseSteps(target.workItemId, AUTO_FULFILLMENT_ACTOR);

    return {
      decision: 'PURCHASED',
      workItemId: target.workItemId,
      assetId: outcome.assetId,
      reason: 'SUPPLIER_PURCHASE_SUCCEEDED',
    };
  }

  /** Every reason a work item is not a candidate, or `null` when it is one. */
  private checkEligibility(target: AutoFulfillmentTarget): AutoFulfillmentOutcome | null {
    if (target.workItemType !== AUTOMATABLE_WORK_ITEM_TYPE) {
      return notEligible(target.workItemId, 'WORK_ITEM_TYPE_NOT_AUTOMATABLE');
    }
    if (target.assetCount > 0) {
      // Someone — a person or an earlier attempt — already bought this order a
      // card. Buying a second one is a real loss, not a duplicate row.
      return notEligible(target.workItemId, 'ORDER_ALREADY_HAS_ASSET');
    }
    if (target.skuId === null) {
      return notEligible(target.workItemId, 'ORDER_IS_NOT_A_SKU_PURCHASE');
    }
    if (target.quantity !== AUTOMATABLE_QUANTITY) {
      return notEligible(target.workItemId, 'QUANTITY_NOT_AUTOMATABLE');
    }
    if (!DELIVERABLE_ORDER_STATUSES.some((status) => status === target.orderStatus)) {
      return notEligible(target.workItemId, 'ORDER_NOT_DELIVERABLE');
    }
    return null;
  }

  /**
   * Publish the card to the customer, then close the task.
   *
   * The close is conditional on the delivery having actually happened, and on the
   * item still being unassigned — an operator who claimed it in the meantime
   * keeps it, sees a delivered asset in their workspace, and closes it themselves.
   */
  private async deliverAndClose(
    target: AutoFulfillmentTarget,
    assetId: string,
  ): Promise<AutoFulfillmentOutcome> {
    let delivered: boolean;
    try {
      const outcome = await this.fulfillment.deliverBySelfService(target.workItemId);
      delivered = outcome.delivered;
    } catch {
      // The send gate refused (a missing delivery e-mail, say — no longer a cost
      // variance, which is reviewed instead of enforced). The card is bought and
      // stored; an operator resolves the blocker and sends it.
      delivered = false;
    }

    if (!delivered) {
      return {
        decision: 'DELIVERY_BLOCKED',
        workItemId: target.workItemId,
        assetId,
        reason: 'SEND_GATE_REFUSED',
      };
    }

    await this.workItems.completeBySystem({
      workItemId: target.workItemId,
      actor: AUTO_FULFILLMENT_ACTOR,
      resolutionNote: 'کد به‌صورت خودکار از تأمین‌کننده تهیه و برای مشتری منتشر شد.',
    });

    return {
      decision: 'FULFILLED',
      workItemId: target.workItemId,
      assetId,
      reason: 'DELIVERED_SELF_SERVICE',
    };
  }

  /** One audit row per attempt, whatever it decided. Never a code or a payload. */
  private async record(outcome: AutoFulfillmentOutcome): Promise<AutoFulfillmentOutcome> {
    await this.audit.record({
      actor: AUTO_FULFILLMENT_ACTOR,
      actorType: 'SYSTEM',
      action: AUTO_FULFILLMENT_AUDIT_ACTION,
      entity: 'WorkItem',
      entityId: outcome.workItemId,
      after: {
        decision: outcome.decision,
        reason: outcome.reason,
        assetId: outcome.assetId,
        attemptedAt: new Date().toISOString(),
      },
    });
    return outcome;
  }
}
