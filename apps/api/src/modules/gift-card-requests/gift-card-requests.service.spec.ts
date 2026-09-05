import { describe, expect, it, vi } from 'vitest';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import type { AuthenticatedStaff } from '../identity/identity.tokens';
import type { FulfillmentStore } from '../fulfillment/fulfillment.types';
import {
  AUTO_FULFILLMENT_ACTOR,
  type AutoFulfillmentOutcome,
  type AutoFulfillmentService,
} from '../suppliers/auto-fulfillment.service';
import { GiftCardRequestsService } from './gift-card-requests.service';
import type { GiftCardRequestRow } from './gift-card-requests.types';

const OPERATOR: AuthenticatedStaff = {
  staffId: 'staff-operator',
  role: 'OPERATOR',
} as AuthenticatedStaff;

const WORK_ITEM = {
  id: 'wi-1',
  orderId: 'order-1',
  assignedToStaffId: OPERATOR.staffId,
  type: 'MANUAL_GIFT_CARD_FULFILLMENT',
};

interface AuditEvent {
  readonly action: string;
  readonly actor: string;
  readonly payload: string;
}

/** A row shaped like the Prisma include the service reads back. */
function requestRow(data: Record<string, unknown>): GiftCardRequestRow {
  return {
    id: 'gcr-1',
    requestNumber: 'GCR-TEST000001',
    workItemId: WORK_ITEM.id,
    orderId: WORK_ITEM.orderId,
    kind: 'CODE',
    status: 'OPEN',
    requestReason: 'مشتری منتظر است',
    responseNote: null,
    requestedByStaffId: OPERATOR.staffId,
    fulfilledByStaffId: null,
    giftCardAssetId: null,
    requestedAt: new Date('2026-09-04T09:00:00.000Z'),
    fulfilledAt: null,
    openWorkItemKey: WORK_ITEM.id,
    ...data,
    workItem: { code: 'WI-0001' },
    order: { orderNumber: 'BP-2026-000001' },
    requestedBy: { fullName: 'اپراتور یک' },
    fulfilledBy: null,
    giftCardAsset: { id: 'asset-1', maskedCode: 'XXXX-XXXX-****-8271' },
  } as unknown as GiftCardRequestRow;
}

interface HarnessOptions {
  /** What the supplier attempt does. Default: buys a CODE_PIN card. */
  readonly attempt?: () => Promise<AutoFulfillmentOutcome>;
  /** An earlier FULFILLED request for the same work item. */
  readonly alreadyFulfilled?: boolean;
  /** The asset row the purchase claims to have created. */
  readonly asset?: { id: string; assetType: string } | null;
}

function harness(options: HarnessOptions = {}) {
  const events: AuditEvent[] = [];
  const writer: AuditWriter = {
    append: async (input) => {
      events.push({
        action: input.action,
        actor: input.actor,
        payload: JSON.stringify({ before: input.before ?? null, after: input.after ?? null }),
      });
    },
  };

  const purchased: AutoFulfillmentOutcome = {
    decision: 'PURCHASED',
    workItemId: WORK_ITEM.id,
    assetId: 'asset-1',
    reason: 'SUPPLIER_PURCHASE_SUCCEEDED',
  };
  const attemptForOperatorRequest = vi.fn(options.attempt ?? (async () => purchased));

  const findFirst = vi.fn(async (args: { where: { status?: string } }) => {
    if (args.where.status === 'FULFILLED') {
      return options.alreadyFulfilled === true
        ? requestRow({ id: 'gcr-earlier', status: 'FULFILLED', giftCardAssetId: 'asset-0' })
        : null;
    }
    return null; // no OPEN request yet
  });

  const create = vi.fn(async (args: { data: Record<string, unknown> }) => requestRow(args.data));

  const db = {
    workItem: { findUnique: vi.fn(async () => WORK_ITEM) },
    giftCardAsset: {
      findUnique: vi.fn(async () =>
        options.asset === undefined ? { id: 'asset-1', assetType: 'CODE_PIN' } : options.asset,
      ),
    },
    giftCardCodeRequest: { findFirst, create },
  };

  const service = new GiftCardRequestsService(
    db as never,
    {} as unknown as FulfillmentStore,
    new AuditService(writer),
    { attemptForOperatorRequest } as unknown as AutoFulfillmentService,
  );

  return { service, db, create, attemptForOperatorRequest, events };
}

function request(h: ReturnType<typeof harness>) {
  return h.service.create({
    staff: OPERATOR,
    workItemId: WORK_ITEM.id,
    kind: 'CODE',
    reason: 'مشتری منتظر است',
  });
}

/**
 * The operator asks an admin for a code; the supplier is tried first.
 *
 * The point of every test below is the *fallback*: the supplier attempt is an
 * optimisation on the way to a human, never a gate in front of one. Whatever
 * goes wrong with it, an admin must still end up with an OPEN request — that is
 * the behaviour the operator had before any of this existed.
 */
describe('supplier-first code request', () => {
  it('returns the bought card without ever queueing an admin request', async () => {
    const h = harness();

    const view = await request(h);

    expect(view.status).toBe('FULFILLED');
    expect(view.giftCardAssetId).toBe('asset-1');
    expect(h.attemptForOperatorRequest).toHaveBeenCalledWith({
      workItemId: WORK_ITEM.id,
      staffId: OPERATOR.staffId,
    });

    // Exactly one row, and it is not an admin task: `openWorkItemKey` is what
    // puts a request in the admin queue, and an auto-fulfilled one is closed.
    expect(h.create).toHaveBeenCalledTimes(1);
    const data = h.create.mock.calls[0]?.[0].data;
    expect(data?.['status']).toBe('FULFILLED');
    expect(data?.['openWorkItemKey']).toBeNull();
    // A FK to StaffUser: no person fulfilled this, so it stays null rather than
    // naming an operator who did not do it.
    expect(data?.['fulfilledByStaffId']).toBeNull();
  });

  it('records the automatic fulfilment against the system, not the operator', async () => {
    const h = harness();

    await request(h);

    const fulfilled = h.events.filter(
      (event) => event.action === 'GIFT_CARD_CREDENTIAL_REQUEST_FULFILLED',
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.actor).toBe(AUTO_FULFILLMENT_ACTOR);
    // The requesting operator is still on the record as having asked.
    expect(h.events.some((event) => event.action === 'GIFT_CARD_CREDENTIAL_REQUESTED')).toBe(true);
  });

  it('takes the kind from what the supplier delivered, not from what was asked', async () => {
    // The operator asked for CODE; the supplier returned a card with a PIN.
    const h = harness({ asset: { id: 'asset-1', assetType: 'CODE_PIN' } });

    await request(h);

    expect(h.create.mock.calls[0]?.[0].data['kind']).toBe('CODE_PIN');
  });

  it('sends the request to the admin queue when the float is empty', async () => {
    const h = harness({
      attempt: async () => ({
        decision: 'INSUFFICIENT_FUNDS',
        workItemId: WORK_ITEM.id,
        assetId: null,
        reason: 'FUNDING_INSUFFICIENT',
      }),
    });

    const view = await request(h);

    expect(view.status).toBe('OPEN');
    const data = h.create.mock.calls[0]?.[0].data;
    expect(data?.['status']).toBeUndefined(); // the schema default, OPEN
    expect(data?.['openWorkItemKey']).toBe(WORK_ITEM.id);
    expect(data?.['requestedByStaffId']).toBe(OPERATOR.staffId);
  });

  it.each([
    ['SUPPLIER_UNAVAILABLE', 'SUPPLIER_HAS_NO_ADAPTER'],
    ['PURCHASE_NOT_COMPLETED', 'PURCHASE_NOT_COMPLETED'],
    ['NOT_ELIGIBLE', 'WORK_ITEM_NOT_HELD_BY_REQUESTER'],
  ])('sends the request to the admin queue on %s', async (decision, reason) => {
    const h = harness({
      attempt: async () => ({
        decision: decision as AutoFulfillmentOutcome['decision'],
        workItemId: WORK_ITEM.id,
        assetId: null,
        reason,
      }),
    });

    const view = await request(h);

    expect(view.status).toBe('OPEN');
    expect(h.create.mock.calls[0]?.[0].data['openWorkItemKey']).toBe(WORK_ITEM.id);
  });

  it('sends the request to the admin queue when the supplier call throws', async () => {
    const h = harness({
      attempt: () => Promise.reject(new Error('reloadly 502: <payload>')),
    });

    const view = await request(h);

    expect(view.status).toBe('OPEN');
    // The provider's error text may carry a payload; none of it is audited.
    expect(JSON.stringify(h.events)).not.toContain('reloadly');
  });

  it('sends the request to the admin queue when the purchased asset cannot be found', async () => {
    const h = harness({ asset: null });

    const view = await request(h);

    expect(view.status).toBe('OPEN');
    expect(h.create.mock.calls[0]?.[0].data['openWorkItemKey']).toBe(WORK_ITEM.id);
  });

  it('buys nothing when this task already has a fulfilled request', async () => {
    const h = harness({ alreadyFulfilled: true });

    const view = await request(h);

    expect(view.id).toBe('gcr-earlier');
    expect(h.attemptForOperatorRequest).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('refuses a request for a work item the operator does not hold', async () => {
    const h = harness();
    h.db.workItem.findUnique.mockResolvedValueOnce({
      ...WORK_ITEM,
      assignedToStaffId: 'staff-someone-else',
    });

    await expect(request(h)).rejects.toThrow();
    expect(h.attemptForOperatorRequest).not.toHaveBeenCalled();
  });
});
