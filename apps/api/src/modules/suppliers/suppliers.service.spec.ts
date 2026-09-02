import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
// Imported from the barrel, never from `@barat/suppliers/providers/*`: the
// import-boundary rule in eslint.config.mjs forbids domain code (tests included)
// from reaching a concrete adapter path directly.
import { MockSupplierProvider } from '@barat/suppliers';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import { ChecklistService } from '../fulfillment/checklist.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GiftCardAssetService } from '../fulfillment/gift-card-asset.service';
import { MockAssetDeliveryTransport } from '../fulfillment/transports/mock-asset-delivery.transport';
import { InMemoryFulfillmentStore } from '../fulfillment/testing/in-memory-fulfillment.store';
import { InMemoryWorkItemStore } from '../workitems/testing/in-memory-workitem.store';
import { WorkItemsService } from '../workitems/workitems.service';
import { SuppliersService, SUPPLIER_AUDIT_ACTIONS } from './suppliers.service';
import { InMemorySupplierStore } from './testing/in-memory-supplier.store';
import type { SupplierOfferView } from './suppliers.types';

/**
 * The plaintext a compromised/normal provider hands back. Every leak assertion
 * searches for this exact string in whatever crossed a boundary.
 */
const PLAINTEXT_CODE = 'TILLO-9911-2233-4455';
const ORDER_ID = 'order-1';
const WORK_ITEM_ID = 'wi-1';
const OFFER_ID = 'offer-mock';

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

interface AuditEvent {
  readonly action: string;
  readonly payload: string;
}

interface Harness {
  readonly service: SuppliersService;
  readonly provider: MockSupplierProvider;
  readonly workItems: InMemoryWorkItemStore;
  readonly events: AuditEvent[];
}

function harness(offers: readonly SupplierOfferView[] = [offer()]): Harness {
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
    offers,
  });

  const fulfillmentStore = new InMemoryFulfillmentStore({
    orderId: ORDER_ID,
    workItemId: WORK_ITEM_ID,
  });
  const fulfillment = new FulfillmentService(
    fulfillmentStore,
    new MockAssetDeliveryTransport(),
    new ChecklistService(fulfillmentStore, audit),
    new GiftCardAssetService(fulfillmentStore, audit),
    audit,
    { bankDetailsEncryptionKey: () => Buffer.alloc(32, 7) } as never,
  );

  const workItems = new InMemoryWorkItemStore();
  const escalator = new WorkItemsService(workItems, audit);
  const provider = new MockSupplierProvider({ availability: { 'MOCK-SKU-1': 'AVAILABLE' } });

  return {
    service: new SuppliersService(supplierStore, [provider], escalator, fulfillment, audit),
    provider,
    workItems,
    events,
  };
}

function purchaseInput() {
  return {
    orderId: ORDER_ID,
    workItemId: WORK_ITEM_ID,
    offerId: OFFER_ID,
    quantity: 1,
    idempotencyKey: 'purchase-key-0001',
  };
}

beforeEach(() => {
  process.env['GIFT_CARD_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
});

describe('unknown supplier outcome', () => {
  it('never auto-retries the purchase and raises an UNKNOWN_OUTCOME work item', async () => {
    const h = harness();
    h.provider.setNextPurchaseResult({ status: 'UNKNOWN', failureCode: 'GATEWAY_TIMEOUT' });

    const outcome = await h.service.purchase(purchaseInput());

    expect(outcome.status).toBe('UNKNOWN');
    // The single most important assertion in this file: we may have been charged,
    // so the provider must have been called exactly once and never again.
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);

    const items = [...h.workItems.rows.values()];
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('UNKNOWN_OUTCOME');
    // The escalation must NOT take the order lock — the fulfillment item owns it.
    expect(items[0]?.activeOrderKey).toBeNull();

    const unknown = h.events.filter((e) => e.action === SUPPLIER_AUDIT_ACTIONS.PURCHASE_UNKNOWN);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.payload).toContain('"autoRetry":false');
  });

  it('treats a thrown provider error as UNKNOWN rather than FAILED, so nothing retries it', async () => {
    const h = harness();
    h.provider.setNextPurchaseResult({ status: 'SUCCEEDED' });
    // Force the adapter call itself to blow up mid-flight: the provider may well
    // have charged us before the socket died.
    h.provider.purchase = async () => {
      throw new Error('ECONNRESET');
    };

    const outcome = await h.service.purchase(purchaseInput());

    expect(outcome.status).toBe('UNKNOWN');
    expect(outcome.status === 'UNKNOWN' && outcome.failureCode).toBe('PROVIDER_CONNECTION_AMBIGUOUS');
    expect([...h.workItems.rows.values()][0]?.type).toBe('UNKNOWN_OUTCOME');
  });

  it('opens exactly one escalation when the same ambiguous purchase is replayed', async () => {
    const h = harness();
    h.provider.setNextPurchaseResult({ status: 'UNKNOWN', failureCode: 'GATEWAY_TIMEOUT' });

    const first = await h.service.purchase(purchaseInput());
    const second = await h.service.purchase(purchaseInput());

    expect(first.status).toBe('UNKNOWN');
    expect(second.status).toBe('UNKNOWN');
    expect(h.workItems.rows.size).toBe(1);
    // The mock provider is idempotent on the key, so the second call is a cache
    // hit — no second real purchase was attempted.
    expect(h.provider.getPurchaseInvocationCount()).toBe(1);
  });

  it('does not raise an UNKNOWN_OUTCOME item for an unambiguous failure', async () => {
    const h = harness();
    h.provider.setNextPurchaseResult({ status: 'FAILED', failureCode: 'OUT_OF_STOCK' });

    const outcome = await h.service.purchase(purchaseInput());

    expect(outcome.status).toBe('FAILED');
    // FAILED means the provider is certain it did not charge us; no human
    // reconciliation task is warranted.
    expect(h.workItems.rows.size).toBe(0);
  });
});

describe('automated purchase secrecy', () => {
  it('encrypts a supplier-returned code and keeps it out of the purchase response', async () => {
    const h = harness();
    h.provider.setNextPurchaseResult({
      status: 'SUCCEEDED',
      providerReference: 'TILLO-REF-1',
      cost: { amount: '100.00', currency: 'USD' },
      asset: { assetType: 'CODE', code: PLAINTEXT_CODE },
    });

    const outcome = await h.service.purchase(purchaseInput());

    expect(outcome.status).toBe('SUCCEEDED');
    expect(JSON.stringify(outcome)).not.toContain(PLAINTEXT_CODE);
    expect(JSON.stringify(h.events)).not.toContain(PLAINTEXT_CODE);
  });

  it('never returns a plaintext code from the purchase-status endpoint', async () => {
    const h = harness();
    // A SUCCEEDED status carrying a raw code is exactly what Tillo returns.
    h.provider.setPurchaseStatus('TILLO-REF-1', {
      status: 'SUCCEEDED',
      providerReference: 'TILLO-REF-1',
      cost: { amount: '100.00', currency: 'USD' },
      asset: { assetType: 'CODE', code: PLAINTEXT_CODE },
    });

    const view = await h.service.checkPurchaseStatus({
      providerCode: 'mock',
      providerReference: 'TILLO-REF-1',
    });

    expect(view.status).toBe('SUCCEEDED');
    // The asset TYPE is useful to an operator; the secret is not theirs to read
    // here — that path goes through GiftCardAssetService with an audit event.
    expect(view.assetType).toBe('CODE');
    expect(JSON.stringify(view)).not.toContain(PLAINTEXT_CODE);
    expect(Object.keys(view)).not.toContain('asset');
  });

  it('reports an unreachable provider as UNKNOWN instead of throwing', async () => {
    const h = harness();
    h.provider.getPurchaseStatus = async () => {
      throw new Error('ETIMEDOUT');
    };

    const view = await h.service.checkPurchaseStatus({
      providerCode: 'mock',
      providerReference: 'TILLO-REF-1',
    });

    expect(view.status).toBe('UNKNOWN');
    expect(view.failureCode).toBe('STATUS_CHECK_FAILED');
    expect(view.providerReference).toBe('TILLO-REF-1');
  });
});

describe('offer selection', () => {
  it('picks the cheapest available offer and records the availability check', async () => {
    const h = harness([
      offer({ id: 'offer-expensive', costAmount: '120.00', priority: 1 }),
      offer({ id: OFFER_ID, costAmount: '100.00', priority: 2 }),
    ]);

    const selected = await h.service.selectOffer('sku-1');

    expect(selected.id).toBe(OFFER_ID);
    const checked = h.events.filter((e) => e.action === SUPPLIER_AUDIT_ACTIONS.AVAILABILITY_CHECKED);
    expect(checked.length).toBeGreaterThan(0);
  });

  it('refuses to purchase against an unknown quantity', async () => {
    const h = harness();
    await expect(h.service.purchase({ ...purchaseInput(), quantity: 0 })).rejects.toThrow();
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });
});
