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
import { InMemorySupplierStore } from './testing/in-memory-supplier.store';
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
  const fulfillment = new FulfillmentService(
    fulfillmentStore,
    new MockAssetDeliveryTransport(),
    new ChecklistService(fulfillmentStore, audit),
    new GiftCardAssetService(fulfillmentStore, audit),
    audit,
    { bankDetailsEncryptionKey: () => Buffer.alloc(32, 7) } as never,
  );

  const provider = new MockSupplierProvider({ availability: { 'MOCK-SKU-1': 'AVAILABLE' } });
  const providers = options.withAdapter === false ? [] : [provider];
  const workItemsService = new WorkItemsService(workItems, audit);
  const suppliers = new SuppliersService(
    supplierStore,
    providers,
    workItemsService,
    fulfillment,
    audit,
  );

  return {
    service: new AutoFulfillmentService(workItemsService, suppliers, fulfillment, audit),
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
  it('buys, publishes the card and closes the task itself', async () => {
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

    // Closed by the system, not left in the queue for an operator to re-do.
    expect(h.workItems.rows.get(h.workItemId)?.status).toBe('COMPLETED');
    expect(h.workItems.rows.get(h.workItemId)?.assignedToStaffId).toBeNull();
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
