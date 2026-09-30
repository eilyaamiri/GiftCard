import { beforeEach, describe, expect, it } from 'vitest';
// From the barrel, never `@barat/suppliers/providers/*`: the import-boundary
// rule in eslint.config.mjs forbids domain code (tests included) from naming a
// concrete adapter path.
import { MockSupplierProvider } from '@barat/suppliers';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import { WorkItemsService } from '../workitems/workitems.service';
import { InMemoryWorkItemStore } from '../workitems/testing/in-memory-workitem.store';
import { TopUpFulfillmentService } from './topup-fulfillment.service';
import { InMemoryTopUpStore } from './testing/in-memory-topup.store';
import type { TopUpTarget } from './suppliers.types';

/**
 * ============================================================================
 * THE PRODUCT OWNER'S RULE, ASSERTED: a top-up raises NO task for an operator
 * ============================================================================
 *
 *   For a direct top-up NO WorkItem is created for an operator. The system does
 *   every step. A complete trace is kept for each order so that, if something
 *   goes wrong, an operator can investigate, follow up and resolve it.
 *
 * That rule has two halves and this file tests both, in that order of emphasis:
 *
 *   1. On every outcome — success, pending, an empty float, a missing adapter —
 *      the work-item store is EMPTY. Not "the task is closed", not "the task is
 *      assigned to the system": there is no row at all. A queue that fills with
 *      one item per top-up is the failure this whole service exists to prevent,
 *      and it is a silent one, so it is asserted directly on the store's row
 *      count rather than on anything the service returns.
 *   2. On the two genuine error paths — a FAILED purchase and an ambiguous
 *      UNKNOWN one — exactly one task IS opened, because that is the path by
 *      which a human learns about the problem and answers the customer. Those
 *      tests assert one row, a deterministic code, and that the code is stable
 *      across a replay.
 *
 * The distinction is the point: `NOT_ELIGIBLE`, `WAITING_FUNDS`,
 * `AWAITING_PROVIDER` and `SUCCEEDED` are system states; `FAILED` and `UNKNOWN`
 * are "a person must decide". A test that only checked the happy path would
 * pass with the generic gift-card trigger still wired in.
 */

const ORDER_ID = 'order-topup-1';
const CUSTOMER_ID = 'customer-1';
const FULFILLMENT_ID = 'topup-1';
const PROVIDER_SKU = 'telegram:stars:500';

/** The game account. Public identifier, never a credential — see `TopUpField`. */
const ACCOUNT_FIELDS = { telegram_username: 'player_one' } as const;

function target(overrides: Partial<TopUpTarget> = {}): TopUpTarget {
  return {
    orderId: ORDER_ID,
    customerId: CUSTOMER_ID,
    orderStatus: 'PAID',
    fulfillmentId: FULFILLMENT_ID,
    status: 'QUEUED',
    providerSku: PROVIDER_SKU,
    costAmount: '4.75',
    costCurrency: 'USD',
    supplierCode: 'mock',
    supplierId: 'sup-1',
    accountFields: ACCOUNT_FIELDS,
    providerOrderNumber: null,
    purchaseAttempts: 0,
    ...overrides,
  };
}

interface Harness {
  readonly service: TopUpFulfillmentService;
  readonly provider: MockSupplierProvider;
  readonly workItems: InMemoryWorkItemStore;
  readonly topUpStore: InMemoryTopUpStore;
}

function harness(options: { readonly withAdapter?: boolean; readonly target?: TopUpTarget } = {}): Harness {
  const writer: AuditWriter = { append: async () => undefined };
  const audit = new AuditService(writer);
  const workItems = new InMemoryWorkItemStore();
  // The same escalator the real service is given, backed by the same store the
  // assertions read: if a task were opened anywhere, this would see it.
  const escalator = new WorkItemsService(workItems, audit);

  const provider = new MockSupplierProvider({ availability: { [PROVIDER_SKU]: 'AVAILABLE' } });
  const providers = options.withAdapter === false ? [] : [provider];

  const targetRow = options.target ?? target();
  const topUpStore = new InMemoryTopUpStore({
    targets: [targetRow],
    orderStatuses: { [ORDER_ID]: 'PAID' },
  });

  return {
    service: new TopUpFulfillmentService(topUpStore, providers, escalator, audit),
    provider,
    workItems,
    topUpStore,
  };
}

/** Every work item in the store, whatever its type or status. */
function workItemCount(harnessed: Harness): number {
  return harnessed.workItems.rows.size;
}

describe('a top-up creates no work item for an operator', () => {
  describe('on the automated paths', () => {
    it('creates none when the supplier succeeds', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({
        status: 'SUCCEEDED',
        providerReference: 'TG-1',
        cost: { amount: '4.50', currency: 'USD' },
      });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'SUCCEEDED', workItemId: null });
      // The assertion this whole file exists for.
      expect(workItemCount(h)).toBe(0);
      expect(h.topUpStore.statusOf(FULFILLMENT_ID)).toBe('SUCCEEDED');
    });

    it('creates none when the supplier is still working', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({
        status: 'PENDING',
        providerReference: 'TG-2',
        cost: { amount: '4.50', currency: 'USD' },
      });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'AWAITING_PROVIDER', workItemId: null });
      expect(workItemCount(h)).toBe(0);
      expect(h.topUpStore.statusOf(FULFILLMENT_ID)).toBe('AWAITING_PROVIDER');
    });

    it('creates none while the float is empty, and does not buy', async () => {
      const h = harness();
      h.provider.setBalance({ amount: '1.00', currency: 'USD' });
      h.provider.setNextPurchaseResult({ status: 'SUCCEEDED', providerReference: 'TG-3' });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'WAITING_FUNDS', workItemId: null });
      expect(workItemCount(h)).toBe(0);
      // The empty-float branch is the one that would otherwise put an item in
      // the queue for every top-up bought while the account is low, so the
      // absence of a purchase is asserted too.
      expect(h.provider.getPurchaseInvocationCount()).toBe(0);
      expect(h.topUpStore.statusOf(FULFILLMENT_ID)).toBe('WAITING_FUNDS');
    });

    it('creates none when a balance we cannot read', async () => {
      const h = harness();
      h.provider.setBalanceFailure('ETIMEDOUT');

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'WAITING_FUNDS', workItemId: null });
      expect(workItemCount(h)).toBe(0);
      expect(h.provider.getPurchaseInvocationCount()).toBe(0);
    });

    it('creates none for an order that has already succeeded', async () => {
      const h = harness({ target: target({ status: 'SUCCEEDED' }) });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', reason: 'ALREADY_SUCCEEDED' });
      expect(workItemCount(h)).toBe(0);
    });

    it('creates none for an order that is not paid', async () => {
      const h = harness({ target: target({ orderStatus: 'PENDING_PAYMENT' }) });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', reason: 'ORDER_NOT_DELIVERABLE' });
      expect(workItemCount(h)).toBe(0);
      expect(h.topUpStore.events).toHaveLength(0);
    });

    it('creates none when nothing polls it and the supplier is still working', async () => {
      const h = harness({
        target: target({ status: 'AWAITING_PROVIDER', providerOrderNumber: 'TG-9' }),
      });
      h.provider.setPurchaseStatus('TG-9', { status: 'PENDING', providerReference: 'TG-9' });

      const outcome = await h.service.poll(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'AWAITING_PROVIDER', workItemId: null });
      expect(workItemCount(h)).toBe(0);
    });

    it('creates none when a poll cannot reach the supplier, until the bound', async () => {
      const h = harness({
        target: target({
          status: 'AWAITING_PROVIDER',
          providerOrderNumber: 'TG-9',
          purchaseAttempts: 2,
        }),
      });
      // An unreachable venue, without escalating on the first hiccup.
      h.provider.setBalanceFailure('ETIMEDOUT');
      h.provider.getPurchaseStatus = async () => {
        throw new Error('ETIMEDOUT');
      };

      const outcome = await h.service.poll(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'AWAITING_PROVIDER', workItemId: null });
      expect(workItemCount(h)).toBe(0);
    });
  });

  /**
   * The two branches the product owner explicitly asked for: when the purchase
   * or its outcome genuinely errors, the operator IS given a task and answers
   * the customer through it. This is not a violation of "no work item" — it is
   * the other half of it, and it is deliberately restricted to these two.
   */
  describe('the two genuine error paths DO open exactly one task', () => {
    it('opens one on a FAILED purchase, with a deterministic code', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({
        status: 'FAILED',
        failureCode: 'TELEGRAM_REJECTED',
        cost: { amount: '0', currency: 'USD' },
      });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'FAILED' });
      expect(outcome.workItemId).not.toBeNull();
      expect(workItemCount(h)).toBe(1);
      expect(h.workItems.rows.get(outcome.workItemId as string)?.code).toBe(
        `topup:REFUND_REVIEW:${ORDER_ID}`,
      );
      // The order itself is parked for a refund, which only a person completes.
      expect(h.topUpStore.orderTransitions.at(-1)).toMatchObject({ to: 'REFUND_PENDING' });
    });

    it('opens one on an UNKNOWN outcome, and never re-buys', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({
        status: 'UNKNOWN',
        failureCode: 'AMBIGUOUS',
        providerReference: 'TG-7',
      });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'UNKNOWN' });
      expect(workItemCount(h)).toBe(1);
      expect(h.topUpStore.orderTransitions.at(-1)).toMatchObject({ to: 'REVIEW_REQUIRED' });

      /*
       * The dangerous second pass: a replayed payment callback. It must open no
       * SECOND task, and — far more important — must not buy again. A retry here
       * would buy a second top-up for one payment, which is real money.
       */
      const replay = await h.service.onTopUpOrderPaid(ORDER_ID);
      expect(replay).toMatchObject({ decision: 'NOT_ELIGIBLE', reason: 'TERMINAL_UNKNOWN' });
      expect(workItemCount(h)).toBe(1);
      expect(h.provider.getPurchaseInvocationCount()).toBe(1);
    });

    it('opens one when no adapter is registered, deterministically', async () => {
      const h = harness({ withAdapter: false });

      const first = await h.service.onTopUpOrderPaid(ORDER_ID);
      const replay = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(first).toMatchObject({ decision: 'UNKNOWN', reason: 'SUPPLIER_HAS_NO_ADAPTER' });
      // Two identical callbacks, one task: the code is derived from the order
      // and the reason, not from the attempt.
      expect(workItemCount(h)).toBe(1);
      expect(replay).toMatchObject({ decision: 'NOT_ELIGIBLE', reason: 'TERMINAL_UNKNOWN' });
      expect(replay.workItemId).toBeNull();
    });

    it('opens one when the supplier has been unreachable for too long', async () => {
      const h = harness({
        target: target({
          status: 'AWAITING_PROVIDER',
          providerOrderNumber: 'TG-9',
          purchaseAttempts: 5,
        }),
      });
      /*
       * The bound that stops a dead supplier from holding a customer's order
       * forever. Without it the fulfillment would sit in AWAITING_PROVIDER
       * indefinitely and nothing anywhere would say so.
       */
      h.provider.getPurchaseStatus = async () => {
        throw new Error('ETIMEDOUT');
      };

      const outcomes = [];
      for (let index = 0; index < 5; index += 1) {
        outcomes.push(await h.service.poll(ORDER_ID));
      }
      const outcome = outcomes.at(-1)!;

      expect(outcome).toMatchObject({ decision: 'UNKNOWN', reason: 'STATUS_CHECKS_EXHAUSTED' });
      expect(workItemCount(h)).toBe(1);
      expect(h.workItems.rows.get(outcome.workItemId as string)?.code).toBe(
        `topup:UNKNOWN_OUTCOME:${ORDER_ID}`,
      );
    });

    it('never re-buys a provider-pending order on a callback replay', async () => {
      const h = harness({
        target: target({ status: 'AWAITING_PROVIDER', providerOrderNumber: 'TG-9' }),
      });

      await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(h.provider.getPurchaseInvocationCount()).toBe(0);
    });

    it('recovers a stranded purchase as UNKNOWN without buying again', async () => {
      const h = harness({ target: target({ status: 'PURCHASING' }) });

      const outcome = await h.service.poll(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'UNKNOWN', reason: 'NO_PROVIDER_ORDER_NUMBER' });
      expect(h.provider.getPurchaseInvocationCount()).toBe(0);
      expect(h.topUpStore.statusOf(FULFILLMENT_ID)).toBe('UNKNOWN');
    });

    it('treats a normalised network poll result as retryable', async () => {
      const h = harness({
        target: target({ status: 'AWAITING_PROVIDER', providerOrderNumber: 'TG-9' }),
      });
      h.provider.setPurchaseStatus('TG-9', {
        status: 'UNKNOWN',
        failureCode: 'NETWORK_ERROR',
        providerReference: 'TG-9',
      });

      const outcome = await h.service.poll(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'AWAITING_PROVIDER', workItemId: null });
      expect(h.topUpStore.statusOf(FULFILLMENT_ID)).toBe('AWAITING_PROVIDER');
      expect(workItemCount(h)).toBe(0);
    });

    it('never re-buys on a poll, whatever the supplier says', async () => {
      const h = harness({
        target: target({ status: 'AWAITING_PROVIDER', providerOrderNumber: 'TG-9' }),
      });

      await h.service.poll(ORDER_ID);

      /* Polling must never spend money: the supplier already has the order, and
       * a second purchase for one payment is a real loss, not a duplicate row. */
      expect(h.provider.getPurchaseInvocationCount()).toBe(0);
    });

    it('opens one once the float has been empty for too long', async () => {
      const h = harness({
        target: target({ purchaseAttempts: 143, status: 'WAITING_FUNDS' }),
      });
      h.provider.setBalance({ amount: '0.00', currency: 'USD' });

      const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

      expect(outcome).toMatchObject({ decision: 'UNKNOWN', reason: 'FUNDING_EXHAUSTED' });
      expect(workItemCount(h)).toBe(1);
    });
  });

  describe('what the task is and is not', () => {
    it('never opens the generic gift-card fulfillment task', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({ status: 'FAILED', failureCode: 'TELEGRAM_REJECTED' });

      await h.service.onTopUpOrderPaid(ORDER_ID);

      /*
       * The specific regression: a top-up landing in the gift-card queue as
       * MANUAL_GIFT_CARD_FULFILLMENT, handing an operator work that needs no
       * human at all. Asserted by type, not by count, so a future branch that
       * swaps one task for another still fails here.
       */
      for (const row of h.workItems.rows.values()) {
        expect(row.type).not.toBe('MANUAL_GIFT_CARD_FULFILLMENT');
      }
      expect([...h.workItems.rows.values()].map((row) => row.type)).toEqual(['REFUND_REVIEW']);
    });

    it('leaves the order lock free, so the task does not masquerade as fulfillment', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({ status: 'FAILED', failureCode: 'TELEGRAM_REJECTED' });

      await h.service.onTopUpOrderPaid(ORDER_ID);

      /*
       * `activeOrderKey` IS the lock: the store derives it from
       * `holdsOrderLock`, and the unique index on it is what lets exactly one
       * item own an order. Null means this task is a note about the order, not
       * a claim on it — so a later, different escalation can still be opened.
       */
      for (const row of h.workItems.rows.values()) {
        expect(row.activeOrderKey).toBeNull();
      }
    });

    it('records a trace of every step even when no task exists', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({
        status: 'SUCCEEDED',
        providerReference: 'TG-1',
        cost: { amount: '4.50', currency: 'USD' },
      });

      await h.service.onTopUpOrderPaid(ORDER_ID);

      // Nothing was assigned to anyone, so the trace IS the record an operator
      // would investigate. A success with no trace would be unaccountable, and
      // the funding check is part of the story: it is why we believed the
      // supplier would be paid.
      expect(h.topUpStore.events.map((event) => event.event.type)).toEqual([
        'BALANCE_CHECKED',
        'PURCHASE_REQUESTED',
        'SUCCEEDED',
      ]);
    });

    it('passes the player account through to the supplier, and no credential', async () => {
      const h = harness();
      h.provider.setNextPurchaseResult({ status: 'SUCCEEDED', providerReference: 'TG-1' });

      await h.service.onTopUpOrderPaid(ORDER_ID);

      const request = h.provider.getLastPurchaseRequest();
      expect(request?.accountFields).toEqual(ACCOUNT_FIELDS);
      expect(request?.idempotencyKey).toBe(`topup:${ORDER_ID}`);
    });
  });

  describe('when the order has no fulfillment row at all', () => {
    let h: Harness;
    beforeEach(() => {
      h = harness();
    });

    it('throws rather than pretending to have worked', async () => {
      await expect(h.service.onTopUpOrderPaid('order-that-does-not-exist')).rejects.toThrow();
      expect(workItemCount(h)).toBe(0);
    });
  });
});
