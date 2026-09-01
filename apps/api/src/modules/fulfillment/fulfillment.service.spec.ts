import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import type { StaffContext } from '../workitems/staff-context';
import { AuditService, type AuditWriter } from '../audit/audit.service';
import { ChecklistService } from './checklist.service';
import { SHIPPED_CHECKLIST_TEMPLATES } from './checklist-templates';
import { FulfillmentService } from './fulfillment.service';
import { GiftCardAssetService, GIFT_CARD_AUDIT_ACTIONS } from './gift-card-asset.service';
import { SEND_BLOCKERS } from './checklist-evaluation';
import { MockAssetDeliveryTransport } from './transports/mock-asset-delivery.transport';
import { InMemoryFulfillmentStore, type SeedFulfillment } from './testing/in-memory-fulfillment.store';

/**
 * The gift-card code used throughout. Every "must not leak" assertion searches
 * for this exact string in whatever the system produced.
 */
const PLAINTEXT_CODE = 'ABCD-1234-5678-8271';
const PLAINTEXT_PIN = '4417';

const OPERATOR: StaffContext = { id: 'staff-operator', role: 'OPERATOR' };
const MANAGER: StaffContext = { id: 'staff-manager', role: 'OPS_MANAGER' };

interface AuditEvent {
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly actor: string;
  readonly payload: string;
}

interface Harness {
  readonly service: FulfillmentService;
  readonly store: InMemoryFulfillmentStore;
  readonly transport: MockAssetDeliveryTransport;
  readonly events: AuditEvent[];
}

function harness(seed: SeedFulfillment = {}): Harness {
  const store = new InMemoryFulfillmentStore(seed);
  const transport = new MockAssetDeliveryTransport();
  const events: AuditEvent[] = [];

  const writer: AuditWriter = {
    append: async (input) => {
      events.push({
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        actor: input.actor,
        payload: JSON.stringify({ before: input.before ?? null, after: input.after ?? null }),
      });
    },
  };

  const audit = new AuditService(writer);
  const checklists = new ChecklistService(store, audit);
  const assets = new GiftCardAssetService(store, audit);
  const service = new FulfillmentService(store, transport, checklists, assets, audit);

  return { service, store, transport, events };
}

/** Records a CODE_PIN asset with the given actual cost, as an operator would. */
async function recordAsset(h: Harness, actualSupplierCost: string): Promise<void> {
  await h.service.recordSupplierResult({
    workItemId: h.store.workItemId,
    staff: OPERATOR,
    supplierReference: 'SUP-REF-9001',
    actualSupplierCost,
    actualSupplierCurrency: 'USD',
    asset: { assetType: 'CODE_PIN', code: PLAINTEXT_CODE, pin: PLAINTEXT_PIN },
  });
}

/** Ticks the two human-confirmation items in the gift-card template. */
async function tickBooleans(h: Harness): Promise<void> {
  for (const itemKey of ['SUPPLIER_ORDER_PLACED', 'ASSET_MATCHES_ORDER']) {
    await h.service.checkItem({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey,
      checked: true,
    });
  }
}

beforeEach(() => {
  // A fresh key per test: nothing may depend on a fixed key or a fixed ciphertext.
  process.env['GIFT_CARD_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
});

describe('operator checklist confirmation', () => {
  it('ships no manager-only rows in any task checklist template', () => {
    for (const template of Object.values(SHIPPED_CHECKLIST_TEMPLATES)) {
      expect(template.definition.some((item) => item.type === 'MANAGER_APPROVAL')).toBe(false);
      expect(template.definition.some((item) => item.key === 'COST_VARIANCE_APPROVAL')).toBe(false);
    }
  });

  it('lets the operator manually confirm system-derived and required-field items', async () => {
    const h = harness({ hasVerifiedPayment: false, deliveryEmail: null });

    const initial = await h.service.getWorkspace(h.store.workItemId, OPERATOR);
    expect(initial.checklist.items.every((item) => item.isOperatorEditable)).toBe(true);
    expect(initial.checklist.items.some((item) => item.type === 'MANAGER_APPROVAL')).toBe(false);
    expect(initial.checklist.items.find((item) => item.key === 'PAYMENT_VERIFIED')?.status).toBe('PENDING');
    expect(initial.checklist.items.find((item) => item.key === 'DELIVERY_EMAIL_PRESENT')?.status).toBe('PENDING');

    await h.service.checkItem({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey: 'PAYMENT_VERIFIED',
      checked: true,
    });
    const confirmed = await h.service.checkItem({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey: 'DELIVERY_EMAIL_PRESENT',
      checked: true,
    });

    for (const key of ['PAYMENT_VERIFIED', 'DELIVERY_EMAIL_PRESENT']) {
      const item = confirmed.checklist.items.find((candidate) => candidate.key === key);
      expect(item?.status).toBe('PASSED');
      expect(item?.type).toBe('BOOLEAN');
      expect(item?.verifiedByStaffId).toBe(OPERATOR.id);
      expect(item?.verifiedAt).not.toBeNull();
    }

    // Manual checklist confirmation never replaces the authoritative payment gate.
    expect(confirmed.sendBlockers).toContain(SEND_BLOCKERS.PAYMENT_NOT_VERIFIED);
  });

  it('turns a system-passed item into a reversible operator confirmation', async () => {
    const h = harness();
    const confirmed = await h.service.checkItem({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey: 'PAYMENT_VERIFIED',
      checked: true,
    });
    expect(confirmed.checklist.items.find((item) => item.key === 'PAYMENT_VERIFIED')?.type).toBe('BOOLEAN');

    const returned = await h.service.checkItem({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey: 'PAYMENT_VERIFIED',
      checked: false,
    });
    const item = returned.checklist.items.find((candidate) => candidate.key === 'PAYMENT_VERIFIED');
    expect(item?.status).toBe('PENDING');
    expect(item?.verifiedByStaffId).toBeNull();
  });

  it('lets the operator return a manual confirmation to pending', async () => {
    const h = harness({ hasVerifiedPayment: false });
    await h.service.checkItem({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey: 'PAYMENT_VERIFIED',
      checked: true,
    });

    const returned = await h.service.checkItem({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey: 'PAYMENT_VERIFIED',
      checked: false,
    });
    const item = returned.checklist.items.find((candidate) => candidate.key === 'PAYMENT_VERIFIED');
    expect(item?.status).toBe('PENDING');
    expect(item?.verifiedByStaffId).toBeNull();
    expect(item?.verifiedAt).toBeNull();
  });
});

describe('send gate', () => {
  it('refuses to send while a blocking checklist item is unticked, even when the service is called directly', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    // The BOOLEAN items are deliberately left unticked. A frontend that hid the
    // checklist entirely and posted straight to /send would land exactly here.

    await expect(h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR })).rejects.toThrow();
    expect(h.transport.getSendCount()).toBe(0);

    const blocked = h.events.filter((event) => event.action === 'FULFILLMENT_SEND_BLOCKED');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.payload).toContain(SEND_BLOCKERS.CHECKLIST_INCOMPLETE);
  });

  it('refuses to send when the payment is not verified', async () => {
    const h = harness({ hasVerifiedPayment: false });
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    await expect(h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR })).rejects.toThrow();
    expect(h.transport.getSendCount()).toBe(0);
  });

  it('sends once every blocking item is satisfied', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    const outcome = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(outcome.delivered).toBe(true);
    expect(h.transport.getSendCount()).toBe(1);
    expect(outcome.workspace.checklist.isLocked).toBe(true);
  });

  it('locks the checklist after a send, so a second send is refused', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);
    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    await expect(h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR })).rejects.toThrow();
    expect(h.transport.getSendCount()).toBe(1);
  });
});

describe('cost variance', () => {
  it('blocks the send when the actual supplier cost exceeds the tolerance', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    // 120 against a 100 quote is 2000 bps — four times the 500 bps ceiling.
    await recordAsset(h, '120.00');
    await tickBooleans(h);

    const workspace = await h.service.getWorkspace(h.store.workItemId, OPERATOR);
    expect(workspace.sendBlockers).toContain(SEND_BLOCKERS.COST_VARIANCE_UNAPPROVED);
    expect(workspace.costVariance?.varianceBps).toBe(2_000);
    // Cost variance is an independent financial gate, not a manager-only
    // checklist row. It remains blocked until the dedicated approval succeeds.
    expect(workspace.checklist.items.some((item) => item.type === 'MANAGER_APPROVAL')).toBe(false);
    expect(workspace.checklist.items.some((item) => item.key === 'COST_VARIANCE_APPROVAL')).toBe(false);

    await expect(h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR })).rejects.toThrow();
    expect(h.transport.getSendCount()).toBe(0);
  });

  it('allows the send after a manager approves the variance', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '120.00');
    await tickBooleans(h);

    await h.service.approveCostVariance({
      workItemId: h.store.workItemId,
      staff: MANAGER,
      reason: 'supplier raised the price mid-purchase; margin still positive',
    });

    const outcome = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });
    expect(outcome.delivered).toBe(true);

    const approvals = h.events.filter((event) => event.action === 'APPROVE_COST_VARIANCE');
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.actor).toBe(MANAGER.id);
  });

  it('does not block a spend that is inside the tolerance', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '104.00'); // 400 bps
    await tickBooleans(h);

    const workspace = await h.service.getWorkspace(h.store.workItemId, OPERATOR);
    expect(workspace.sendBlockers).toHaveLength(0);
  });

  it('refuses to let an operator approve their own variance', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '120.00');

    // Same person, but wearing a manager hat: still refused, because they are the
    // one who recorded the spend.
    const selfApprover: StaffContext = { id: OPERATOR.id, role: 'OPS_MANAGER' };
    await expect(
      h.service.approveCostVariance({
        workItemId: h.store.workItemId,
        staff: selfApprover,
        reason: 'trust me',
      }),
    ).rejects.toThrow();

    const fulfillment = [...h.store.fulfillments.values()][0];
    expect(fulfillment?.approvedByStaffId).toBeNull();
    expect(h.events.some((event) => event.action === 'APPROVE_COST_VARIANCE')).toBe(false);
  });

  it('refuses an approval from a non-manager', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '120.00');

    await expect(
      h.service.approveCostVariance({
        workItemId: h.store.workItemId,
        staff: { id: 'staff-other-operator', role: 'OPERATOR' },
        reason: 'looks fine',
      }),
    ).rejects.toThrow();
  });

  it('records only one approval when two managers race', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '120.00');

    const results = await Promise.allSettled([
      h.service.approveCostVariance({ workItemId: h.store.workItemId, staff: MANAGER, reason: 'approved by A' }),
      h.service.approveCostVariance({
        workItemId: h.store.workItemId,
        staff: { id: 'staff-manager-2', role: 'ADMIN' },
        reason: 'approved by B',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(h.events.filter((event) => event.action === 'APPROVE_COST_VARIANCE')).toHaveLength(1);
  });
});

describe('gift-card secrecy', () => {
  it('stores the code encrypted and never in clear', async () => {
    const h = harness();
    await recordAsset(h, '100.00');

    const row = h.store.rawAssets()[0];
    expect(row).toBeDefined();
    expect(row?.encryptedCode).not.toBeNull();
    expect(row?.encryptedCode).not.toContain(PLAINTEXT_CODE);
    expect(row?.encryptedPin).not.toContain(PLAINTEXT_PIN);
    // The AES-GCM envelope: version, IV, tag, ciphertext.
    expect(row?.encryptedCode?.startsWith('v1.')).toBe(true);
    expect(row?.encryptedCode?.split('.')).toHaveLength(4);
    // A fresh IV per record means the same code never encrypts to the same blob.
    expect(row?.encryptedCode).not.toBe(row?.encryptedPin);
    expect(row?.maskedCode).toBe('ABCD-XXXX-XXXX-8271');
  });

  it('keeps the code out of every serialised workspace and audit payload', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);
    const outcome = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    const serialisedWorkspace = JSON.stringify(outcome.workspace);
    expect(serialisedWorkspace).not.toContain(PLAINTEXT_CODE);
    expect(serialisedWorkspace).not.toContain(PLAINTEXT_PIN);

    const serialisedAudit = JSON.stringify(h.events);
    expect(serialisedAudit).not.toContain(PLAINTEXT_CODE);
    expect(serialisedAudit).not.toContain(PLAINTEXT_PIN);

    // Nor may the ciphertext escape into a view.
    const row = h.store.rawAssets()[0];
    expect(serialisedWorkspace).not.toContain(row?.encryptedCode ?? 'unreachable');
  });

  it('audits GIFT_CARD_CODE_VIEWED on every plaintext read, without the code', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    const assetId = h.store.rawAssets()[0]?.id ?? '';

    const secret = await h.service.revealAssetSecret({
      workItemId: h.store.workItemId,
      assetId,
      staff: OPERATOR,
      reason: 'customer says the card was rejected at checkout',
    });

    expect(secret.code).toBe(PLAINTEXT_CODE);
    expect(secret.pin).toBe(PLAINTEXT_PIN);

    const views = h.events.filter((event) => event.action === GIFT_CARD_AUDIT_ACTIONS.CODE_VIEWED);
    expect(views).toHaveLength(1);
    expect(views[0]?.actor).toBe(OPERATOR.id);
    expect(views[0]?.entityId).toBe(assetId);
    expect(views[0]?.payload).toContain(h.store.orderId);
    expect(views[0]?.payload).not.toContain(PLAINTEXT_CODE);
    expect(views[0]?.payload).not.toContain(PLAINTEXT_PIN);

    // The read is counted, so an unusual number of reveals is visible in reporting.
    expect(h.store.rawAssets()[0]?.accessCount).toBe(1);
  });

  it('audits the delivery read too — sending is a plaintext access', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);
    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    const views = h.events.filter((event) => event.action === GIFT_CARD_AUDIT_ACTIONS.CODE_VIEWED);
    expect(views).toHaveLength(1);
    expect(views[0]?.payload).toContain('DELIVERY_SEND');
  });
});

describe('delivery retry', () => {
  it('reuses the same asset after a delivery failure and never creates a second one', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    const originalAssetId = h.store.rawAssets()[0]?.id;
    const originalCiphertext = h.store.rawAssets()[0]?.encryptedCode;

    h.transport.setOutcome({ success: false, failureCode: 'MAILBOX_FULL' });
    const failed = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(failed.delivered).toBe(false);
    expect(failed.failureCode).toBe('MAILBOX_FULL');
    expect(h.store.assets.size).toBe(1);
    expect(h.store.rawAssets()[0]?.status).toBe('DELIVERY_FAILED');

    h.transport.setOutcome({ success: true });
    const retried = await h.service.retryDelivery({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(retried.delivered).toBe(true);
    expect(retried.assetId).toBe(originalAssetId);
    expect(retried.attemptNumber).toBe(2);
    // The whole point: same row, same ciphertext, nothing re-purchased.
    expect(h.store.assets.size).toBe(1);
    expect(h.store.rawAssets()[0]?.encryptedCode).toBe(originalCiphertext);
    expect(h.store.attempts).toHaveLength(2);
  });

  it('lets the worker retry the same asset without an operator claim', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    h.transport.setOutcome({ success: false, failureCode: 'SMTP_TIMEOUT' });
    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });
    const assetId = h.store.rawAssets()[0]?.id ?? '';

    h.transport.setOutcome({ success: true });
    const retried = await h.service.retryDeliveryForAsset(assetId);

    expect(retried.delivered).toBe(true);
    expect(retried.assetId).toBe(assetId);
    expect(h.store.assets.size).toBe(1);
    // The system, not a human, is the actor on an automatic retry.
    const sent = h.events.filter((event) => event.action === 'FULFILLMENT_DELIVERY_RETRIED');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.actor).toBe('system:delivery-retry');
  });

  it('refuses to retry an asset that already went out', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);
    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });
    const assetId = h.store.rawAssets()[0]?.id ?? '';

    await expect(h.service.retryDeliveryForAsset(assetId)).rejects.toThrow();
    expect(h.transport.getSendCount()).toBe(1);
  });

  it('hands the asset to the transport exactly once when two senders race', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    const results = await Promise.allSettled([
      h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR }),
      h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(h.transport.getSendCount()).toBe(1);
  });
});

describe('asset recording', () => {
  it('refuses to record a second asset for the same order', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await expect(recordAsset(h, '100.00')).rejects.toThrow();
    expect(h.store.assets.size).toBe(1);
  });

  it('stores no ciphertext for an asset type that has no secret', async () => {
    const h = harness();
    await h.service.recordSupplierResult({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      supplierReference: 'SUP-REF-URL',
      actualSupplierCost: '100.00',
      actualSupplierCurrency: 'USD',
      asset: { assetType: 'URL', deliveryUrl: 'https://redeem.example.com/abc' },
    });

    const row = h.store.rawAssets()[0];
    expect(row?.encryptedCode).toBeNull();
    expect(row?.encryptedPin).toBeNull();
    expect(row?.maskedCode).toBeNull();
    expect(row?.deliveryUrl).toBe('https://redeem.example.com/abc');
  });
});
