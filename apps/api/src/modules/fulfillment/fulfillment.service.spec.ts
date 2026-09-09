import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { seal } from '../../common/crypto/aead-envelope';
import { SERVICE_ACCOUNT_PASSWORD_AAD as ACCOUNT_AAD } from '../quotes/service-account-fields';
import type { StaffContext } from '../workitems/staff-context';
import { AuditService, type AuditWriter } from '../audit/audit.service';
import { ChecklistService } from './checklist.service';
import { SHIPPED_CHECKLIST_TEMPLATES } from './checklist-templates';
import { FulfillmentService } from './fulfillment.service';
import { GiftCardAssetService, GIFT_CARD_AUDIT_ACTIONS } from './gift-card-asset.service';
import { SEND_BLOCKERS } from './checklist-evaluation';
import type {
  PaymentReceiptService,
  PaymentReceiptInfo,
  StoredPaymentReceipt,
} from './payment-receipt.service';
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

class InMemoryPaymentReceiptService {
  receipt: StoredPaymentReceipt | null = null;
  savedOrderId: string | null = null;

  async save(
    orderId: string,
    file: { readonly mimetype: string; readonly buffer: Buffer },
  ): Promise<PaymentReceiptInfo> {
    const uploadedAt = new Date('2026-09-08T10:00:00.000Z');
    this.savedOrderId = orderId;
    this.receipt = {
      contentType: 'image/png',
      sizeBytes: file.buffer.length,
      uploadedAt,
      content: Buffer.from(file.buffer),
      filename: 'payment-receipt.png',
    };
    return this.receipt;
  }

  async info(orderId: string): Promise<PaymentReceiptInfo | null> {
    if (this.receipt === null || orderId !== this.savedOrderId) return null;
    const { contentType, sizeBytes, uploadedAt } = this.receipt;
    return { contentType, sizeBytes, uploadedAt };
  }

  async read(orderId: string): Promise<StoredPaymentReceipt> {
    if (this.receipt === null || orderId !== this.savedOrderId) {
      throw new Error('payment receipt not found');
    }
    return this.receipt;
  }

  async readIfExists(orderId: string): Promise<StoredPaymentReceipt | null> {
    return this.receipt !== null && orderId === this.savedOrderId ? this.receipt : null;
  }
}

interface Harness {
  readonly service: FulfillmentService;
  readonly store: InMemoryFulfillmentStore;
  readonly transport: MockAssetDeliveryTransport;
  readonly receipts: InMemoryPaymentReceiptService;
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
  const receipts = new InMemoryPaymentReceiptService();
  const service = new FulfillmentService(
    store,
    transport,
    checklists,
    assets,
    audit,
    receipts as unknown as PaymentReceiptService,
    {
    /* A fresh buffer per call, like the real config: the service zeroes the key
     * it is handed as soon as it has finished with it. */
    bankDetailsEncryptionKey: () => Buffer.alloc(32, 7),
  } as never);

  return { service, store, transport, receipts, events };
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

/**
 * The self-service channel, used when the system fulfills an order by itself.
 *
 * It waives exactly one checklist item: `DELIVERY_EMAIL_PRESENT`, which is
 * unsatisfiable because checkout never collects a delivery address, and which
 * is meaningless when the card is published to the customer's own order page
 * rather than mailed. The tests here are about the *scope* of that waiver —
 * a waiver that quietly grew would let an unverified card reach a customer.
 */
describe('self-service delivery', () => {
  it('publishes the card without a delivery e-mail, and never touches the transport', async () => {
    const h = harness({ deliveryEmail: null });
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    const outcome = await h.service.deliverBySelfService(h.store.workItemId);

    expect(outcome.delivered).toBe(true);
    /* No e-mail was sent and none was claimed to have been. Only a mock
     * transport is bound, so recording a send here would be a lie in the
     * customer's own delivery history. */
    expect(h.transport.getSendCount()).toBe(0);
    expect(h.store.rawAssets()[0]?.status).toBe('SENT');
    expect(h.store.attempts[0]?.recipientMasked).toBe('self-service');
  });

  it('still refuses when a blocking item other than the e-mail is unsatisfied', async () => {
    const h = harness({ deliveryEmail: null });
    await recordAsset(h, '100.00');
    // The two BOOLEAN confirmations are deliberately left unticked.

    await expect(h.service.deliverBySelfService(h.store.workItemId)).rejects.toThrow();
    expect(h.store.rawAssets()[0]?.status).toBe('READY');
  });

  it('still refuses when the payment is not verified', async () => {
    const h = harness({ hasVerifiedPayment: false, deliveryEmail: null });
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    /* The waiver covers CHECKLIST_INCOMPLETE only, and only when every
     * unsatisfied key is the delivery e-mail. An unverified payment is a
     * separate blocker and must survive. */
    await expect(h.service.deliverBySelfService(h.store.workItemId)).rejects.toThrow();
    expect(h.store.rawAssets()[0]?.status).toBe('READY');
  });

  it('still refuses an unapproved cost variance', async () => {
    const h = harness({ deliveryEmail: null });
    // 20% above the quoted cost, far beyond the 500bps tolerance.
    await recordAsset(h, '120.00');
    await tickBooleans(h);

    await expect(h.service.deliverBySelfService(h.store.workItemId)).rejects.toThrow();
    expect(h.store.rawAssets()[0]?.status).toBe('READY');
  });

  it('keeps the plaintext out of the delivery audit trail', async () => {
    const h = harness({ deliveryEmail: null });
    await recordAsset(h, '100.00');
    await tickBooleans(h);

    await h.service.deliverBySelfService(h.store.workItemId);

    expect(JSON.stringify(h.events)).not.toContain(PLAINTEXT_CODE);
    expect(JSON.stringify(h.events)).not.toContain(PLAINTEXT_PIN);
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

describe('international payment', () => {
  const ACCOUNT_PASSWORD = 'correct-horse-battery-staple';

  function paymentHarness(): Harness {
    return harness({
      workItemType: 'INTERNATIONAL_PAYMENT',
      queueKey: 'SAAS_PAYMENT',
      quotedSupplierCost: '24.99',
      internationalPayment: {
        serviceNameFa: 'ابزارهای هوش مصنوعی',
        payableAmount: '24.99',
        payableCurrency: 'USD',
        siteUrl: 'https://openai.com/pricing',
        accountUsername: 'buyer@example.com',
        hasAccountPassword: true,
      },
      serviceAccountPasswordEnvelope: seal(ACCOUNT_PASSWORD, Buffer.alloc(32, 7), ACCOUNT_AAD),
    });
  }

  async function prepareProviderDirectPayment(h: Harness): Promise<void> {
    await h.service.recordSupplierResult({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      supplierReference: 'PAYMENT-REF-9001',
      actualSupplierCost: '24.99',
      actualSupplierCurrency: 'USD',
      asset: {
        assetType: 'PROVIDER_DIRECT_EMAIL',
        recipientEmail: 'buyer@example.com',
      },
    });
    await h.service.setField({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      itemKey: 'SERVICE_ACCOUNT_REFERENCE',
      value: 'buyer@example.com',
    });
    for (const itemKey of ['PAYMENT_EXECUTED_ABROAD', 'SUBSCRIPTION_ACTIVE_CONFIRMED']) {
      await h.service.checkItem({
        workItemId: h.store.workItemId,
        staff: OPERATOR,
        itemKey,
        checked: true,
      });
    }
  }

  it('stores only safe receipt metadata in the workspace and audit trail', async () => {
    const h = paymentHarness();
    const marker = 'supplier-secret-marker';

    const workspace = await h.service.uploadPaymentReceipt({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      file: { mimetype: 'image/png', buffer: Buffer.from(marker) },
    });

    expect(h.receipts.savedOrderId).toBe(h.store.orderId);
    expect(workspace.paymentReceipt).toEqual({
      contentType: 'image/png',
      sizeBytes: marker.length,
      uploadedAt: '2026-09-08T10:00:00.000Z',
    });
    const uploaded = h.events.filter(
      (event) => event.action === 'FULFILLMENT_PAYMENT_RECEIPT_UPLOADED',
    );
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.payload).toContain('"replacedExisting":false');
    expect(uploaded[0]?.payload).not.toContain(marker);
  });

  it('refuses a receipt on a gift-card task or from an operator without the claim', async () => {
    const giftCard = harness();
    await expect(
      giftCard.service.uploadPaymentReceipt({
        workItemId: giftCard.store.workItemId,
        staff: OPERATOR,
        file: { mimetype: 'image/png', buffer: Buffer.from('image') },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const payment = paymentHarness();
    await expect(
      payment.service.uploadPaymentReceipt({
        workItemId: payment.store.workItemId,
        staff: { id: 'staff-without-claim', role: 'OPERATOR' },
        file: { mimetype: 'image/png', buffer: Buffer.from('image') },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(payment.receipts.receipt).toBeNull();
  });

  it('sends a provider-direct payment result through our transport with the receipt attached', async () => {
    const h = paymentHarness();
    await h.service.uploadPaymentReceipt({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      file: { mimetype: 'image/png', buffer: Buffer.from('receipt-bytes') },
    });
    await prepareProviderDirectPayment(h);

    const outcome = await h.service.sendToCustomer({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
    });

    expect(outcome.delivered).toBe(true);
    expect(h.transport.getSendCount()).toBe(1);
    expect(h.transport.getAttachmentCount()).toBe(1);
    expect(outcome.workspace.checklist.isLocked).toBe(true);
    await expect(
      h.service.uploadPaymentReceipt({
        workItemId: h.store.workItemId,
        staff: OPERATOR,
        file: { mimetype: 'image/png', buffer: Buffer.from('replacement') },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('still sends the result e-mail when the payment screenshot is omitted', async () => {
    const h = paymentHarness();
    await prepareProviderDirectPayment(h);

    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(h.transport.getSendCount()).toBe(1);
    expect(h.transport.getAttachmentCount()).toBe(0);
  });

  it('gives the operator the site, the account and the amount to pay', async () => {
    const h = paymentHarness();

    const workspace = await h.service.getWorkspace(h.store.workItemId, OPERATOR);

    expect(workspace.internationalPayment).toMatchObject({
      siteUrl: 'https://openai.com/pricing',
      accountUsername: 'buyer@example.com',
      payableAmount: '24.99',
      payableCurrency: 'USD',
      hasAccountPassword: true,
    });
    /* The password itself is never part of the workspace payload. */
    expect(JSON.stringify(workspace)).not.toContain(ACCOUNT_PASSWORD);
  });

  it('leaves the brief null for a gift-card work item', async () => {
    const h = harness();
    const workspace = await h.service.getWorkspace(h.store.workItemId, OPERATOR);
    expect(workspace.internationalPayment).toBeNull();
  });

  it('audits the password read before decrypting, without the password', async () => {
    const h = paymentHarness();

    const revealed = await h.service.revealServiceAccountPassword({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      reason: 'signing in to complete the subscription payment',
    });

    expect(revealed.accountPassword).toBe(ACCOUNT_PASSWORD);

    const views = h.events.filter((event) => event.action === 'SERVICE_ACCOUNT_PASSWORD_VIEWED');
    expect(views).toHaveLength(1);
    expect(views[0]?.actor).toBe(OPERATOR.id);
    expect(views[0]?.entityId).toBe(h.store.orderId);
    expect(views[0]?.payload).toContain('signing in to complete');
    expect(views[0]?.payload).not.toContain(ACCOUNT_PASSWORD);
  });

  it('refuses to reveal the password to an operator who does not hold the claim', async () => {
    const h = paymentHarness();

    const error = await h.service
      .revealServiceAccountPassword({
        workItemId: h.store.workItemId,
        staff: { id: 'staff-someone-else', role: 'OPERATOR' },
        reason: 'curiosity',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(h.events.filter((event) => event.action === 'SERVICE_ACCOUNT_PASSWORD_VIEWED')).toHaveLength(0);
  });

  it('refuses to reveal a password on a gift-card work item', async () => {
    const h = harness();

    const error = await h.service
      .revealServiceAccountPassword({
        workItemId: h.store.workItemId,
        staff: OPERATOR,
        reason: 'wrong work item type',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
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

describe('recording the actual cost on its own', () => {
  /**
   * An asset with no price on it — what the admin gift-card-request path
   * produces, since the person entering the card is not the person who saw the
   * invoice. `recordSupplierResult` will not run a second time on such an order,
   * so without a separate door the send stays blocked forever.
   */
  async function recordAssetWithoutCost(h: Harness, staff: StaffContext = OPERATOR): Promise<void> {
    await h.service.recordSupplierResult({
      workItemId: h.store.workItemId,
      staff,
      supplierReference: 'SUP-REF-9001',
      asset: { assetType: 'CODE_PIN', code: PLAINTEXT_CODE, pin: PLAINTEXT_PIN },
    });
  }

  it('lifts the cost blocker and lets the send through', async () => {
    const h = harness();
    await recordAssetWithoutCost(h);
    await tickBooleans(h);

    const blocked = await h.service.getWorkspace(h.store.workItemId, OPERATOR);
    expect(blocked.sendBlockers).toContain(SEND_BLOCKERS.ACTUAL_COST_MISSING);

    /* The reference travels with the cost: `recordSupplierResult` writes it onto
     * the fulfillment only when a price came with it, so an asset stored without
     * one leaves the provider-reference row pending too. */
    const cleared = await h.service.recordActualCost({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      actualSupplierCost: '100.00',
      actualSupplierCurrency: 'USD',
      supplierReference: 'SUP-REF-9001',
    });
    expect(cleared.sendBlockers).toHaveLength(0);

    const outcome = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });
    expect(outcome.delivered).toBe(true);
  });

  it('creates no asset, so a card can never be bought twice through it', async () => {
    const h = harness();
    await recordAssetWithoutCost(h);
    await h.service.recordActualCost({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      actualSupplierCost: '100.00',
    });

    expect(h.store.assets.size).toBe(1);
  });

  it('refuses when there is no asset to attach a price to', async () => {
    const h = harness();
    await expect(
      h.service.recordActualCost({
        workItemId: h.store.workItemId,
        staff: OPERATOR,
        actualSupplierCost: '100.00',
      }),
    ).rejects.toThrow();
  });

  it('refuses to overwrite a price already on record', async () => {
    const h = harness();
    await recordAsset(h, '100.00');

    // Correcting a recorded spend is a finance action. An operator rewriting it
    // here would also erase the variance that was assessed against the original.
    await expect(
      h.service.recordActualCost({
        workItemId: h.store.workItemId,
        staff: OPERATOR,
        actualSupplierCost: '5.00',
      }),
    ).rejects.toThrow();

    const fulfillment = [...h.store.fulfillments.values()][0];
    expect(fulfillment?.actualSupplierCost).toBe('100.00');
  });

  it('raises the variance hold for an over-tolerance price recorded this way', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAssetWithoutCost(h);
    await tickBooleans(h);

    const workspace = await h.service.recordActualCost({
      workItemId: h.store.workItemId,
      staff: OPERATOR,
      actualSupplierCost: '120.00',
      actualSupplierCurrency: 'USD',
    });

    expect(workspace.costVariance?.varianceBps).toBe(2_000);
    expect(workspace.sendBlockers).toContain(SEND_BLOCKERS.COST_VARIANCE_UNAPPROVED);
    await expect(
      h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR }),
    ).rejects.toThrow();
  });
});

describe('correcting a cost that was typed wrong', () => {
  const ADMIN: StaffContext = { id: 'staff-admin', role: 'ADMIN' };

  it('replaces the figure and re-derives the send gate from it', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    // 470.00 was meant to be 47.00 — a misplaced decimal point, so the send is
    // held behind a variance the order never actually incurred.
    await recordAsset(h, '470.00');
    await tickBooleans(h);

    const held = await h.service.getWorkspace(h.store.workItemId, OPERATOR);
    expect(held.sendBlockers).toContain(SEND_BLOCKERS.COST_VARIANCE_UNAPPROVED);

    const fixed = await h.service.correctActualCost({
      workItemId: h.store.workItemId,
      staff: ADMIN,
      actualSupplierCost: '102.00',
      actualSupplierCurrency: 'USD',
      reason: 'اپراتور ۴۷۰ به‌جای ۱۰۲ وارد کرده بود',
    });

    expect(fixed.costVariance?.varianceBps).toBe(200);
    expect(fixed.sendBlockers).toHaveLength(0);

    const fulfillment = [...h.store.fulfillments.values()][0];
    expect(fulfillment?.actualSupplierCost).toBe('102.00');
  });

  it('can raise a hold, not only clear one', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '102.00');
    await tickBooleans(h);
    expect((await h.service.getWorkspace(h.store.workItemId, OPERATOR)).sendBlockers).toHaveLength(0);

    const workspace = await h.service.correctActualCost({
      workItemId: h.store.workItemId,
      staff: ADMIN,
      actualSupplierCost: '140.00',
      actualSupplierCurrency: 'USD',
      reason: 'فاکتور تأمین‌کننده مبلغ بالاتری را نشان می‌دهد',
    });

    expect(workspace.costVariance?.varianceBps).toBe(4_000);
    expect(workspace.sendBlockers).toContain(SEND_BLOCKERS.COST_VARIANCE_UNAPPROVED);
  });

  it('voids an approval the previous figure had earned', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '140.00');
    await tickBooleans(h);
    await h.service.approveCostVariance({
      workItemId: h.store.workItemId,
      staff: MANAGER,
      reason: 'افزایش نرخ تأمین‌کننده',
    });
    expect((await h.service.getWorkspace(h.store.workItemId, OPERATOR)).sendBlockers).toHaveLength(0);

    // A manager released 140.00. That verdict says nothing about 180.00, so the
    // send must fall back behind the gate rather than inherit the old approval.
    const workspace = await h.service.correctActualCost({
      workItemId: h.store.workItemId,
      staff: ADMIN,
      actualSupplierCost: '180.00',
      actualSupplierCurrency: 'USD',
      reason: 'مبلغ اشتباه ثبت شده بود',
    });

    expect(workspace.sendBlockers).toContain(SEND_BLOCKERS.COST_VARIANCE_UNAPPROVED);
    const fulfillment = [...h.store.fulfillments.values()][0];
    expect(fulfillment?.approvedByStaffId).toBeNull();
    expect(fulfillment?.approvedAt).toBeNull();

    await expect(
      h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR }),
    ).rejects.toThrow();
  });

  it('refuses an operator, even the one holding the claim', async () => {
    const h = harness();
    await recordAsset(h, '100.00');

    await expect(
      h.service.correctActualCost({
        workItemId: h.store.workItemId,
        staff: OPERATOR,
        actualSupplierCost: '50.00',
        reason: 'اشتباه تایپی',
      }),
    ).rejects.toThrow();

    const fulfillment = [...h.store.fulfillments.values()][0];
    expect(fulfillment?.actualSupplierCost).toBe('100.00');
  });

  it('leaves the corrector unable to approve their own new figure', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '102.00');
    await tickBooleans(h);
    await h.service.correctActualCost({
      workItemId: h.store.workItemId,
      staff: MANAGER,
      actualSupplierCost: '140.00',
      actualSupplierCurrency: 'USD',
      reason: 'اصلاح مبلغ',
    });

    // Four-eyes: correcting a spend makes you its owner, so releasing it needs
    // a different manager — otherwise correction would be a self-approval path.
    await expect(
      h.service.approveCostVariance({
        workItemId: h.store.workItemId,
        staff: MANAGER,
        reason: 'تأیید خودم',
      }),
    ).rejects.toThrow();
  });

  it('refuses once the card has been sent', async () => {
    const h = harness();
    await recordAsset(h, '100.00');
    await tickBooleans(h);
    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    await expect(
      h.service.correctActualCost({
        workItemId: h.store.workItemId,
        staff: ADMIN,
        actualSupplierCost: '50.00',
        reason: 'اصلاح پس از ارسال',
      }),
    ).rejects.toThrow();
  });

  it('refuses when nothing has been recorded yet', async () => {
    const h = harness();
    await expect(
      h.service.correctActualCost({
        workItemId: h.store.workItemId,
        staff: ADMIN,
        actualSupplierCost: '50.00',
        reason: 'چیزی برای اصلاح نیست',
      }),
    ).rejects.toThrow();
  });

  it('records the old and the new figure in the audit trail, with the reason', async () => {
    const h = harness({ quotedSupplierCost: '100.00', maxSupplierCostToleranceBps: 500 });
    await recordAsset(h, '470.00');
    await h.service.correctActualCost({
      workItemId: h.store.workItemId,
      staff: ADMIN,
      actualSupplierCost: '102.00',
      actualSupplierCurrency: 'USD',
      reason: 'خطای تایپی اپراتور',
    });

    const event = h.events.find((entry) => entry.action === 'FULFILLMENT_ACTUAL_COST_CORRECTED');
    expect(event?.actor).toBe(ADMIN.id);
    expect(event?.payload).toContain('470.00');
    expect(event?.payload).toContain('102.00');
    expect(event?.payload).toContain('خطای تایپی اپراتور');
    // The correction is about money, so no card material may ride along with it.
    expect(event?.payload).not.toContain(PLAINTEXT_CODE);
    expect(event?.payload).not.toContain(PLAINTEXT_PIN);
  });
});

describe('manager access to a task they did not claim', () => {
  const ADMIN: StaffContext = { id: 'staff-admin', role: 'ADMIN' };

  it('lets an admin tick the checklist and send without holding the claim', async () => {
    // Seeded as assigned to staff-operator, so the admin is a genuine outsider.
    const h = harness();
    await recordAsset(h, '100.00');

    for (const itemKey of ['SUPPLIER_ORDER_PLACED', 'ASSET_MATCHES_ORDER']) {
      await h.service.checkItem({ workItemId: h.store.workItemId, staff: ADMIN, itemKey, checked: true });
    }

    const outcome = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: ADMIN });
    expect(outcome.delivered).toBe(true);
  });

  it('still refuses an operator who does not hold the claim', async () => {
    const h = harness();
    await expect(
      h.service.checkItem({
        workItemId: h.store.workItemId,
        staff: { id: 'staff-other-operator', role: 'OPERATOR' },
        itemKey: 'SUPPLIER_ORDER_PLACED',
        checked: true,
      }),
    ).rejects.toThrow();
  });
});
