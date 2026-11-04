import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
// From the barrel, never `@barat/suppliers/providers/*`: the import-boundary
// rule in eslint.config.mjs forbids domain code (tests included) from naming a
// concrete adapter path.
import { MockSupplierProvider } from '@barat/suppliers';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import { ChecklistService } from '../fulfillment/checklist.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GiftCardAssetService } from '../fulfillment/gift-card-asset.service';
import { InMemoryFulfillmentStore } from '../fulfillment/testing/in-memory-fulfillment.store';
import { MockAssetDeliveryTransport } from '../fulfillment/transports/mock-asset-delivery.transport';
import { InMemoryWorkItemStore } from '../workitems/testing/in-memory-workitem.store';
import { WorkItemsService } from '../workitems/workitems.service';
import { AutoFulfillmentService } from './auto-fulfillment.service';
import { SuppliersService } from './suppliers.service';
import { TopUpFulfillmentService } from './topup-fulfillment.service';
import { InMemorySupplierStore } from './testing/in-memory-supplier.store';
import { InMemoryTopUpStore } from './testing/in-memory-topup.store';
import type { AutoFulfillmentTarget, SupplierOfferView } from './suppliers.types';

/**
 * Buying the card automatically, and — far more often — deciding not to.
 *
 * Every test below asks the same question from a different angle: when the
 * supplier cannot or should not be used, does the work item stay in the queue
 * for an operator? An automation that quietly drops a paid order is worse than
 * no automation at all, so "the task survives" is asserted on every failure
 * path, not just on the happy one.
 */

/** The plaintext the provider hands back. Leak assertions search for it. */
const PLAINTEXT_CODE = 'MOCK-9911-2233-4455';
const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';
const OFFER_ID = 'offer-mock';
const OPERATOR_ID = 'staff-operator';

/** Matches the quoted cost, so the cost-variance gate is not what is under test. */
const COST = { amount: '100.00', currency: 'USD' } as const;

function offer(overrides: Partial<SupplierOfferView> = {}): SupplierOfferView {
  return {
    id: OFFER_ID,
    supplierId: 'sup-1',
    supplierCode: 'mock',
    supplierName: 'Mock Supplier',
    supportsRawCode: true,
    skuId: 'sku-1',
    providerSku: 'MOCK-SKU-1',
    costCurrency: 'USD',
    costAmount: COST.amount,
    discountBps: 0,
    availability: 'AVAILABLE',
    priority: 1,
    isActive: true,
    lastCheckedAt: null,
    ...overrides,
  };
}

interface AuditEvent {
  readonly action: string;
  readonly payload: string;
}

interface Harness {
  readonly service: AutoFulfillmentService;
  readonly supplierStore: InMemorySupplierStore;
  readonly provider: MockSupplierProvider;
  readonly workItems: InMemoryWorkItemStore;
  readonly fulfillmentStore: InMemoryFulfillmentStore;
  readonly events: AuditEvent[];
  /** The id the in-memory work-item store assigned to the seeded task. */
  readonly workItemId: string;
}

interface HarnessOptions {
  readonly target?: Partial<AutoFulfillmentTarget>;
  readonly offers?: readonly SupplierOfferView[];
  /** `false` leaves the supplier row without an adapter, as a manual one is. */
  readonly withAdapter?: boolean;
  /** The order's delivery e-mail. Null is the real default: checkout omits it. */
  readonly deliveryEmail?: string | null;
  /** Seeds the work item as already claimed by this operator. */
  readonly claimedBy?: string | null;
}

async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const events: AuditEvent[] = [];
  const writer: AuditWriter = {
    append: async (input) => {
      events.push({
        action: input.action,
        payload: JSON.stringify({ before: input.before ?? null, after: input.after ?? null }),
      });
    },
  };
  const audit = new AuditService(writer);

  const workItems = new InMemoryWorkItemStore();
  const seeded = await workItems.create({
    code: 'WI-AUTO-1',
    orderId: ORDER_ID,
    customerId: CUSTOMER_ID,
    queueKey: 'GIFT_CARD_MANUAL',
    type: 'MANUAL_GIFT_CARD_FULFILLMENT',
    priority: 3,
    title: 'تحویل گیفت‌کارت',
    description: null,
    dueAt: null,
    payload: null,
    holdsOrderLock: true,
  });
  const claimedBy = options.claimedBy ?? null;
  if (claimedBy !== null) {
    await workItems.claimIfUnassigned(seeded.id, claimedBy, new Date());
  }

  const target: AutoFulfillmentTarget = {
    workItemId: seeded.id,
    workItemType: 'MANUAL_GIFT_CARD_FULFILLMENT',
    workItemStatus: claimedBy === null ? 'UNASSIGNED' : 'ASSIGNED',
    assignedToStaffId: claimedBy,
    orderId: ORDER_ID,
    customerId: CUSTOMER_ID,
    orderStatus: 'PAID',
    skuId: 'sku-1',
    quantity: 1,
    assetCount: 0,
    ...options.target,
  };

  const supplierStore = new InMemorySupplierStore({
    suppliers: [
      {
        id: 'sup-1',
        code: 'mock',
        name: 'Mock Supplier',
        integrationMode: 'API',
        supportsRawCode: true,
        defaultCurrency: 'USD',
        isActive: true,
      },
    ],
    offers: options.offers ?? [offer()],
    targets: [target],
  });

  const fulfillmentStore = new InMemoryFulfillmentStore({
    orderId: ORDER_ID,
    workItemId: seeded.id,
    assignedToStaffId: claimedBy,
    deliveryEmail: options.deliveryEmail === undefined ? null : options.deliveryEmail,
    quotedSupplierCost: COST.amount,
    quotedSupplierCurrency: COST.currency,
  });
  // One escalator for both services, on the same work-item store the assertions
  // read: a cost-variance review lands next to the task, as in production.
  const workItemsService = new WorkItemsService(workItems, audit);
  // Empty: this suite never routes a top-up order here, and an empty store is
  // what makes that visible — a store with a seeded target would prove less.
  const topUpStore = new InMemoryTopUpStore();

  const fulfillment = new FulfillmentService(
    fulfillmentStore,
    new MockAssetDeliveryTransport(),
    new ChecklistService(fulfillmentStore, audit),
    new GiftCardAssetService(fulfillmentStore, audit),
    audit,
    { info: async () => null, readIfExists: async () => null } as never,
    { bankDetailsEncryptionKey: () => Buffer.alloc(32, 7) } as never,
    workItemsService,
  );

  const provider = new MockSupplierProvider({ availability: { 'MOCK-SKU-1': 'AVAILABLE' } });
  const providers = options.withAdapter === false ? [] : [provider];
  const suppliers = new SuppliersService(
    supplierStore,
    providers,
    workItemsService,
    fulfillment,
    audit,
  );

  return {
    supplierStore,
    /*
     * The top-up service is a real instance, not a stub: this suite drives
     * gift-card orders only, and the trigger must call it for none of them. A
     * stub would prove nothing about that.
     */
    service: new AutoFulfillmentService(
      workItemsService,
      suppliers,
      fulfillment,
      audit,
      /*
       * Real collaborators with an empty top-up store and the same escalator as
       * everything else here. This suite drives gift-card orders only, and the
       * point of wiring the real service is that it must be reached for none of
       * them — a stub would prove nothing about that.
       */
      new TopUpFulfillmentService(topUpStore, providers, workItemsService, audit),
    ),
    provider,
    workItems,
    fulfillmentStore,
    events,
    workItemId: seeded.id,
  };
}

/** A provider result that succeeds and hands back a raw code, as Tillo does. */
function succeeds(provider: MockSupplierProvider): void {
  provider.setNextPurchaseResult({
    status: 'SUCCEEDED',
    providerReference: 'MOCK-REF-1',
    cost: { amount: COST.amount, currency: COST.currency },
    asset: { assetType: 'CODE', code: PLAINTEXT_CODE },
  });
}

beforeEach(() => {
  process.env['GIFT_CARD_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
});

describe('payment-time auto-fulfillment', () => {
  it('buys, publishes the card and leaves the task for sign-off', async () => {
    const h = await harness();
    succeeds(h.provider);

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    expect(outcome.decision).toBe('FULFILLED');
    expect(outcome.assetId).not.toBeNull();

    /* SENT is the flag the customer reveal endpoint gates on, so this is what
     * makes the code visible to the buyer at all. */
    const asset = h.fulfillmentStore.rawAssets()[0];
    expect(asset?.status).toBe('SENT');
    expect(h.fulfillmentStore.orderStatus).toBe('FULFILLED');

    // The task stays UNASSIGNED for an operator to verify and close.
    const item = h.workItems.rows.get(h.workItemId);
    expect(item?.status).toBe('UNASSIGNED');
    expect(item?.assignedToStaffId).toBeNull();
    expect(item?.title).toBe('بررسی تحویل خودکار گیفت‌کارت');
    expect(item?.priority).toBe(500); // Lower priority than actual fulfillment work.
  });

  it('never lets the plaintext code reach an audit payload', async () => {
    const h = await harness();
    succeeds(h.provider);

    await h.service.attemptForPaidOrder(h.workItemId);

    // Rule 10: the code exists only in the encrypted column.
    expect(JSON.stringify(h.events)).not.toContain(PLAINTEXT_CODE);
    expect(h.fulfillmentStore.rawAssets()[0]?.encryptedCode).not.toContain(PLAINTEXT_CODE);
  });

  it('delivers even though the order carries no delivery e-mail', async () => {
    /* The reason this waiver exists: checkout never collects a delivery e-mail,
     * so DELIVERY_EMAIL_PRESENT is unsatisfiable and would block every single
     * self-service delivery. If this test fails, Flow A silently does nothing. */
    const h = await harness({ deliveryEmail: null });
    succeeds(h.provider);

    await expect(h.service.attemptForPaidOrder(h.workItemId)).resolves.toMatchObject({
      decision: 'FULFILLED',
    });
  });

  it('leaves the task for an operator when the supplier float is empty', async () => {
    const h = await harness();
    succeeds(h.provider);
    h.provider.setBalance({ amount: '0', currency: 'USD' });

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    expect(outcome).toMatchObject({
      decision: 'INSUFFICIENT_FUNDS',
      reason: 'FUNDING_INSUFFICIENT',
      assetId: null,
    });
    /* The assertion that matters: nothing was bought. An empty account must not
     * be able to become a half-placed supplier order. */
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('UNASSIGNED');
  });

  it('stands down when the balance cannot be read at all', async () => {
    const h = await harness();
    succeeds(h.provider);
    h.provider.setBalanceFailure('ETIMEDOUT');

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    // Not knowing the balance is treated exactly like not having one.
    expect(outcome).toMatchObject({ decision: 'INSUFFICIENT_FUNDS', reason: 'FUNDING_UNKNOWN' });
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('UNASSIGNED');
  });

  it('stands down when the winning offer has no adapter to call', async () => {
    const h = await harness({ withAdapter: false });

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    expect(outcome).toMatchObject({
      decision: 'SUPPLIER_UNAVAILABLE',
      reason: 'SUPPLIER_HAS_NO_ADAPTER',
    });
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('UNASSIGNED');
  });

  it('stands down when no offer can be selected for the SKU', async () => {
    const h = await harness({ offers: [] });

    await expect(h.service.attemptForPaidOrder(h.workItemId)).resolves.toMatchObject({
      decision: 'SUPPLIER_UNAVAILABLE',
      reason: 'NO_AVAILABLE_OFFER',
    });
  });

  it('does not close the task when the purchase did not come back SUCCEEDED', async () => {
    const h = await harness();
    h.provider.setNextPurchaseResult({ status: 'FAILED', failureCode: 'OUT_OF_STOCK' });

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    expect(outcome).toMatchObject({ decision: 'PURCHASE_NOT_COMPLETED', assetId: null });
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('UNASSIGNED');
  });

  it('refuses to compete with an operator who already claimed the task', async () => {
    const h = await harness({ claimedBy: OPERATOR_ID });
    succeeds(h.provider);

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', reason: 'WORK_ITEM_CLAIMED' });
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
    expect(h.workItems.rows.get(h.workItemId)?.assignedToStaffId).toBe(OPERATOR_ID);
  });

  it('refuses an order that already has a delivery asset', async () => {
    const h = await harness({ target: { assetCount: 1 } });
    succeeds(h.provider);

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    /* Buying a second card is a real financial loss, not a duplicate row, so
     * this guard is asserted separately from the idempotency key. */
    expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', reason: 'ORDER_ALREADY_HAS_ASSET' });
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it.each([
    { label: 'a service order with no SKU', patch: { skuId: null }, reason: 'ORDER_IS_NOT_A_SKU_PURCHASE' },
    { label: 'a multi-card order', patch: { quantity: 2 }, reason: 'QUANTITY_NOT_AUTOMATABLE' },
    { label: 'an unpaid order', patch: { orderStatus: 'AWAITING_PAYMENT' }, reason: 'ORDER_NOT_DELIVERABLE' },
    {
      label: 'a work item of another type',
      patch: { workItemType: 'SUPPORT_REQUEST' },
      reason: 'WORK_ITEM_TYPE_NOT_AUTOMATABLE',
    },
  ])('never calls the supplier for $label', async ({ patch, reason }) => {
    const h = await harness({ target: patch });
    succeeds(h.provider);

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', reason });
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('UNASSIGNED');
  });

  it('creates the work item first, even when the supplier attempt cannot succeed', async () => {
    /* `onOrderPaid` is called from inside a payment callback. Whatever the
     * supplier does, the queue must end up with the task — that ordering is the
     * entire safety story of this feature. */
    const h = await harness();
    h.provider.setBalance({ amount: '0', currency: 'USD' });

    const item = await h.service.onOrderPaid({
      orderId: 'order-2',
      customerId: CUSTOMER_ID,
    });

    expect(item.status).toBe('UNASSIGNED');
    expect(h.workItems.rows.get(item.id)?.orderId).toBe('order-2');
  });
});

describe('operator-triggered auto-fulfillment', () => {
  it('buys for the operator holding the task but leaves them the delivery', async () => {
    const h = await harness({ claimedBy: OPERATOR_ID });
    succeeds(h.provider);

    const outcome = await h.service.attemptForOperatorRequest({
      workItemId: h.workItemId,
      staffId: OPERATOR_ID,
    });

    expect(outcome).toMatchObject({ decision: 'PURCHASED' });
    expect(outcome.assetId).not.toBeNull();
    /* Not delivered and not closed: the operator owns this item, and taking the
     * send decision away from them mid-task is interference, not automation. */
    expect(h.fulfillmentStore.rawAssets()[0]?.status).toBe('READY');
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('ASSIGNED');
  });

  it('refuses to buy for a staff member who does not hold the task', async () => {
    const h = await harness({ claimedBy: OPERATOR_ID });
    succeeds(h.provider);

    const outcome = await h.service.attemptForOperatorRequest({
      workItemId: h.workItemId,
      staffId: 'staff-someone-else',
    });

    expect(outcome).toMatchObject({
      decision: 'NOT_ELIGIBLE',
      reason: 'WORK_ITEM_NOT_HELD_BY_REQUESTER',
    });
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it('returns no asset when the float is empty, so the admin request goes ahead', async () => {
    const h = await harness({ claimedBy: OPERATOR_ID });
    succeeds(h.provider);
    h.provider.setBalance({ amount: '0', currency: 'USD' });

    const outcome = await h.service.attemptForOperatorRequest({
      workItemId: h.workItemId,
      staffId: OPERATOR_ID,
    });

    /* `assetId === null` is the signal the gift-card-requests service reads to
     * fall back to the admin queue. */
    expect(outcome.assetId).toBeNull();
    expect(outcome.decision).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('a purchase the supplier finishes after answering "processing"', () => {
  const REFERENCE = 'RC-15780';

  /** The venue accepted the order and has not finished it yet. */
  function processing(provider: MockSupplierProvider): void {
    provider.setNextPurchaseResult({ status: 'PENDING', providerReference: REFERENCE });
  }

  /** The venue finished it and hands back the card, as ReSellCodes does after about 30s. */
  function completes(provider: MockSupplierProvider): void {
    provider.setPurchaseStatus(REFERENCE, {
      status: 'SUCCEEDED',
      providerReference: REFERENCE,
      cost: { amount: COST.amount, currency: COST.currency },
      asset: { assetType: 'CODE', code: PLAINTEXT_CODE },
    });
  }

  function followUp(h: Harness): { status: string } | undefined {
    return [...h.workItems.rows.values()].find((row) => row.code.startsWith('SUPPLIER_PENDING:'));
  }

  it('shows the order as in progress and stores nothing while the supplier works', async () => {
    const h = await harness();
    processing(h.provider);

    const outcome = await h.service.attemptForPaidOrder(h.workItemId);

    expect(outcome).toMatchObject({ decision: 'PURCHASE_NOT_COMPLETED', reason: 'PURCHASE_PENDING' });
    expect(h.supplierStore.orderStatusOf(ORDER_ID)).toBe('FULFILLING');
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(0);
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('UNASSIGNED');
    expect(followUp(h)?.status).toBe('UNASSIGNED');
  });

  it('keeps waiting, without buying again, while the supplier is still processing', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);

    const sweep = await h.service.settlePendingPurchases();

    expect(sweep).toEqual({ scanned: 1, delivered: 0, failed: 0 });
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(0);
    expect(h.fulfillmentStore.orderStatus).toBe('PAID');
  });

  it('delivers the card to the customer and fulfils the order once the supplier completes', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);
    completes(h.provider);

    const sweep = await h.service.settlePendingPurchases();

    expect(sweep).toEqual({ scanned: 1, delivered: 1, failed: 0 });
    // The flag the customer's reveal endpoint gates on, and the order status the panel shows.
    expect(h.fulfillmentStore.rawAssets()[0]?.status).toBe('SENT');
    expect(h.fulfillmentStore.orderStatus).toBe('FULFILLED');
    expect(h.fulfillmentStore.orderFulfilledAt).not.toBeNull();
    // The "did we get charged?" follow-up is answered, so it closes by itself.
    expect(followUp(h)?.status).toBe('COMPLETED');
    expect(h.workItems.rows.get(h.workItemId)?.title).toBe('بررسی تحویل خودکار گیفت‌کارت');
    // Never bought a second time, and the order's purchase slot is free again.
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
    expect((await h.supplierStore.latestPurchaseAttempt(ORDER_ID))?.status).toBe('SUCCEEDED');
  });

  it('never lets the plaintext code reach an audit payload', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);
    completes(h.provider);

    await h.service.settlePendingPurchases();

    expect(JSON.stringify(h.events)).not.toContain(PLAINTEXT_CODE);
    expect(h.fulfillmentStore.rawAssets()[0]?.encryptedCode).not.toContain(PLAINTEXT_CODE);
  });

  it('settles each purchase once: a later pass finds nothing to do', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);
    completes(h.provider);
    await h.service.settlePendingPurchases();

    await expect(h.service.settlePendingPurchases()).resolves.toEqual({
      scanned: 0,
      delivered: 0,
      failed: 0,
    });
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(1);
  });

  it('frees the purchase slot and leaves the tasks to an operator when the supplier fails it', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);
    h.provider.setPurchaseStatus(REFERENCE, {
      status: 'FAILED',
      providerReference: REFERENCE,
      failureCode: 'OUT_OF_STOCK',
    });

    const sweep = await h.service.settlePendingPurchases();

    expect(sweep).toEqual({ scanned: 1, delivered: 0, failed: 1 });
    expect((await h.supplierStore.latestPurchaseAttempt(ORDER_ID))?.status).toBe('FAILED');
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(0);
    expect(h.fulfillmentStore.orderStatus).toBe('PAID');
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('UNASSIGNED');
    expect(followUp(h)?.status).toBe('UNASSIGNED');
  });

  it('keeps waiting when the supplier status cannot be read', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);
    h.provider.setPurchaseStatus(REFERENCE, {
      status: 'UNKNOWN',
      providerReference: REFERENCE,
      failureCode: 'STATUS_UNAVAILABLE',
    });

    await expect(h.service.settlePendingPurchases()).resolves.toMatchObject({ delivered: 0, failed: 0 });
    expect((await h.supplierStore.latestPurchaseAttempt(ORDER_ID))?.status).toBe('IN_FLIGHT');
  });

  it('stores the card but leaves the delivery to an operator who took the task meanwhile', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);
    await h.workItems.claimIfUnassigned(h.workItemId, OPERATOR_ID, new Date());
    h.supplierStore.targets[0] = {
      ...(h.supplierStore.targets[0] as AutoFulfillmentTarget),
      workItemStatus: 'ASSIGNED',
      assignedToStaffId: OPERATOR_ID,
    };
    completes(h.provider);

    await h.service.settlePendingPurchases();

    expect(h.fulfillmentStore.rawAssets()[0]?.status).toBe('READY');
    expect(h.fulfillmentStore.orderStatus).toBe('PAID');
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('ASSIGNED');
  });

  it('does not store a second card when a person already entered one', async () => {
    const h = await harness();
    processing(h.provider);
    await h.service.attemptForPaidOrder(h.workItemId);
    completes(h.provider);
    // A person typed the card in before the sweep reached the order.
    await h.fulfillmentStore.createAsset({
      orderId: ORDER_ID,
      fulfillmentId: 'fulfillment-by-hand',
      skuId: 'sku-1',
      assetType: 'CODE',
      encryptedCode: 'enc:by-hand',
      encryptedPin: null,
      maskedCode: '****',
      serialNumber: null,
      deliveryUrl: null,
      recipientEmail: null,
      expiryDate: null,
      supplierReference: null,
      actualSupplierCost: null,
      actualSupplierCurrency: null,
      enteredByUserId: null,
      enteredAt: new Date(),
    });

    const sweep = await h.service.settlePendingPurchases();

    expect(sweep).toEqual({ scanned: 1, delivered: 0, failed: 0 });
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(1);
    expect((await h.supplierStore.latestPurchaseAttempt(ORDER_ID))?.status).toBe('SUCCEEDED');
  });
});
