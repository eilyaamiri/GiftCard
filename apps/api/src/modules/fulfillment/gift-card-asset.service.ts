import { Inject, Injectable } from '@nestjs/common';
import type { DeliveryAssetType } from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService, type AuditActorType } from '../audit/audit.service';
import { encryptSecret, decryptSecret, maskGiftCardCode } from './crypto';
import {
  FULFILLMENT_STORE,
  type AssetSecretInput,
  type FulfillmentStore,
  type GiftCardAssetView,
} from './fulfillment.types';

/**
 * Audit actions emitted by this service. `GIFT_CARD_CODE_VIEWED` is the one the
 * security review cares about: it is written on EVERY plaintext read, before the
 * decryption happens, so a crash mid-decrypt still leaves the access on record.
 */
export const GIFT_CARD_AUDIT_ACTIONS = {
  CODE_VIEWED: 'GIFT_CARD_CODE_VIEWED',
  ASSET_VIEWED: 'GIFT_CARD_ASSET_VIEWED',
  ASSET_RECORDED: 'GIFT_CARD_ASSET_RECORDED',
} as const;

/** Why a plaintext read happened. Recorded in the audit event. */
export const SECRET_READ_REASONS = {
  OPERATOR_VERIFICATION: 'OPERATOR_VERIFICATION',
  DELIVERY_SEND: 'DELIVERY_SEND',
  DELIVERY_RETRY: 'DELIVERY_RETRY',
  SUPPORT_INVESTIGATION: 'SUPPORT_INVESTIGATION',
} as const;

export type SecretReadReason = (typeof SECRET_READ_REASONS)[keyof typeof SECRET_READ_REASONS];

/**
 * A decrypted asset. Instances of this type are short-lived, never persisted,
 * never returned from a controller and never passed to a logger.
 */
export interface RevealedAssetSecret {
  readonly assetId: string;
  readonly orderId: string;
  readonly assetType: DeliveryAssetType;
  readonly code?: string;
  readonly pin?: string;
  readonly deliveryUrl?: string;
  readonly recipientEmail?: string;
  readonly expiryDate: Date | null;
}

@Injectable()
export class GiftCardAssetService {
  constructor(
    @Inject(FULFILLMENT_STORE) private readonly store: FulfillmentStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listForOrder(orderId: string): Promise<readonly GiftCardAssetView[]> {
    return this.store.findAssetsByOrder(orderId);
  }

  async getView(assetId: string): Promise<GiftCardAssetView> {
    const asset = await this.store.findAssetView(assetId);
    if (asset === null) {
      throw DomainErrors.notFound(`gift card asset ${assetId}`);
    }
    return asset;
  }

  /**
   * Encrypts and stores a delivery asset.
   *
   * The four asset types are genuinely different products, not variations of one:
   *
   *   CODE / CODE_PIN       Tillo hands us a raw code. We hold a secret and are
   *                         responsible for encrypting it.
   *   URL                   Runa / Giftbit hand us a redemption link. There is no
   *                         code to protect; the link IS the delivery.
   *   PROVIDER_DIRECT_EMAIL Reloadly mails the customer itself. We never see a
   *                         code, and there is nothing for us to send.
   *
   * The input type makes a code field unreachable for the last two, so no request
   * body can smuggle one in.
   */
  async create(input: {
    orderId: string;
    fulfillmentId: string;
    skuId?: string | null;
    staffId: string;
    supplierReference?: string | null;
    actualSupplierCost?: string | null;
    actualSupplierCurrency?: string | null;
    asset: AssetSecretInput;
  }): Promise<GiftCardAssetView> {
    const now = new Date();
    const encrypted = this.encryptAsset(input.asset);

    const created = await this.store.createAsset({
      orderId: input.orderId,
      fulfillmentId: input.fulfillmentId,
      skuId: input.skuId ?? null,
      assetType: input.asset.assetType,
      encryptedCode: encrypted.encryptedCode,
      encryptedPin: encrypted.encryptedPin,
      maskedCode: encrypted.maskedCode,
      serialNumber: encrypted.serialNumber,
      deliveryUrl: encrypted.deliveryUrl,
      recipientEmail: encrypted.recipientEmail,
      expiryDate: encrypted.expiryDate,
      supplierReference: input.supplierReference ?? null,
      actualSupplierCost: input.actualSupplierCost ?? null,
      actualSupplierCurrency: input.actualSupplierCurrency ?? null,
      enteredByUserId: input.staffId,
      enteredAt: now,
    });

    await this.audit.record({
      actor: input.staffId,
      actorType: 'STAFF',
      action: GIFT_CARD_AUDIT_ACTIONS.ASSET_RECORDED,
      entity: 'GiftCardAsset',
      entityId: created.id,
      // `maskedCode` is the display form (`ABCD-XXXX-XXXX-8271`) and is explicitly
      // safe to persist. The plaintext and the ciphertext are both absent.
      after: {
        orderId: input.orderId,
        fulfillmentId: input.fulfillmentId,
        assetType: created.assetType,
        maskedCode: created.maskedCode,
        hasPin: created.hasPin,
        enteredBy: input.staffId,
        enteredAt: now.toISOString(),
      },
    });

    return created;
  }

  /**
   * The single door to plaintext.
   *
   * Order of operations is deliberate: audit first, then increment the access
   * counter, then decrypt. Anyone who reads a code leaves a trace even if the
   * decryption then fails, and the trace never contains the code.
   */
  async readSecret(input: {
    assetId: string;
    actorId: string;
    actorType?: AuditActorType;
    reason: SecretReadReason;
    /** Free-text justification typed by the operator. Never contains the code. */
    note?: string;
  }): Promise<RevealedAssetSecret> {
    const asset = await this.store.findAssetSecret(input.assetId);
    if (asset === null) {
      throw DomainErrors.notFound(`gift card asset ${input.assetId}`);
    }

    const hasSecret = asset.encryptedCode !== null || asset.encryptedPin !== null;
    const at = new Date();

    await this.audit.record({
      actor: input.actorId,
      actorType: input.actorType ?? 'STAFF',
      action: hasSecret ? GIFT_CARD_AUDIT_ACTIONS.CODE_VIEWED : GIFT_CARD_AUDIT_ACTIONS.ASSET_VIEWED,
      entity: 'GiftCardAsset',
      entityId: asset.id,
      after: {
        userId: input.actorId,
        orderId: asset.orderId,
        assetId: asset.id,
        assetType: asset.assetType,
        reason: input.reason,
        ...(input.note === undefined ? {} : { operatorReason: input.note }),
        viewedAt: at.toISOString(),
      },
    });

    if (hasSecret) {
      await this.store.recordSecretAccess(asset.id, at);
    }

    return {
      assetId: asset.id,
      orderId: asset.orderId,
      assetType: asset.assetType,
      ...(asset.encryptedCode === null ? {} : { code: decryptSecret(asset.encryptedCode) }),
      ...(asset.encryptedPin === null ? {} : { pin: decryptSecret(asset.encryptedPin) }),
      ...(asset.deliveryUrl === null ? {} : { deliveryUrl: asset.deliveryUrl }),
      ...(asset.recipientEmail === null ? {} : { recipientEmail: asset.recipientEmail }),
      expiryDate: asset.expiryDate,
    };
  }

  private encryptAsset(asset: AssetSecretInput): {
    encryptedCode: string | null;
    encryptedPin: string | null;
    maskedCode: string | null;
    serialNumber: string | null;
    deliveryUrl: string | null;
    recipientEmail: string | null;
    expiryDate: Date | null;
  } {
    switch (asset.assetType) {
      case 'CODE': {
        const code = asset.code.trim();
        if (code.length === 0) {
          throw DomainErrors.validation([{ path: 'asset.code', message: 'کد کارت الزامی است.' }]);
        }
        return {
          encryptedCode: encryptSecret(code),
          encryptedPin: null,
          maskedCode: maskGiftCardCode(code),
          serialNumber: asset.serialNumber ?? null,
          deliveryUrl: null,
          recipientEmail: null,
          expiryDate: asset.expiryDate ?? null,
        };
      }
      case 'CODE_PIN': {
        const code = asset.code.trim();
        const pin = asset.pin.trim();
        if (code.length === 0) {
          throw DomainErrors.validation([{ path: 'asset.code', message: 'کد کارت الزامی است.' }]);
        }
        if (pin.length === 0) {
          throw DomainErrors.validation([{ path: 'asset.pin', message: 'پین کارت الزامی است.' }]);
        }
        return {
          encryptedCode: encryptSecret(code),
          // The PIN is a second secret, encrypted independently with its own IV.
          encryptedPin: encryptSecret(pin),
          maskedCode: maskGiftCardCode(code),
          serialNumber: asset.serialNumber ?? null,
          deliveryUrl: null,
          recipientEmail: null,
          expiryDate: asset.expiryDate ?? null,
        };
      }
      case 'URL': {
        const url = asset.deliveryUrl.trim();
        if (url.length === 0) {
          throw DomainErrors.validation([{ path: 'asset.deliveryUrl', message: 'لینک تحویل الزامی است.' }]);
        }
        return {
          encryptedCode: null,
          encryptedPin: null,
          maskedCode: null,
          serialNumber: null,
          deliveryUrl: url,
          recipientEmail: null,
          expiryDate: asset.expiryDate ?? null,
        };
      }
      case 'PROVIDER_DIRECT_EMAIL': {
        const email = asset.recipientEmail.trim();
        if (email.length === 0) {
          throw DomainErrors.validation([
            { path: 'asset.recipientEmail', message: 'ایمیل گیرنده الزامی است.' },
          ]);
        }
        return {
          encryptedCode: null,
          encryptedPin: null,
          maskedCode: null,
          serialNumber: null,
          deliveryUrl: null,
          recipientEmail: email,
          expiryDate: null,
        };
      }
      default: {
        const exhaustive: never = asset;
        throw DomainErrors.validation([
          { path: 'asset.assetType', message: `نوع دارایی نامعتبر است: ${String(exhaustive)}` },
        ]);
      }
    }
  }
}
