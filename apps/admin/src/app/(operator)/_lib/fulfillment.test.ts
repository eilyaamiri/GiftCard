import { describe, expect, it } from "vitest";

import {
  canEnterDeliveryAssetManually,
  type FulfillmentWorkspace,
  type GiftCardAssetView,
} from "./fulfillment";

function workspace(overrides: Partial<FulfillmentWorkspace> = {}): FulfillmentWorkspace {
  return {
    workItemId: "wi-1",
    orderId: "order-1",
    checklist: {
      id: "cl-1",
      workItemId: "wi-1",
      templateId: "tpl-1",
      status: "INCOMPLETE",
      blockedReason: null,
      completedAt: null,
      isLocked: false,
      items: [],
    },
    assets: [],
    supplierCost: null,
    costVariance: null,
    sendBlockers: ["ASSET_MISSING"],
    canSend: false,
    internationalPayment: null,
    paymentReceipt: null,
    ...overrides,
  };
}

function asset(overrides: Partial<GiftCardAssetView> = {}): GiftCardAssetView {
  return {
    id: "asset-1",
    orderId: "order-1",
    fulfillmentId: "f-1",
    skuId: null,
    assetType: "CODE_PIN",
    maskedCode: "XXXX-XXXX-4821",
    hasPin: true,
    serialNumber: null,
    deliveryUrl: null,
    recipientEmailMasked: null,
    expiryDate: null,
    supplierReference: null,
    status: "READY",
    enteredByUserId: "staff-1",
    enteredAt: "2026-09-10T08:00:00.000Z",
    sentAt: null,
    accessCount: 0,
    lastAccessedAt: null,
    ...overrides,
  };
}

/**
 * The manual code entry is the fast path: an operator who already has the card —
 * bought outside the panel, or handed over on another channel — types it in and
 * sends, without the supplier flow or an admin code request. What matters here
 * is the two cases where the form must NOT appear, because the server refuses
 * both and a form whose only possible answer is an error is worse than none.
 */
describe("canEnterDeliveryAssetManually", () => {
  it("offers the form on a gift-card order that has no asset yet", () => {
    expect(canEnterDeliveryAssetManually(workspace())).toBe(true);
  });

  it("withdraws it once an asset is on file", () => {
    /* `/supplier-result` refuses a second asset for an order: one is already
     * paid for at the supplier, so a second would be the same card bought
     * twice. Drawing the form anyway would invite exactly that attempt. */
    expect(canEnterDeliveryAssetManually(workspace({ assets: [asset()] }))).toBe(false);
  });

  it("withdraws it once the checklist is locked", () => {
    // Locked means the card has already gone to the customer.
    const locked = workspace();
    expect(
      canEnterDeliveryAssetManually({
        ...locked,
        checklist: { ...locked.checklist, isLocked: true },
      }),
    ).toBe(false);
  });

  it("never offers it on an international payment task", () => {
    // That task files a receipt from its own form, and has no code at all.
    expect(
      canEnterDeliveryAssetManually(
        workspace({
          internationalPayment: {
            serviceNameFa: "Spotify",
            payableAmount: "10.99",
            payableCurrency: "USD",
            siteUrl: "https://spotify.test",
            accountUsername: "buyer@example.test",
            hasAccountPassword: true,
          },
        }),
      ),
    ).toBe(false);
  });
});
