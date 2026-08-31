import { describe, expect, it } from 'vitest';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import { InMemoryWorkItemStore } from './testing/in-memory-workitem.store';
import { WorkItemsService } from './workitems.service';
import { MAX_CONCURRENT_WORK_ITEMS_PER_OPERATOR } from './workitems.types';

interface Harness {
  readonly service: WorkItemsService;
  readonly store: InMemoryWorkItemStore;
  readonly actions: string[];
}

function harness(): Harness {
  const store = new InMemoryWorkItemStore([
    { id: 'op-1', role: 'OPERATOR', isActive: true },
    { id: 'op-2', role: 'OPERATOR', isActive: true },
    { id: 'op-3', role: 'OPERATOR', isActive: true },
  ]);
  store.addQueueMember('GIFT_CARD_MANUAL', 'op-1');
  store.addQueueMember('GIFT_CARD_MANUAL', 'op-2');
  store.addQueueMember('GIFT_CARD_MANUAL', 'op-3');

  const actions: string[] = [];
  const writer: AuditWriter = {
    append: async (input) => {
      actions.push(input.action);
    },
  };

  return { service: new WorkItemsService(store, new AuditService(writer)), store, actions };
}

describe('one work item per paid order', () => {
  it('creates exactly one work item when the paid trigger fires repeatedly', async () => {
    const h = harness();

    // A gateway callback that arrives five times — the normal case, not an edge case.
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await h.service.onOrderPaid({ orderId: 'order-1', customerId: 'cust-1' }));
    }

    const ids = new Set(results.map((item) => item.id));
    expect(ids.size).toBe(1);
    expect(h.store.rows.size).toBe(1);
    expect(h.actions.filter((action) => action === 'WORK_ITEM_CREATED')).toHaveLength(1);
  });

  it('creates one work item when concurrent triggers race', async () => {
    const h = harness();

    const results = await Promise.all([
      h.service.onOrderPaid({ orderId: 'order-1' }),
      h.service.onOrderPaid({ orderId: 'order-1' }),
      h.service.onOrderPaid({ orderId: 'order-1' }),
    ]);

    expect(new Set(results.map((item) => item.id)).size).toBe(1);
    expect(h.store.rows.size).toBe(1);
  });

  it('resolves a unique-constraint loss into the winning row instead of an error', async () => {
    const h = harness();
    const winner = await h.service.onOrderPaid({ orderId: 'order-1' });

    // Force the "another process inserted first" path: findByOrderId is bypassed
    // by pretending the read happened before the winner committed.
    h.store.failNextCreates = 1;
    const loser = await h.service.onOrderPaid({ orderId: 'order-1' });

    expect(loser.id).toBe(winner.id);
    expect(h.store.rows.size).toBe(1);
  });

  it('keeps escalations out of the order lock so they can coexist', async () => {
    const h = harness();
    const fulfillment = await h.service.onOrderPaid({ orderId: 'order-1' });

    const escalation = await h.service.openEscalation({
      code: 'WI-ESC-order-1-UNKNOWN',
      orderId: 'order-1',
      type: 'UNKNOWN_OUTCOME',
    });

    expect(escalation.id).not.toBe(fulfillment.id);
    expect(h.store.rows.size).toBe(2);
    // The fulfillment item still owns the order lock.
    expect(await h.service.findByOrderId('order-1')).toMatchObject({ id: fulfillment.id });
  });

  it('makes escalations idempotent on their deterministic code', async () => {
    const h = harness();
    await h.service.onOrderPaid({ orderId: 'order-1' });

    const first = await h.service.openEscalation({
      code: 'WI-ESC-order-1-UNKNOWN',
      orderId: 'order-1',
      type: 'UNKNOWN_OUTCOME',
    });
    const second = await h.service.openEscalation({
      code: 'WI-ESC-order-1-UNKNOWN',
      orderId: 'order-1',
      type: 'UNKNOWN_OUTCOME',
    });

    expect(second.id).toBe(first.id);
    expect(h.store.rows.size).toBe(2);
  });
});

describe('claiming', () => {
  it('gives a concurrently claimed item to exactly one operator', async () => {
    const h = harness();
    const item = await h.service.onOrderPaid({ orderId: 'order-1' });

    const results = await Promise.allSettled([
      h.service.claim(item.id, 'op-1'),
      h.service.claim(item.id, 'op-2'),
      h.service.claim(item.id, 'op-3'),
    ]);

    const winners = results.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);

    const stored = await h.service.getById(item.id);
    expect(stored.status).toBe('ASSIGNED');
    expect(stored.assignedToStaffId).not.toBeNull();
    expect(h.actions.filter((action) => action === 'WORK_ITEM_CLAIMED')).toHaveLength(1);
  });

  it('refuses a second claim on an item that is already assigned', async () => {
    const h = harness();
    const item = await h.service.onOrderPaid({ orderId: 'order-1' });
    await h.service.claim(item.id, 'op-1');

    await expect(h.service.claim(item.id, 'op-2')).rejects.toThrow();
    expect((await h.service.getById(item.id)).assignedToStaffId).toBe('op-1');
  });

  it('enforces the concurrent-item cap on the server', async () => {
    const h = harness();

    for (let i = 0; i < MAX_CONCURRENT_WORK_ITEMS_PER_OPERATOR; i += 1) {
      const item = await h.service.onOrderPaid({ orderId: `order-${String(i)}` });
      await h.service.claim(item.id, 'op-1');
    }

    const overflow = await h.service.onOrderPaid({ orderId: 'order-overflow' });
    await expect(h.service.claim(overflow.id, 'op-1')).rejects.toThrow();

    // Another operator is unaffected: the cap is per person, not per queue.
    await expect(h.service.claim(overflow.id, 'op-2')).resolves.toMatchObject({
      assignedToStaffId: 'op-2',
    });
  });

  it('refuses a claim from an operator outside the queue', async () => {
    const h = harness();
    h.store.addStaff({ id: 'op-outsider', role: 'OPERATOR', isActive: true });
    const item = await h.service.onOrderPaid({ orderId: 'order-1' });

    await expect(h.service.claim(item.id, 'op-outsider')).rejects.toThrow();
  });

  it('refuses a claim from a deactivated or non-claiming role', async () => {
    const h = harness();
    h.store.addStaff({ id: 'op-disabled', role: 'OPERATOR', isActive: false });
    h.store.addStaff({ id: 'viewer', role: 'VIEWER', isActive: true });
    h.store.addQueueMember('GIFT_CARD_MANUAL', 'op-disabled');
    h.store.addQueueMember('GIFT_CARD_MANUAL', 'viewer');
    const item = await h.service.onOrderPaid({ orderId: 'order-1' });

    await expect(h.service.claim(item.id, 'op-disabled')).rejects.toThrow();
    await expect(h.service.claim(item.id, 'viewer')).rejects.toThrow();
    expect((await h.service.getById(item.id)).assignedToStaffId).toBeNull();
  });

  it('frees the order lock when the item completes, so a re-fulfillment is possible', async () => {
    const h = harness();
    const item = await h.service.onOrderPaid({ orderId: 'order-1' });
    await h.service.claim(item.id, 'op-1');
    await h.service.complete(item.id, 'op-1', 'delivered');

    const replacement = await h.service.onOrderPaid({ orderId: 'order-1' });
    expect(replacement.id).not.toBe(item.id);
    expect(h.store.rows.size).toBe(2);
  });
});
