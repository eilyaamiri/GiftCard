import { describe, expect, it } from 'vitest';

import type { TopUpStore } from './suppliers.types';
import { TopUpSchedulerService } from './topup-scheduler.service';
import type { TopUpFulfillmentService } from './topup-fulfillment.service';

function store(due: Awaited<ReturnType<TopUpStore['listDue']>>): TopUpStore {
  return {
    ensureFulfillmentForPaidOrder: async () => null,
    findTargetByOrderId: async () => null,
    listDue: async () => due,
    countConsecutiveUnreachablePolls: async () => 0,
    transition: async () => false,
    recordEvent: async () => undefined,
    transitionOrder: async () => false,
  };
}

describe('TopUpSchedulerService', () => {
  it('retries missing paid traces and polls only due provider orders', async () => {
    const calls: string[] = [];
    const fulfillment = {
      onTopUpOrderPaid: async (orderId: string) => {
        calls.push(`start:${orderId}`);
        return {
          decision: 'WAITING_FUNDS' as const,
          orderId,
          fulfillmentId: 'f-1',
          reason: 'FUNDING_INSUFFICIENT',
          workItemId: null,
        };
      },
      poll: async (orderId: string) => {
        calls.push(`poll:${orderId}`);
        return {
          decision: 'SUCCEEDED' as const,
          orderId,
          fulfillmentId: 'f-2',
          reason: 'PROVIDER_REPORTED_SUCCESS',
          workItemId: null,
        };
      },
    } as unknown as TopUpFulfillmentService;
    const scheduler = new TopUpSchedulerService(
      store([
        { orderId: 'missing-trace', action: 'START' },
        { orderId: 'provider-pending', action: 'POLL' },
      ]),
      fulfillment,
    );

    await expect(scheduler.sweepOnce()).resolves.toEqual({ scanned: 2, completed: 1 });
    expect(calls).toEqual(['start:missing-trace', 'poll:provider-pending']);
  });

  it('prevents overlapping sweeps', async () => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fulfillment = {
      onTopUpOrderPaid: async (orderId: string) => {
        await delayed;
        return {
          decision: 'SUCCEEDED' as const,
          orderId,
          fulfillmentId: 'f-1',
          reason: 'PROVIDER_REPORTED_SUCCESS',
          workItemId: null,
        };
      },
      poll: async () => {
        throw new Error('not called');
      },
    } as unknown as TopUpFulfillmentService;
    const scheduler = new TopUpSchedulerService(
      store([{ orderId: 'pending', action: 'START' }]),
      fulfillment,
    );

    const first = scheduler.sweepOnce();
    await expect(scheduler.sweepOnce()).resolves.toEqual({ scanned: 0, completed: 0 });
    release();
    await expect(first).resolves.toEqual({ scanned: 1, completed: 1 });
  });
});
