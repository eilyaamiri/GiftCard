import { Inject, Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { GIFT_CARD_AUDIT_ACTIONS } from '../fulfillment/gift-card-asset.service';
import { encryptSecret, maskGiftCardCode } from '../fulfillment/crypto';
import { FULFILLMENT_STORE, type FulfillmentStore } from '../fulfillment/fulfillment.types';
import type { AuthenticatedStaff } from '../identity/identity.tokens';
import {
  AUTO_FULFILLMENT_ACTOR,
  AutoFulfillmentService,
} from '../suppliers/auto-fulfillment.service';
import {
  GIFT_CARD_REQUESTS_DATABASE,
  GIFT_CARD_REQUEST_INCLUDE,
  type GiftCardRequestKind,
  type GiftCardRequestRow,
  type GiftCardRequestStatus,
  type GiftCardRequestView,
  type GiftCardRequestsDatabase,
} from './gift-card-requests.types';

const OPERATOR_ROLES = new Set(['OPERATOR']);
const ADMIN_ROLES = new Set(['ADMIN', 'MANAGEMENT', 'OPS_MANAGER']);
const PAYABLE_ORDER_STATUSES = new Set(['PAID', 'FULFILLMENT_PENDING', 'FULFILLING']);

@Injectable()
export class GiftCardRequestsService {
  constructor(
    @Inject(GIFT_CARD_REQUESTS_DATABASE) private readonly db: GiftCardRequestsDatabase,
    @Inject(FULFILLMENT_STORE) private readonly fulfillmentStore: FulfillmentStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AutoFulfillmentService) private readonly autoFulfillment: AutoFulfillmentService,
  ) {}

  async list(status?: GiftCardRequestStatus): Promise<readonly GiftCardRequestView[]> {
    const rows = await this.db.giftCardCodeRequest.findMany({
      where: status === undefined ? undefined : { status },
      orderBy: { requestedAt: 'desc' },
      take: 200,
      include: GIFT_CARD_REQUEST_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async listMine(staff: AuthenticatedStaff): Promise<readonly GiftCardRequestView[]> {
    if (!OPERATOR_ROLES.has(staff.role)) {
      throw DomainErrors.forbidden(`role ${staff.role} may not list requests`);
    }
    const rows = await this.db.giftCardCodeRequest.findMany({
      where: { requestedByStaffId: staff.staffId },
      orderBy: { requestedAt: 'desc' },
      take: 100,
      include: GIFT_CARD_REQUEST_INCLUDE,
    });
    return rows.map((row) => this.toView(row));
  }

  async create(input: {
    staff: AuthenticatedStaff;
    workItemId: string;
    kind: GiftCardRequestKind;
    reason: string;
  }): Promise<GiftCardRequestView> {
    if (!OPERATOR_ROLES.has(input.staff.role)) {
      throw DomainErrors.forbidden(`role ${input.staff.role} may not request gift-card credentials`);
    }

    const item = await this.db.workItem.findUnique({
      where: { id: input.workItemId },
      select: { id: true, orderId: true, assignedToStaffId: true, type: true },
    });
    if (item === null || item.orderId === null) {
      throw DomainErrors.notFound(`work item ${input.workItemId}`);
    }
    if (item.assignedToStaffId !== input.staff.staffId) {
      throw DomainErrors.forbidden(`staff ${input.staff.staffId} does not hold work item ${input.workItemId}`);
    }
    if (item.type !== 'MANUAL_GIFT_CARD_FULFILLMENT') {
      throw DomainErrors.conflict('این تسک از نوع تحویل گیفت‌کارت نیست.', `work item ${item.id} has type ${item.type}`);
    }

    const existing = await this.db.giftCardCodeRequest.findFirst({
      where: { workItemId: item.id, status: 'OPEN' },
      include: GIFT_CARD_REQUEST_INCLUDE,
    });
    if (existing !== null) return this.toView(existing);

    // Ask the supplier before asking a person. Only when that comes back without
    // a card does the request go to the admin queue.
    const automatic = await this.tryAutoFulfill({
      item: { id: item.id, orderId: item.orderId },
      staff: input.staff,
      kind: input.kind,
      reason: input.reason,
    });
    if (automatic !== null) return automatic;

    let created: GiftCardRequestRow;
    try {
      created = await this.db.giftCardCodeRequest.create({
        data: {
          requestNumber: `GCR-${nanoid(10)}`,
          workItemId: item.id,
          orderId: item.orderId,
          kind: input.kind,
          openWorkItemKey: item.id,
          requestedByStaffId: input.staff.staffId,
          requestReason: input.reason.trim(),
        },
        include: GIFT_CARD_REQUEST_INCLUDE,
      });
    } catch (error) {
      // A concurrent request may win the unique openWorkItemKey constraint.
      const concurrent = await this.db.giftCardCodeRequest.findFirst({
        where: { workItemId: item.id, status: 'OPEN' },
        include: GIFT_CARD_REQUEST_INCLUDE,
      });
      if (concurrent !== null) return this.toView(concurrent);
      throw error;
    }

    await this.audit.record({
      actor: input.staff.staffId,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: 'GIFT_CARD_CREDENTIAL_REQUESTED',
      entity: 'GiftCardCodeRequest',
      entityId: created.id,
      after: {
        requestNumber: created.requestNumber,
        workItemId: created.workItemId,
        orderId: created.orderId,
        kind: created.kind,
      },
    });
    return this.toView(created);
  }

  /**
   * Buys the card from the supplier instead of escalating to an admin.
   *
   * Returns the finished request when the supplier delivered, and `null` for
   * every other outcome — empty float, no adapter, a purchase that did not come
   * back SUCCEEDED — so the caller creates the OPEN request exactly as before.
   * The supplier attempt is an optimisation on the way to a human, never a gate
   * in front of one: anything that goes wrong here still ends with an admin
   * being asked, which is what would have happened without it.
   *
   * No plaintext passes through this method. The code was encrypted inside the
   * purchase; all that is linked here is the asset's id.
   */
  private async tryAutoFulfill(input: {
    item: { id: string; orderId: string };
    staff: AuthenticatedStaff;
    kind: GiftCardRequestKind;
    reason: string;
  }): Promise<GiftCardRequestView | null> {
    // A card already bought for this task needs no second request, from a
    // supplier or from an admin. This also makes a retried call idempotent.
    const alreadyFulfilled = await this.db.giftCardCodeRequest.findFirst({
      where: { workItemId: input.item.id, status: 'FULFILLED', giftCardAssetId: { not: null } },
      orderBy: { requestedAt: 'desc' },
      include: GIFT_CARD_REQUEST_INCLUDE,
    });
    if (alreadyFulfilled !== null) return this.toView(alreadyFulfilled);

    let assetId: string | null;
    try {
      const outcome = await this.autoFulfillment.attemptForOperatorRequest({
        workItemId: input.item.id,
        staffId: input.staff.staffId,
      });
      assetId = outcome.assetId;
    } catch {
      // The provider error may carry a payload; it is dropped, and the request
      // takes the admin path it would have taken anyway.
      return null;
    }
    if (assetId === null) return null;

    const asset = await this.db.giftCardAsset.findUnique({
      where: { id: assetId },
      select: { id: true, assetType: true },
    });
    if (asset === null) return null;

    // What the supplier actually delivered, not what the operator guessed it
    // would be — the request must not claim a PIN that does not exist.
    const kind: GiftCardRequestKind =
      asset.assetType === 'CODE' || asset.assetType === 'CODE_PIN' ? asset.assetType : input.kind;

    const now = new Date();
    const created = await this.db.giftCardCodeRequest.create({
      data: {
        requestNumber: `GCR-${nanoid(10)}`,
        workItemId: input.item.id,
        orderId: input.item.orderId,
        kind,
        // Never OPEN: no admin has to act, so it must not reach their queue.
        // `openWorkItemKey` stays null for the same reason the unique index
        // exists — only a request awaiting a human holds that slot.
        status: 'FULFILLED',
        openWorkItemKey: null,
        requestedByStaffId: input.staff.staffId,
        requestReason: input.reason.trim(),
        responseNote: 'کد به‌صورت خودکار از تأمین‌کننده دریافت شد و نیازی به تأیید ادمین نبود.',
        // Left null: this column is a foreign key to a staff user, and no person
        // fulfilled this. The audit event below names the system.
        fulfilledByStaffId: null,
        giftCardAssetId: asset.id,
        fulfilledAt: now,
      },
      include: GIFT_CARD_REQUEST_INCLUDE,
    });

    await this.audit.record({
      actor: input.staff.staffId,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: 'GIFT_CARD_CREDENTIAL_REQUESTED',
      entity: 'GiftCardCodeRequest',
      entityId: created.id,
      after: {
        requestNumber: created.requestNumber,
        workItemId: created.workItemId,
        orderId: created.orderId,
        kind: created.kind,
        autoFulfilled: true,
      },
    });
    await this.audit.record({
      actor: AUTO_FULFILLMENT_ACTOR,
      actorType: 'SYSTEM',
      action: 'GIFT_CARD_CREDENTIAL_REQUEST_FULFILLED',
      entity: 'GiftCardCodeRequest',
      entityId: created.id,
      after: {
        requestNumber: created.requestNumber,
        workItemId: created.workItemId,
        orderId: created.orderId,
        assetId: asset.id,
        assetType: asset.assetType,
        fulfilledAt: now.toISOString(),
      },
    });

    return this.toView(created);
  }

  async fulfill(input: {
    staff: AuthenticatedStaff;
    requestId: string;
    code: string;
    pin?: string;
  }): Promise<GiftCardRequestView> {
    if (!ADMIN_ROLES.has(input.staff.role)) {
      throw DomainErrors.forbidden(`role ${input.staff.role} may not fulfill credential requests`);
    }

    const request = await this.db.giftCardCodeRequest.findUnique({
      where: { id: input.requestId },
      include: GIFT_CARD_REQUEST_INCLUDE,
    });
    if (request === null) throw DomainErrors.notFound(`gift card request ${input.requestId}`);
    if (request.status !== 'OPEN') {
      throw DomainErrors.conflict('این درخواست قبلاً رسیدگی شده است.', `request ${request.id} is ${request.status}`);
    }
    const pin = input.pin?.trim();
    if (request.kind === 'CODE_PIN' && !pin) {
      throw DomainErrors.validation([{ path: 'pin', message: 'پین برای این درخواست الزامی است.' }]);
    }

    const order = await this.db.order.findUnique({ where: { id: request.orderId }, select: { id: true, status: true } });
    if (order === null) throw DomainErrors.notFound(`order ${request.orderId}`);
    if (!PAYABLE_ORDER_STATUSES.has(order.status)) {
      throw DomainErrors.conflict('این سفارش هنوز پرداخت‌شده نیست.', `order ${order.id} has status ${order.status}`);
    }

    const context = await this.fulfillmentStore.loadContextByWorkItem(request.workItemId);
    if (context === null || context.orderId !== request.orderId) {
      throw DomainErrors.conflict('ارتباط تسک و سفارش معتبر نیست.', `request ${request.id} has inconsistent work item and order`);
    }
    if (!context.hasVerifiedPayment) {
      throw DomainErrors.conflict('پرداخت این سفارش هنوز به‌صورت امن تأیید نشده است.', `order ${request.orderId} has no verified payment`);
    }

    const fulfillment = context.fulfillment ?? await this.fulfillmentStore.ensureFulfillment({
      orderId: request.orderId,
      workItemId: request.workItemId,
      idempotencyKey: `gift-card-request-${request.id}`,
    });

    const now = new Date();
    const code = input.code.trim();
    const encryptedCode = encryptSecret(code);
    const encryptedPin = pin === undefined ? null : encryptSecret(pin);
    const maskedCode = maskGiftCardCode(code);

    // Claim, create the encrypted asset and link it in one transaction. The first
    // conditional UPDATE locks the request row, so a concurrent admin cannot create
    // an orphan duplicate asset before learning that the request was already handled.
    const transactionResult = await this.db.$transaction(async (tx) => {
      const claimed = await tx.giftCardCodeRequest.updateMany({
        where: { id: request.id, status: 'OPEN', giftCardAssetId: null },
        data: {
          status: 'FULFILLED',
          openWorkItemKey: null,
          fulfilledByStaffId: input.staff.staffId,
          fulfilledAt: now,
        },
      });
      if (claimed.count !== 1) {
        throw DomainErrors.conflict(
          'این درخواست هم‌زمان توسط شخص دیگری تکمیل شد.',
          `request ${request.id} conditional update lost`,
        );
      }

      const existingAsset = await tx.giftCardAsset.findFirst({
        where: { fulfillmentId: fulfillment.id },
        select: { id: true },
      });
      if (existingAsset !== null) {
        throw DomainErrors.conflict(
          'برای این تسک قبلاً دارایی گیفت‌کارت ثبت شده است.',
          `fulfillment ${fulfillment.id} already has asset ${existingAsset.id}`,
        );
      }

      const asset = await tx.giftCardAsset.create({
        data: {
          orderId: request.orderId,
          fulfillmentId: fulfillment.id,
          assetType: request.kind,
          encryptedCode,
          encryptedPin,
          maskedCode,
          status: 'READY',
          enteredByUserId: input.staff.staffId,
          enteredAt: now,
          encryptionKeyVersion: 1,
        },
        select: { id: true, assetType: true, maskedCode: true },
      });
      await tx.giftCardCodeRequest.update({
        where: { id: request.id },
        data: { giftCardAssetId: asset.id },
      });
      const fulfilledRequest = await tx.giftCardCodeRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: GIFT_CARD_REQUEST_INCLUDE,
      });
      return { asset, fulfilledRequest };
    });

    await this.audit.record({
      actor: input.staff.staffId,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: GIFT_CARD_AUDIT_ACTIONS.ASSET_RECORDED,
      entity: 'GiftCardAsset',
      entityId: transactionResult.asset.id,
      after: {
        orderId: request.orderId,
        fulfillmentId: fulfillment.id,
        assetType: transactionResult.asset.assetType,
        maskedCode: transactionResult.asset.maskedCode,
        hasPin: request.kind === 'CODE_PIN',
        enteredBy: input.staff.staffId,
        enteredAt: now.toISOString(),
      },
    });
    await this.audit.record({
      actor: input.staff.staffId,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: 'GIFT_CARD_CREDENTIAL_REQUEST_FULFILLED',
      entity: 'GiftCardCodeRequest',
      entityId: request.id,
      after: {
        requestNumber: request.requestNumber,
        workItemId: request.workItemId,
        orderId: request.orderId,
        assetId: transactionResult.asset.id,
        assetType: request.kind,
      },
    });
    return this.toView(transactionResult.fulfilledRequest);
  }

  private toView(row: GiftCardRequestRow): GiftCardRequestView {
    return {
      id: row.id,
      requestNumber: row.requestNumber,
      workItemId: row.workItemId,
      workItemCode: row.workItem.code,
      orderId: row.orderId,
      orderNumber: row.order.orderNumber,
      kind: row.kind,
      status: row.status,
      requestReason: row.requestReason,
      responseNote: row.responseNote,
      requestedByStaffId: row.requestedByStaffId,
      requestedByStaffName: row.requestedBy.fullName,
      fulfilledByStaffName: row.fulfilledBy?.fullName ?? null,
      giftCardAssetId: row.giftCardAssetId,
      maskedCode: row.giftCardAsset?.maskedCode ?? null,
      requestedAt: row.requestedAt,
      fulfilledAt: row.fulfilledAt,
    };
  }
}
