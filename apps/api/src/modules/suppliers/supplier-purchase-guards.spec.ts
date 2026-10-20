import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
// From the barrel, never `@barat/suppliers/providers/*` (import-boundary rule).
import { MockSupplierProvider } from '@barat/suppliers';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import { ChecklistService } from '../fulfillment/checklist.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GiftCardAssetService } from '../fulfillment/gift-card-asset.service';
import { InMemoryFulfillmentStore } from '../fulfillment/testing/in-memory-fulfillment.store';
import { MockAssetDeliveryTransport } from '../fulfillment/transports/mock-asset-delivery.transport';
import type { StaffContext } from '../workitems/staff-context';
import { InMemoryWorkItemStore } from '../workitems/testing/in-memory-workitem.store';
import { WorkItemsService } from '../workitems/workitems.service';
import { SuppliersService } from './suppliers.service';
import { InMemorySupplierStore } from './testing/in-memory-supplier.store';
import type { AutoFulfillmentTarget, SupplierOfferView } from './suppliers.types';

/**
 * The guards in front of a supplier purchase.
 *
 * Two families of bug are asserted here, and every test ends on the same
 * number — how many times the supplier was actually asked to sell us a card:
 *
 *   1. `POST /operator/suppliers/purchase` used to forward its body verbatim, so
 *      any operator could buy any offer, in any quantity, against any order.
 *   2. Two purchases for one order racing each other each read "no asset yet"
 *      before the supplier round-trip and both bought.
 */

const ORDER_ID = 'order-1';
const WORK_ITEM_ID = 'wi-1';
const OFFER_ID = 'offer-mock';
const OPERATOR: StaffContext = { id: 'staff-operator', role: 'OPERATOR' };
const OTHER_OPERATOR: StaffContext = { id: 'staff-other', role: 'OPERATOR' };
const MANAGER: StaffContext = { id: 'staff-manager', role: 'OPS_MANAGER' };

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
    costAmount: '100.00',
    discountBps: 0,
    availability: 'AVAILABLE',
    priority: 1,
    isActive: true,
    lastCheckedAt: null,
    ...overrides,
  };
}

function target(overrides: Partial<AutoFulfillmentTarget> = {}): AutoFulfillmentTarget {
  return {
    workItemId: WORK_ITEM_ID,
    workItemType: 'MANUAL_GIFT_CARD_FULFILLMENT',
    workItemStatus: 'ASSIGNED',
    assignedToStaffId: OPERATOR.id,
    orderId: ORDER_ID,
    customerId: 'customer-1',
    orderStatus: 'PAID',
    skuId: 'sku-1',
    quantity: 1,
    assetCount: 0,
    ...overrides,
  };
}

interface Harness {
  readonly service: SuppliersService;
  readonly provider: MockSupplierProvider;
  readonly supplierStore: InMemorySupplierStore;
  readonly fulfillmentStore: InMemoryFulfillmentStore;
  readonly workItems: InMemoryWorkItemStore;
}

function harness(
  options: {
    readonly target?: Partial<AutoFulfillmentTarget>;
    readonly offers?: readonly SupplierOfferView[];
    readonly ambiguousOrderIds?: readonly string[];
  } = {},
): Harness {
  const writer: AuditWriter = { append: async () => undefined };
  const audit = new AuditService(writer);

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
    offers: options.offers ?? [offer(), offer({ id: 'offer-expensive', skuId: 'sku-500', costAmount: '500.00' })],
    targets: [target(options.target)],
    ...(options.ambiguousOrderIds === undefined ? {} : { ambiguousOrderIds: options.ambiguousOrderIds }),
  });

  const fulfillmentStore = new InMemoryFulfillmentStore({ orderId: ORDER_ID, workItemId: WORK_ITEM_ID });
  const workItems = new InMemoryWorkItemStore();
  const escalator = new WorkItemsService(workItems, audit);
  const fulfillment = new FulfillmentService(
    fulfillmentStore,
    new MockAssetDeliveryTransport(),
    new ChecklistService(fulfillmentStore, audit),
    new GiftCardAssetService(fulfillmentStore, audit),
    audit,
    { info: async () => null, readIfExists: async () => null } as never,
    { bankDetailsEncryptionKey: () => Buffer.alloc(32, 7) } as never,
    escalator,
  );

  const provider = new MockSupplierProvider({ availability: { 'MOCK-SKU-1': 'AVAILABLE' } });
  provider.setNextPurchaseResult({
    status: 'SUCCEEDED',
    providerReference: 'REF-1',
    cost: { amount: '100.00', currency: 'USD' },
    asset: { assetType: 'CODE', code: 'MOCK-1111-2222-3333-4444' },
  });

  return {
    service: new SuppliersService(supplierStore, [provider], escalator, fulfillment, audit),
    provider,
    supplierStore,
    fulfillmentStore,
    workItems,
  };
}

function staffPurchase(overrides: Record<string, unknown> = {}) {
  return {
    staff: OPERATOR,
    orderId: ORDER_ID,
    workItemId: WORK_ITEM_ID,
    offerId: OFFER_ID,
    quantity: 1,
    idempotencyKey: 'operator-key-0001',
    ...overrides,
  } as Parameters<SuppliersService['purchaseForStaff']>[0];
}

beforeEach(() => {
  process.env['GIFT_CARD_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
});

describe('staff-initiated purchase is bound to the order it names', () => {
  it('buys once for the operator holding the claim, on the order SKU and quantity', async () => {
    const h = harness();

    const outcome = await h.service.purchaseForStaff(staffPurchase());

    expect(outcome.status).toBe('SUCCEEDED');
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(1);
  });

  it('refuses an operator who does not hold the claim', async () => {
    const h = harness();
    await expect(h.service.purchaseForStaff(staffPurchase({ staff: OTHER_OPERATOR }))).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it('lets a manager act on an item claimed by someone else', async () => {
    const h = harness();
    await expect(h.service.purchaseForStaff(staffPurchase({ staff: MANAGER }))).resolves.toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
  });

  it('refuses an offer for a different (pricier) SKU than the order bought', async () => {
    const h = harness();
    await expect(
      h.service.purchaseForStaff(staffPurchase({ offerId: 'offer-expensive' })),
    ).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it('refuses a quantity other than the one the customer paid for', async () => {
    const h = harness();
    await expect(h.service.purchaseForStaff(staffPurchase({ quantity: 5 }))).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it('refuses a work item that belongs to a different order', async () => {
    const h = harness();
    await expect(h.service.purchaseForStaff(staffPurchase({ orderId: 'order-other' }))).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it('refuses an order that is not deliverable', async () => {
    const h = harness({ target: { orderStatus: 'REFUND_PENDING' } });
    await expect(h.service.purchaseForStaff(staffPurchase())).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it('refuses while an earlier purchase for the order is still UNKNOWN or PENDING', async () => {
    const h = harness({ ambiguousOrderIds: [ORDER_ID] });
    // A fresh idempotency key would sail past the supplier's own dedupe.
    await expect(
      h.service.purchaseForStaff(staffPurchase({ idempotencyKey: 'a-brand-new-key-123' })),
    ).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });

  it('refuses an order that already has a card, even with a new key', async () => {
    const h = harness();
    await h.service.purchaseForStaff(staffPurchase());

    await expect(
      h.service.purchaseForStaff(staffPurchase({ idempotencyKey: 'operator-key-0002' })),
    ).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(1);
  });
});

describe('concurrent purchases for one order', () => {
  it('buys once when two purchases race, whatever keys they carry', async () => {
    const h = harness();
    // Slow the supplier down so both calls are genuinely in flight together.
    const original = h.provider.purchase.bind(h.provider);
    h.provider.purchase = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return original(request);
    };

    const results = await Promise.allSettled([
      h.service.purchase({
        orderId: ORDER_ID,
        workItemId: WORK_ITEM_ID,
        offerId: OFFER_ID,
        quantity: 1,
        idempotencyKey: 'auto-fulfillment:order-1',
      }),
      h.service.purchase({
        orderId: ORDER_ID,
        workItemId: WORK_ITEM_ID,
        offerId: OFFER_ID,
        quantity: 1,
        idempotencyKey: 'a-different-key-0001',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
    expect(h.fulfillmentStore.rawAssets()).toHaveLength(1);
  });

  it('a staff purchase queued behind an ambiguous one does not buy again', async () => {
    const h = harness();
    h.provider.setNextPurchaseResult({ status: 'UNKNOWN', failureCode: 'GATEWAY_TIMEOUT' });
    // The ambiguity task the first call opens is what the second must see.
    h.supplierStore.hasOpenPurchaseAmbiguity = async (orderId) =>
      [...h.workItems.rows.values()].some(
        (row) => row.orderId === orderId && row.type === 'UNKNOWN_OUTCOME',
      );
    const original = h.provider.purchase.bind(h.provider);
    h.provider.purchase = async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return original(request);
    };

    const results = await Promise.allSettled([
      h.service.purchaseForStaff(staffPurchase({ idempotencyKey: 'operator-key-a-001' })),
      h.service.purchaseForStaff(staffPurchase({ idempotencyKey: 'operator-key-b-002' })),
    ]);

    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { status: 'UNKNOWN' } });
    expect(results[1]?.status).toBe('rejected');
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
  });
});
