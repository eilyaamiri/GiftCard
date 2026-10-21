import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import type { StaffContext } from '../workitems/staff-context';
import type { EscalationInput, WorkItemEscalator, WorkItemSummary } from '../workitems/workitems.types';
import { ChecklistService } from './checklist.service';
import { encryptSecret, maskGiftCardCode } from './crypto';
import { assetSchema } from './fulfillment.schemas';
import { FulfillmentService } from './fulfillment.service';
import { GiftCardAssetService } from './gift-card-asset.service';
import { tokenMatches } from './internal-fulfillment.controller';
import type { PaymentReceiptService } from './payment-receipt.service';
import { MockAssetDeliveryTransport } from './transports/mock-asset-delivery.transport';
import { InMemoryFulfillmentStore } from './testing/in-memory-fulfillment.store';

/**
 * Hardening of the record → dispatch path:
 *
 *   - one asset per order, even when two submissions race;
 *   - an asset claimed into SENDING is always released, whatever throws;
 *   - the worker's retry delivers the asset it names, not the order's first;
 *   - a refund that lands during a send is not overwritten by FULFILLED;
 *   - a masked code never gives away most of a short code;
 *   - the internal token check does not branch on length.
 */

const PLAINTEXT_CODE = 'ABCD-1234-5678-8271';
const PLAINTEXT_PIN = '4417';
const OPERATOR: StaffContext = { id: 'staff-operator', role: 'OPERATOR' };

class NullEscalator implements WorkItemEscalator {
  async openEscalation(input: EscalationInput): Promise<WorkItemSummary> {
    return { id: `review-${input.code}` } as unknown as WorkItemSummary;
  }
}

interface Harness {
  readonly service: FulfillmentService;
  readonly store: InMemoryFulfillmentStore;
  readonly transport: MockAssetDeliveryTransport;
  readonly auditPayloads: string[];
}

function harness(): Harness {
  const store = new InMemoryFulfillmentStore();
  const transport = new MockAssetDeliveryTransport();
  const auditPayloads: string[] = [];
  const writer: AuditWriter = {
    append: async (input) => {
      auditPayloads.push(JSON.stringify(input));
    },
  };
  const audit = new AuditService(writer);
  const service = new FulfillmentService(
    store,
    transport,
    new ChecklistService(store, audit),
    new GiftCardAssetService(store, audit),
    audit,
    { info: async () => null, readIfExists: async () => null } as unknown as PaymentReceiptService,
    { bankDetailsEncryptionKey: () => Buffer.alloc(32, 7) } as never,
    new NullEscalator(),
  );
  return { service, store, transport, auditPayloads };
}

async function recordAsset(h: Harness): Promise<void> {
  await h.service.recordSupplierResult({
    workItemId: h.store.workItemId,
    staff: OPERATOR,
    supplierReference: 'SUP-REF-9001',
    actualSupplierCost: '100.00',
    actualSupplierCurrency: 'USD',
    asset: { assetType: 'CODE_PIN', code: PLAINTEXT_CODE, pin: PLAINTEXT_PIN },
  });
}

async function tickBooleans(h: Harness): Promise<void> {
  for (const itemKey of ['SUPPLIER_ORDER_PLACED', 'ASSET_MATCHES_ORDER']) {
    await h.service.checkItem({ workItemId: h.store.workItemId, staff: OPERATOR, itemKey, checked: true });
  }
}

beforeEach(() => {
  process.env['GIFT_CARD_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
});

describe('one delivery asset per order', () => {
  it('stores exactly one card when the same supplier result is submitted twice at once', async () => {
    const h = harness();

    const results = await Promise.allSettled([recordAsset(h), recordAsset(h)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(h.store.rawAssets()).toHaveLength(1);
  });
});

describe('an asset claimed for sending is always released', () => {
  it('fails the delivery instead of stranding the asset in SENDING when bookkeeping throws', async () => {
    const h = harness();
    await recordAsset(h);
    await tickBooleans(h);
    h.store.nextAttemptNumber = async () => {
      throw new Error('database connection reset');
    };

    const outcome = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(outcome).toMatchObject({ delivered: false, failureCode: 'DISPATCH_ERROR' });
    expect(h.store.rawAssets()[0]?.status).toBe('DELIVERY_FAILED');
    expect(h.transport.getSendCount()).toBe(0);
  });

  it('fails the delivery when the secret cannot be decrypted, without echoing anything of it', async () => {
    const h = harness();
    await recordAsset(h);
    await tickBooleans(h);
    // A different key: the envelope no longer authenticates.
    process.env['GIFT_CARD_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

    const outcome = await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(outcome).toMatchObject({ delivered: false, failureCode: 'ASSET_SECRET_UNREADABLE' });
    expect(h.store.rawAssets()[0]?.status).toBe('DELIVERY_FAILED');
    expect(h.store.attempts.at(-1)?.status).toBe('DELIVERY_FAILED');
    expect(JSON.stringify(outcome)).not.toContain(PLAINTEXT_CODE);
    expect(h.auditPayloads.join('\n')).not.toContain(PLAINTEXT_CODE);
  });

  it('a released asset can then be retried and delivered', async () => {
    const h = harness();
    await recordAsset(h);
    await tickBooleans(h);
    const realNext = h.store.nextAttemptNumber.bind(h.store);
    h.store.nextAttemptNumber = async () => {
      throw new Error('transient');
    };
    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });
    h.store.nextAttemptNumber = realNext;

    const retried = await h.service.retryDelivery({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(retried.delivered).toBe(true);
    expect(h.store.rawAssets()[0]?.status).toBe('SENT');
  });
});

describe('the worker retry is pinned to the asset it names', () => {
  it('delivers the failed asset, not the order\'s first one', async () => {
    const h = harness();
    await recordAsset(h);
    await tickBooleans(h);
    const first = h.store.rawAssets()[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    // A second card on the same order (a replacement), whose delivery failed.
    h.store.assets.set('asset-replacement', {
      ...first,
      id: 'asset-replacement',
      encryptedCode: encryptSecret('WXYZ-9999-8888-7777'),
      encryptedPin: encryptSecret('1234'),
      status: 'DELIVERY_FAILED',
    });

    const outcome = await h.service.retryDeliveryForAsset('asset-replacement');

    expect(outcome).toMatchObject({ delivered: true, assetId: 'asset-replacement' });
    expect(h.store.assets.get('asset-replacement')?.status).toBe('SENT');
    // The first card was never handed to the transport by this retry.
    expect(h.store.assets.get(first.id)?.status).toBe('READY');
    expect(h.transport.getSendCount()).toBe(1);
  });
});

describe('a refund that lands during a send is preserved', () => {
  it('does not overwrite REFUND_PENDING with FULFILLED', async () => {
    const h = harness();
    await recordAsset(h);
    await tickBooleans(h);
    const send = h.transport.send.bind(h.transport);
    h.transport.send = async (message) => {
      // A manager converts the order to a refund while the e-mail is in flight.
      h.store.orderStatus = 'REFUND_PENDING';
      return send(message);
    };

    await h.service.sendToCustomer({ workItemId: h.store.workItemId, staff: OPERATOR });

    expect(h.store.orderStatus).toBe('REFUND_PENDING');
  });
});

describe('maskGiftCardCode never leaves fewer than eight characters hidden', () => {
  function hiddenCount(code: string, masked: string): number {
    const visible = masked.replace(/X/gu, '').replace(/-/gu, '');
    return code.replace(/[\s-]/gu, '').length - visible.length;
  }

  it('keeps the long-code format unchanged', () => {
    expect(maskGiftCardCode('ABCD-1234-5678-8271')).toBe('ABCD-XXXX-XXXX-8271');
  });

  it.each(['ABCDEFGHJK', 'ABCD-EFGH-JK', 'ABCDEFGHJKLM', 'ABCDE-FGHJK-LMNPQ', 'AB12CD34EF'])(
    'hides at least eight characters of %s',
    (code) => {
      const masked = maskGiftCardCode(code);
      expect(hiddenCount(code, masked)).toBeGreaterThanOrEqual(8);
    },
  );

  it('used to reveal eight of ten characters; now reveals none', () => {
    expect(maskGiftCardCode('ABCDEFGHJK')).toBe('XXXXXXXXXX');
  });

  it('shows only the last four of a mid-length code', () => {
    expect(maskGiftCardCode('ABCDE-FGHJK-LMNPQ')).toBe('XXXX-XXXX-XXXX-MNPQ');
  });
});

describe('a URL asset must be an http(s) link', () => {
  it.each(['javascript:alert(document.cookie)', 'data:text/html,<script>x</script>', 'ftp://a.example/x'])(
    'the request schema rejects %s',
    (deliveryUrl) => {
      expect(assetSchema.safeParse({ assetType: 'URL', deliveryUrl }).success).toBe(false);
    },
  );

  it('the request schema accepts an https link', () => {
    expect(assetSchema.safeParse({ assetType: 'URL', deliveryUrl: 'https://redeem.example/c/1' }).success).toBe(true);
  });

  it('the asset service refuses a javascript: link even when no schema ran (automated path)', async () => {
    const h = harness();
    await expect(
      h.service.ingestAutomatedSupplierResult({
        workItemId: h.store.workItemId,
        actorId: 'system:supplier:mock',
        asset: { assetType: 'URL', deliveryUrl: 'javascript:alert(1)' },
      }),
    ).rejects.toThrow();
    expect(h.store.rawAssets()).toHaveLength(0);
  });

  it('the asset service stores an https link', async () => {
    const h = harness();
    await h.service.ingestAutomatedSupplierResult({
      workItemId: h.store.workItemId,
      actorId: 'system:supplier:mock',
      asset: { assetType: 'URL', deliveryUrl: 'https://redeem.example/c/1' },
    });
    expect(h.store.rawAssets()[0]?.deliveryUrl).toBe('https://redeem.example/c/1');
  });
});

describe('internal service token comparison', () => {
  const expected = 'x'.repeat(48);

  it('accepts the exact token', () => {
    expect(tokenMatches(expected, expected)).toBe(true);
  });

  it('rejects a wrong token of the same length, a shorter one and a longer one', () => {
    expect(tokenMatches('y'.repeat(48), expected)).toBe(false);
    expect(tokenMatches('x'.repeat(47), expected)).toBe(false);
    expect(tokenMatches('x'.repeat(49), expected)).toBe(false);
    expect(tokenMatches('', expected)).toBe(false);
  });
});

describe('FUL-3: who may still see a card secret', () => {
  async function stored(): Promise<{ h: Harness; assetId: string }> {
    const h = harness();
    await recordAsset(h);
    const assetId = [...h.store.assets.keys()][0]!;
    return { h, assetId };
  }

  const reveal = (h: Harness, assetId: string, staff: StaffContext) =>
    h.service.revealAssetSecret({ workItemId: h.store.workItemId, assetId, staff, reason: 'customer says code is invalid' });

  it('the operator working the task may reveal it', async () => {
    const { h, assetId } = await stored();
    await expect(reveal(h, assetId, OPERATOR)).resolves.toMatchObject({ code: PLAINTEXT_CODE });
  });

  it.each([
    ['the task is completed', (h: Harness) => { h.store.workItemStatus = 'COMPLETED'; }],
    ['the task became a refund review', (h: Harness) => { h.store.workItemType = 'REFUND_REVIEW'; }],
    ['the order is being refunded', (h: Harness) => { h.store.orderStatus = 'REFUND_PENDING'; }],
    ['the order was delivered', (h: Harness) => { h.store.orderStatus = 'FULFILLED'; }],
  ])('refuses the operator once %s', async (_label, change) => {
    const { h, assetId } = await stored();
    change(h);

    await expect(reveal(h, assetId, OPERATOR)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.auditPayloads.join('\n')).not.toContain(PLAINTEXT_CODE);
  });

  it('a manager may still look, with a reason, after the task is closed', async () => {
    const { h, assetId } = await stored();
    h.store.workItemStatus = 'COMPLETED';
    h.store.orderStatus = 'REFUNDED';

    await expect(reveal(h, assetId, { id: 'staff-manager', role: 'OPS_MANAGER' })).resolves.toMatchObject({
      code: PLAINTEXT_CODE,
    });
  });
});
