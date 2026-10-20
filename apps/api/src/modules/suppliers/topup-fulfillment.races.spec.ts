import { describe, expect, it } from 'vitest';
// From the barrel, never `@barat/suppliers/providers/*` (import-boundary rule).
import { MockSupplierProvider } from '@barat/suppliers';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import { WorkItemsService } from '../workitems/workitems.service';
import { InMemoryWorkItemStore } from '../workitems/testing/in-memory-workitem.store';
import { TopUpFulfillmentService } from './topup-fulfillment.service';
import { InMemoryTopUpStore } from './testing/in-memory-topup.store';
import type { TopUpTarget } from './suppliers.types';

/**
 * Races on the top-up path that used to end in a task for an operator.
 *
 * A top-up raises a work item only when it genuinely failed or its outcome is
 * genuinely unknown. These tests cover the cases where the service *thought*
 * so on a stale read — another path had already settled the top-up — and
 * escalated anyway, handing someone a "do it by hand" task for a top-up that
 * had been delivered: one payment, two deliveries.
 */

const ORDER_ID = 'order-topup-race';
const FULFILLMENT_ID = 'topup-race-1';
const PROVIDER_SKU = 'telegram:stars:500';

function target(overrides: Partial<TopUpTarget> = {}): TopUpTarget {
  return {
    orderId: ORDER_ID,
    customerId: 'customer-1',
    orderStatus: 'PAID',
    fulfillmentId: FULFILLMENT_ID,
    status: 'AWAITING_PROVIDER',
    providerSku: PROVIDER_SKU,
    costAmount: '4.75',
    costCurrency: 'USD',
    supplierCode: 'mock',
    supplierId: 'sup-1',
    accountFields: { telegram_username: 'player_one' },
    providerOrderNumber: 'ord-77',
    purchaseAttempts: 0,
    ...overrides,
  };
}

function harness(row: TopUpTarget) {
  const audit = new AuditService({ append: async () => undefined } satisfies AuditWriter);
  const workItems = new InMemoryWorkItemStore();
  const provider = new MockSupplierProvider({ availability: { [PROVIDER_SKU]: 'AVAILABLE' } });
  const topUpStore = new InMemoryTopUpStore({ targets: [row], orderStatuses: { [ORDER_ID]: 'PAID' } });
  const service = new TopUpFulfillmentService(
    topUpStore,
    [provider],
    new WorkItemsService(workItems, audit),
    audit,
  );
  return { service, provider, workItems, topUpStore };
}

/** Another poller wins and records SUCCEEDED while this one is mid-request. */
async function concurrentSuccess(store: InMemoryTopUpStore): Promise<void> {
  await store.transition({
    fulfillmentId: FULFILLMENT_ID,
    from: ['AWAITING_PROVIDER'],
    to: 'SUCCEEDED',
    event: { type: 'SUCCEEDED' },
  });
}

describe('a top-up already settled by another path is never escalated', () => {
  it('opens no "do it by hand" task when a stale poll reads FAILED after a success landed', async () => {
    const h = harness(target());
    h.provider.getPurchaseStatus = async (reference) => {
      await concurrentSuccess(h.topUpStore);
      return { status: 'FAILED', providerReference: reference, failureCode: 'PROVIDER_DECLINED' };
    };

    const outcome = await h.service.poll(ORDER_ID);

    expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', workItemId: null });
    expect(h.workItems.rows.size).toBe(0);
    expect(h.topUpStore.statusOf(FULFILLMENT_ID)).toBe('SUCCEEDED');
  });

  it('opens no UNKNOWN task when a stale poll reads UNKNOWN after a success landed', async () => {
    const h = harness(target());
    h.provider.getPurchaseStatus = async (reference) => {
      await concurrentSuccess(h.topUpStore);
      return { status: 'UNKNOWN', providerReference: reference, failureCode: 'ORDER_STATUS_UNKNOWN' };
    };

    const outcome = await h.service.poll(ORDER_ID);

    expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', workItemId: null });
    expect(h.workItems.rows.size).toBe(0);
  });

  it('still opens exactly one task on a genuine failure', async () => {
    const h = harness(target());
    h.provider.setPurchaseStatus('ord-77', {
      status: 'FAILED',
      providerReference: 'ord-77',
      failureCode: 'PROVIDER_DECLINED',
    });

    const outcome = await h.service.poll(ORDER_ID);

    expect(outcome.decision).toBe('FAILED');
    expect(h.workItems.rows.size).toBe(1);
  });
});

describe('a replayed payment callback on a top-up the venue already has', () => {
  it('stands down instead of re-running the funding check and marking it UNKNOWN', async () => {
    // One retry short of exhaustion, with an empty float: the old path walked
    // straight into "funding exhausted" and opened a task on a live venue order.
    const h = harness(target({ purchaseAttempts: 143 }));
    h.provider.setBalance({ amount: '0.00', currency: 'USD' });

    const outcome = await h.service.onTopUpOrderPaid(ORDER_ID);

    expect(outcome).toMatchObject({ decision: 'NOT_ELIGIBLE', reason: 'AWAITING_PROVIDER', workItemId: null });
    expect(h.workItems.rows.size).toBe(0);
    expect(h.topUpStore.statusOf(FULFILLMENT_ID)).toBe('AWAITING_PROVIDER');
    expect(h.provider.getPurchaseInvocationCount()).toBe(0);
  });
});
