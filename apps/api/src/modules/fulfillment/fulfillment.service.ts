import { Inject, Injectable } from '@nestjs/common';
import type { DeliveryStatus, StaffRole } from '@barat/contracts';

import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService, type AuditActorType } from '../audit/audit.service';
import { openServiceAccountPassword } from '../quotes/service-account-fields';
import type { StaffContext } from '../workitems/staff-context';
import { ChecklistService, type ChecklistState } from './checklist.service';
import { SEND_BLOCKERS, type SendBlocker } from './checklist-evaluation';
import { assessCostVariance, type CostVarianceAssessment } from './cost-variance';
import {
  GiftCardAssetService,
  SECRET_READ_REASONS,
  type RevealedAssetSecret,
  type SecretReadReason,
} from './gift-card-asset.service';
import { maskEmail } from './mask-recipient';
import {
  ASSET_DELIVERY_TRANSPORT,
  FULFILLMENT_STORE,
  MANAGER_APPROVAL_ROLE_SET,
  type AssetDeliveryTransport,
  type AssetSecretInput,
  type ChecklistView,
  type FulfillmentContext,
  type FulfillmentStore,
  type GiftCardAssetView,
  type InternationalPaymentBrief,
  type RecordAssetInput,
} from './fulfillment.types';

export const FULFILLMENT_AUDIT_ACTIONS = {
  SUPPLIER_RESULT_RECORDED: 'FULFILLMENT_SUPPLIER_RESULT_RECORDED',
  COST_VARIANCE_FLAGGED: 'FULFILLMENT_COST_VARIANCE_FLAGGED',
  COST_VARIANCE_APPROVED: 'APPROVE_COST_VARIANCE',
  SEND_BLOCKED: 'FULFILLMENT_SEND_BLOCKED',
  SENT: 'FULFILLMENT_SENT_TO_CUSTOMER',
  DELIVERY_FAILED: 'FULFILLMENT_DELIVERY_FAILED',
  DELIVERY_RETRIED: 'FULFILLMENT_DELIVERY_RETRIED',
  REOPENED: 'FULFILLMENT_REOPENED',
  SERVICE_ACCOUNT_PASSWORD_VIEWED: 'SERVICE_ACCOUNT_PASSWORD_VIEWED',
} as const;

export interface FulfillmentWorkspace {
  readonly workItemId: string;
  readonly orderId: string;
  readonly checklist: ChecklistView;
  readonly assets: readonly GiftCardAssetView[];
  readonly costVariance: CostVarianceAssessment | null;
  readonly sendBlockers: readonly SendBlocker[];
  readonly canSend: boolean;
  /** Null for every work item type except `INTERNATIONAL_PAYMENT`. */
  readonly internationalPayment: InternationalPaymentBrief | null;
}

export interface DeliveryOutcome {
  readonly delivered: boolean;
  readonly assetId: string;
  readonly attemptNumber: number;
  readonly failureCode: string | null;
  readonly workspace: FulfillmentWorkspace;
}

/**
 * Who is driving a dispatch.
 *
 * Delivery has two callers: an operator pressing SEND, and the worker retrying a
 * bounced e-mail. They differ in exactly two ways — the audit actor, and whether
 * the work-item claim is enforced — so they share one `dispatch` implementation
 * and cannot drift apart. In particular the worker goes through the same send
 * gate and the same "never create a second asset" path as a human.
 */
export interface DispatchActor {
  readonly id: string;
  readonly role: StaffRole | 'SYSTEM';
  readonly actorType: AuditActorType;
  /** Whether this actor must hold the claim on the work item. */
  readonly enforceClaim: boolean;
}

/** The identity the delivery-retry worker acts as. */
export const SYSTEM_DELIVERY_ACTOR: DispatchActor = {
  id: 'system:delivery-retry',
  role: 'SYSTEM',
  actorType: 'SYSTEM',
  enforceClaim: false,
};

function staffActor(staff: StaffContext): DispatchActor {
  return { id: staff.id, role: staff.role, actorType: 'STAFF', enforceClaim: true };
}

/** Statuses an asset may be dispatched from. `SENT` is deliberately absent. */
const DISPATCHABLE_STATUSES: readonly DeliveryStatus[] = ['READY', 'DELIVERY_FAILED'];

@Injectable()
export class FulfillmentService {
  constructor(
    @Inject(FULFILLMENT_STORE) private readonly store: FulfillmentStore,
    @Inject(ASSET_DELIVERY_TRANSPORT) private readonly transport: AssetDeliveryTransport,
    @Inject(ChecklistService) private readonly checklists: ChecklistService,
    @Inject(GiftCardAssetService) private readonly assets: GiftCardAssetService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Workspace                                                               */
  /* ---------------------------------------------------------------------- */

  async getWorkspace(workItemId: string, staff: StaffContext): Promise<FulfillmentWorkspace> {
    const context = await this.loadContext(workItemId);
    this.assertCanView(context, staff);
    const state = await this.checklists.ensure(context);
    return this.toWorkspace(context, state);
  }

  async checkItem(input: {
    workItemId: string;
    staff: StaffContext;
    itemKey: string;
    checked: boolean;
    note?: string;
  }): Promise<FulfillmentWorkspace> {
    const context = await this.loadContext(input.workItemId);
    this.assertCanOperate(context, input.staff);
    const state = await this.checklists.confirmItem({
      context,
      itemKey: input.itemKey,
      staffId: input.staff.id,
      checked: input.checked,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    return this.toWorkspace(context, state);
  }

  async setField(input: {
    workItemId: string;
    staff: StaffContext;
    itemKey: string;
    value: string;
  }): Promise<FulfillmentWorkspace> {
    const context = await this.loadContext(input.workItemId);
    this.assertCanOperate(context, input.staff);
    const state = await this.checklists.setRequiredFieldItem({
      context,
      itemKey: input.itemKey,
      staffId: input.staff.id,
      value: input.value,
    });
    return this.toWorkspace(context, state);
  }

  /* ---------------------------------------------------------------------- */
  /* Recording the supplier result                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Stores what the supplier actually gave us: the asset, the reference and the
   * real cost. This is the single write that can trigger a cost-variance hold.
   *
   * It refuses to create a second asset for an order. An order that already has
   * an asset has already been paid for at the supplier; creating another would
   * mean buying the same gift card twice.
   */
  async recordSupplierResult(
    input: Omit<RecordAssetInput, 'staffId'> & { staff: StaffContext },
  ): Promise<FulfillmentWorkspace> {
    const context = await this.loadContext(input.workItemId);
    this.assertCanOperate(context, input.staff);

    const existing = await this.checklists.ensure(context);
    if (existing.isLocked) {
      throw DomainErrors.conflict(
        'این سفارش قبلاً برای مشتری ارسال شده است.',
        `work item ${context.workItemId} checklist is locked`,
      );
    }

    if (context.assetCount > 0) {
      throw DomainErrors.conflict(
        'برای این سفارش قبلاً دارایی تحویل ثبت شده است.',
        `order ${context.orderId} already has ${context.assetCount} asset(s); refusing to create another`,
      );
    }

    const fulfillment = await this.store.ensureFulfillment({
      orderId: context.orderId,
      workItemId: context.workItemId,
      ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });

    const asset = await this.assets.create({
      orderId: context.orderId,
      fulfillmentId: fulfillment.id,
      skuId: input.skuId ?? null,
      staffId: input.staff.id,
      supplierReference: input.supplierReference ?? null,
      actualSupplierCost: input.actualSupplierCost ?? null,
      actualSupplierCurrency: input.actualSupplierCurrency ?? null,
      asset: input.asset,
    });

    let variance: CostVarianceAssessment | null = null;
    if (input.actualSupplierCost !== undefined) {
      const currency = input.actualSupplierCurrency ?? context.quotedSupplierCurrency;
      variance = assessCostVariance({
        quotedCost: context.quotedSupplierCost,
        quotedCurrency: context.quotedSupplierCurrency,
        actualCost: input.actualSupplierCost,
        actualCurrency: currency,
        toleranceBps: context.maxSupplierCostToleranceBps,
      });

      await this.store.updateSupplierCost({
        fulfillmentId: fulfillment.id,
        actualSupplierCost: input.actualSupplierCost,
        actualSupplierCurrency: currency,
        supplierReference: input.supplierReference ?? null,
        costVarianceBps: variance.varianceBps,
        fulfilledByStaffId: input.staff.id,
      });
    }

    await this.audit.record({
      actor: input.staff.id,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: FULFILLMENT_AUDIT_ACTIONS.SUPPLIER_RESULT_RECORDED,
      entity: 'Fulfillment',
      entityId: fulfillment.id,
      after: {
        orderId: context.orderId,
        assetId: asset.id,
        assetType: asset.assetType,
        supplierReference: input.supplierReference ?? null,
        quotedSupplierCost: context.quotedSupplierCost,
        actualSupplierCost: input.actualSupplierCost ?? null,
        actualSupplierCurrency: input.actualSupplierCurrency ?? null,
        costVarianceBps: variance?.varianceBps ?? null,
        toleranceBps: context.maxSupplierCostToleranceBps,
      },
    });

    if (variance !== null && variance.requiresApproval) {
      await this.audit.record({
        actor: input.staff.id,
        actorType: 'STAFF',
        actorRole: input.staff.role,
        action: FULFILLMENT_AUDIT_ACTIONS.COST_VARIANCE_FLAGGED,
        entity: 'Fulfillment',
        entityId: fulfillment.id,
        after: {
          orderId: context.orderId,
          reason: variance.reason,
          costVarianceBps: variance.varianceBps,
          toleranceBps: variance.toleranceBps,
          recordedBy: input.staff.id,
        },
      });
    }

    // Re-read: the checklist must be derived from the state that now exists, not
    // from the snapshot taken before the asset and the cost were written.
    return this.reloadWorkspace(context.workItemId);
  }

  /**
   * Ingests an asset returned by an automated supplier purchase.
   *
   * This exists so a `SupplierPurchaseResult` carrying a raw code is encrypted
   * the moment it enters the process, inside the supplier call, and never travels
   * any further — it does not reach the supplier controller, an HTTP response or
   * a log. The actor is the system rather than a staff member, so the audit trail
   * does not credit an operator with typing a code they never saw.
   */
  async ingestAutomatedSupplierResult(input: {
    workItemId: string;
    actorId: string;
    supplierId?: string;
    supplierReference?: string | null;
    actualSupplierCost?: string | null;
    actualSupplierCurrency?: string | null;
    skuId?: string | null;
    idempotencyKey?: string;
    asset: AssetSecretInput;
  }): Promise<GiftCardAssetView> {
    const context = await this.loadContext(input.workItemId);
    await this.checklists.ensure(context);

    if (context.assetCount > 0) {
      throw DomainErrors.conflict(
        'برای این سفارش قبلاً دارایی تحویل ثبت شده است.',
        `order ${context.orderId} already has an asset; refusing to store a second supplier purchase`,
      );
    }

    const fulfillment = await this.store.ensureFulfillment({
      orderId: context.orderId,
      workItemId: context.workItemId,
      ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    });

    const asset = await this.assets.create({
      orderId: context.orderId,
      fulfillmentId: fulfillment.id,
      skuId: input.skuId ?? null,
      staffId: input.actorId,
      supplierReference: input.supplierReference ?? null,
      actualSupplierCost: input.actualSupplierCost ?? null,
      actualSupplierCurrency: input.actualSupplierCurrency ?? null,
      asset: input.asset,
    });

    if (input.actualSupplierCost != null) {
      const currency = input.actualSupplierCurrency ?? context.quotedSupplierCurrency;
      const variance = assessCostVariance({
        quotedCost: context.quotedSupplierCost,
        quotedCurrency: context.quotedSupplierCurrency,
        actualCost: input.actualSupplierCost,
        actualCurrency: currency,
        toleranceBps: context.maxSupplierCostToleranceBps,
      });
      await this.store.updateSupplierCost({
        fulfillmentId: fulfillment.id,
        actualSupplierCost: input.actualSupplierCost,
        actualSupplierCurrency: currency,
        supplierReference: input.supplierReference ?? null,
        costVarianceBps: variance.varianceBps,
        // The purchase was automated; the claim holder stays accountable for it.
        fulfilledByStaffId: context.assignedToStaffId ?? input.actorId,
      });

      if (variance.requiresApproval) {
        await this.audit.record({
          actor: input.actorId,
          actorType: 'SYSTEM',
          action: FULFILLMENT_AUDIT_ACTIONS.COST_VARIANCE_FLAGGED,
          entity: 'Fulfillment',
          entityId: fulfillment.id,
          after: {
            orderId: context.orderId,
            reason: variance.reason,
            costVarianceBps: variance.varianceBps,
            toleranceBps: variance.toleranceBps,
            source: 'AUTOMATED_SUPPLIER_PURCHASE',
          },
        });
      }
    }

    return asset;
  }

  /* ---------------------------------------------------------------------- */
  /* Cost variance approval                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * A manager releases a spend that exceeded the quoted cost by more than the
   * pricing rule's tolerance.
   *
   * Two rules are enforced here and nowhere else:
   *   1. The approver must hold a manager role.
   *   2. The approver must not be the operator who recorded the spend. Four-eyes
   *      is the entire point of the control; an operator approving their own
   *      variance is the exact failure it exists to prevent.
   */
  async approveCostVariance(input: {
    workItemId: string;
    staff: StaffContext;
    reason: string;
  }): Promise<FulfillmentWorkspace> {
    const context = await this.loadContext(input.workItemId);

    if (!MANAGER_APPROVAL_ROLE_SET.has(input.staff.role)) {
      throw DomainErrors.forbidden(
        `role ${input.staff.role} may not approve a supplier cost variance`,
      );
    }

    const fulfillment = context.fulfillment;
    if (fulfillment === null || fulfillment.actualSupplierCost === null) {
      throw DomainErrors.conflict(
        'هنوز هزینهٔ واقعی ثبت نشده است.',
        `work item ${input.workItemId} has no recorded actual supplier cost`,
      );
    }

    if (fulfillment.fulfilledByStaffId === input.staff.id || context.assignedToStaffId === input.staff.id) {
      throw DomainErrors.forbidden(
        `staff ${input.staff.id} may not approve their own cost variance on fulfillment ${fulfillment.id}`,
      );
    }

    const variance = assessCostVariance({
      quotedCost: context.quotedSupplierCost,
      quotedCurrency: context.quotedSupplierCurrency,
      actualCost: fulfillment.actualSupplierCost,
      actualCurrency: fulfillment.actualSupplierCurrency ?? context.quotedSupplierCurrency,
      toleranceBps: context.maxSupplierCostToleranceBps,
    });

    if (!variance.requiresApproval) {
      throw DomainErrors.conflict(
        'برای این سفارش نیاز به تأیید اختلاف هزینه نیست.',
        `fulfillment ${fulfillment.id} variance ${String(variance.varianceBps)}bps is within tolerance`,
      );
    }

    const approvedAt = new Date();
    const won = await this.store.approveCostVariance({
      fulfillmentId: fulfillment.id,
      approvedByStaffId: input.staff.id,
      approvedAt,
    });
    if (!won) {
      throw DomainErrors.conflict(
        'این اختلاف هزینه قبلاً تأیید شده است.',
        `fulfillment ${fulfillment.id} was already approved`,
      );
    }

    await this.audit.record({
      actor: input.staff.id,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: FULFILLMENT_AUDIT_ACTIONS.COST_VARIANCE_APPROVED,
      entity: 'Fulfillment',
      entityId: fulfillment.id,
      before: { approvedByStaffId: null },
      after: {
        orderId: context.orderId,
        approvedBy: input.staff.id,
        approvedAt: approvedAt.toISOString(),
        reason: input.reason,
        costVarianceBps: variance.varianceBps,
        toleranceBps: variance.toleranceBps,
        recordedBy: fulfillment.fulfilledByStaffId,
      },
    });

    return this.reloadWorkspace(input.workItemId);
  }

  /* ---------------------------------------------------------------------- */
  /* Delivery                                                                */
  /* ---------------------------------------------------------------------- */

  async sendToCustomer(input: { workItemId: string; staff: StaffContext }): Promise<DeliveryOutcome> {
    return this.dispatch({
      workItemId: input.workItemId,
      actor: staffActor(input.staff),
      reason: SECRET_READ_REASONS.DELIVERY_SEND,
      isRetry: false,
    });
  }

  /**
   * Re-sends the asset that already exists.
   *
   * There is no code path from here to `GiftCardAssetService.create` or to a
   * supplier purchase. A delivery failure is an e-mail problem, not a supply
   * problem: the gift card has been bought and paid for, and buying a second one
   * to fix a bounced message would be a real financial loss.
   */
  async retryDelivery(input: { workItemId: string; staff: StaffContext }): Promise<DeliveryOutcome> {
    return this.dispatch({
      workItemId: input.workItemId,
      actor: staffActor(input.staff),
      reason: SECRET_READ_REASONS.DELIVERY_RETRY,
      isRetry: true,
    });
  }

  /**
   * Worker-initiated retry of an asset whose last delivery failed.
   *
   * Keyed by `assetId`, not by order, so there is no expression in this method
   * that could ever resolve to a *different* asset than the one that failed. The
   * work item is looked up from the asset's order purely to reuse the same send
   * gate; if the gate now blocks (say a manager reopened the checklist), the
   * retry is refused rather than forced.
   */
  async retryDeliveryForAsset(assetId: string): Promise<DeliveryOutcome> {
    const asset = await this.store.findAssetView(assetId);
    if (asset === null) {
      throw DomainErrors.notFound(`gift card asset ${assetId}`);
    }
    if (asset.status === 'SENT') {
      throw DomainErrors.conflict(
        'این سفارش قبلاً با موفقیت ارسال شده است.',
        `asset ${assetId} is already SENT`,
      );
    }

    const context = await this.store.loadContextByOrder(asset.orderId);
    if (context === null) {
      throw DomainErrors.notFound(`fulfillment context for order ${asset.orderId}`);
    }

    return this.dispatch({
      workItemId: context.workItemId,
      actor: SYSTEM_DELIVERY_ACTOR,
      reason: SECRET_READ_REASONS.DELIVERY_RETRY,
      isRetry: true,
    });
  }

  private async dispatch(input: {
    workItemId: string;
    actor: DispatchActor;
    reason: SecretReadReason;
    isRetry: boolean;
  }): Promise<DeliveryOutcome> {
    const context = await this.loadContext(input.workItemId);
    if (input.actor.enforceClaim) {
      this.assertCanOperate(context, { id: input.actor.id, role: input.actor.role as StaffRole });
    }

    const state = await this.checklists.ensure(context);

    const assets = await this.assets.listForOrder(context.orderId);
    const asset = assets[0];

    // The authoritative gate. The frontend's opinion is not consulted.
    const blockers = [...state.sendBlockers];
    if (asset !== undefined && this.needsOurEmail(asset) && !this.resolveRecipient(context, asset)) {
      blockers.push(SEND_BLOCKERS.DELIVERY_EMAIL_MISSING);
    }

    if (blockers.length > 0 || asset === undefined) {
      const finalBlockers = asset === undefined ? [...blockers, SEND_BLOCKERS.ASSET_MISSING] : blockers;
      await this.audit.record({
        actor: input.actor.id,
        actorType: input.actor.actorType,
        actorRole: input.actor.role,
        action: FULFILLMENT_AUDIT_ACTIONS.SEND_BLOCKED,
        entity: 'WorkItem',
        entityId: context.workItemId,
        after: { orderId: context.orderId, blockers: finalBlockers, isRetry: input.isRetry },
      });
      throw DomainErrors.conflict(
        'ارسال برای مشتری هنوز مجاز نیست؛ چک‌لیست کامل نشده است.',
        `send blocked for work item ${context.workItemId}: ${finalBlockers.join(',')}`,
      );
    }

    if (input.isRetry && asset.status === 'SENT') {
      throw DomainErrors.conflict(
        'این سفارش قبلاً با موفقیت ارسال شده است.',
        `asset ${asset.id} is already SENT`,
      );
    }

    // Compare-and-set into SENDING. Two operators pressing send, or an operator
    // racing the delivery worker, cannot both hand the same asset to the transport.
    const claimed = await this.store.beginSending(asset.id, DISPATCHABLE_STATUSES);
    if (!claimed) {
      throw DomainErrors.conflict(
        'ارسال این سفارش هم‌اکنون در جریان است.',
        `asset ${asset.id} is not in a dispatchable status`,
      );
    }

    const attemptNumber = await this.store.nextAttemptNumber(asset.id);
    const recipient = this.resolveRecipient(context, asset);
    const attempt = await this.store.createDeliveryAttempt({
      assetId: asset.id,
      orderId: context.orderId,
      recipientMasked: recipient === null ? 'provider-direct' : maskEmail(recipient),
      attemptNumber,
    });

    let result: { success: boolean; providerMessageId?: string; failureCode?: string };

    if (asset.assetType === 'PROVIDER_DIRECT_EMAIL') {
      // Reloadly / Runa / Giftbit already mailed the customer. There is no code on
      // our side and nothing for us to send; we only record that it happened.
      result = { success: true, providerMessageId: `provider-direct:${asset.supplierReference ?? asset.id}` };
    } else {
      result = await this.sendViaTransport({
        asset,
        context,
        recipient: recipient as string,
        actorId: input.actor.id,
        actorType: input.actor.actorType,
        reason: input.reason,
      });
    }

    const now = new Date();

    if (!result.success) {
      // The asset stays exactly where it is. Only its status changes.
      await this.store.markAssetDeliveryFailed(asset.id);
      await this.store.completeDeliveryAttempt({
        attemptId: attempt.id,
        status: 'DELIVERY_FAILED',
        providerMessageId: null,
        errorCode: result.failureCode ?? 'DELIVERY_FAILED',
        sentAt: null,
      });
      await this.audit.record({
        actor: input.actor.id,
        actorType: input.actor.actorType,
        actorRole: input.actor.role,
        action: FULFILLMENT_AUDIT_ACTIONS.DELIVERY_FAILED,
        entity: 'GiftCardAsset',
        entityId: asset.id,
        after: {
          orderId: context.orderId,
          attemptNumber,
          errorCode: result.failureCode ?? 'DELIVERY_FAILED',
          assetRetained: true,
        },
      });

      return {
        delivered: false,
        assetId: asset.id,
        attemptNumber,
        failureCode: result.failureCode ?? 'DELIVERY_FAILED',
        workspace: await this.reloadWorkspace(context.workItemId),
      };
    }

    await this.store.markAssetSent(asset.id, now);
    await this.store.completeDeliveryAttempt({
      attemptId: attempt.id,
      status: 'SENT',
      providerMessageId: result.providerMessageId ?? null,
      errorCode: null,
      sentAt: now,
    });

    // The checklist locks only after a delivery has genuinely succeeded.
    await this.checklists.lock(state.record.id, now);
    if (context.fulfillment !== null) {
      await this.store.markFulfillmentCompleted(context.fulfillment.id, now);
    }
    await this.store.markOrderFulfilled(context.orderId, now);

    await this.audit.record({
      actor: input.actor.id,
      actorType: input.actor.actorType,
      actorRole: input.actor.role,
      action: input.isRetry
        ? FULFILLMENT_AUDIT_ACTIONS.DELIVERY_RETRIED
        : FULFILLMENT_AUDIT_ACTIONS.SENT,
      entity: 'GiftCardAsset',
      entityId: asset.id,
      after: {
        orderId: context.orderId,
        workItemId: context.workItemId,
        attemptNumber,
        assetType: asset.assetType,
        maskedCode: asset.maskedCode,
        recipientMasked: recipient === null ? 'provider-direct' : maskEmail(recipient),
        sentAt: now.toISOString(),
      },
    });

    return {
      delivered: true,
      assetId: asset.id,
      attemptNumber,
      failureCode: null,
      workspace: await this.reloadWorkspace(context.workItemId),
    };
  }

  /**
   * The only place a plaintext code is handed to anything.
   *
   * `revealed` is a local that goes out of scope at the end of the method; it is
   * not returned, not stored and not logged. `readSecret` has already written the
   * `GIFT_CARD_CODE_VIEWED` audit event by the time we get here.
   */
  private async sendViaTransport(input: {
    asset: GiftCardAssetView;
    context: FulfillmentContext;
    recipient: string;
    actorId: string;
    actorType: AuditActorType;
    reason: SecretReadReason;
  }): Promise<{ success: boolean; providerMessageId?: string; failureCode?: string }> {
    const revealed: RevealedAssetSecret = await this.assets.readSecret({
      assetId: input.asset.id,
      actorId: input.actorId,
      actorType: input.actorType,
      reason: input.reason,
    });

    try {
      const result = await this.transport.send({
        orderId: input.context.orderId,
        recipientEmail: input.recipient,
        assetType: revealed.assetType,
        ...(revealed.code === undefined ? {} : { code: revealed.code }),
        ...(revealed.pin === undefined ? {} : { pin: revealed.pin }),
        ...(revealed.deliveryUrl === undefined ? {} : { deliveryUrl: revealed.deliveryUrl }),
        expiryDate: revealed.expiryDate,
      });
      return result.success
        ? { success: true, ...(result.providerMessageId === undefined ? {} : { providerMessageId: result.providerMessageId }) }
        : { success: false, failureCode: result.failureCode ?? 'TRANSPORT_REJECTED' };
    } catch {
      // The thrown error may carry a provider payload; it is swallowed in favour
      // of a normalised code so nothing provider-shaped reaches a log or the API.
      return { success: false, failureCode: 'TRANSPORT_ERROR' };
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Reopening                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Unlocks a checklist that was locked by a successful send. Manager-only, and
   * always audited — this is the escape hatch for "we sent the wrong card", and
   * it must be visible in the trail.
   */
  async reopen(input: {
    workItemId: string;
    staff: StaffContext;
    reason: string;
  }): Promise<FulfillmentWorkspace> {
    if (!MANAGER_APPROVAL_ROLE_SET.has(input.staff.role)) {
      throw DomainErrors.forbidden(`role ${input.staff.role} may not reopen a fulfillment`);
    }

    const context = await this.loadContext(input.workItemId);
    const state = await this.checklists.ensure(context);
    if (!state.isLocked) {
      throw DomainErrors.conflict(
        'این چک‌لیست قفل نیست.',
        `checklist ${state.record.id} is not locked`,
      );
    }

    await this.checklists.unlock(state.record.id);

    await this.audit.record({
      actor: input.staff.id,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: FULFILLMENT_AUDIT_ACTIONS.REOPENED,
      entity: 'FulfillmentChecklist',
      entityId: state.record.id,
      before: { status: state.record.status, completedAt: state.record.completedAt?.toISOString() ?? null },
      after: {
        status: 'INCOMPLETE',
        orderId: context.orderId,
        workItemId: context.workItemId,
        reopenedBy: input.staff.id,
        reason: input.reason,
        reopenedAt: new Date().toISOString(),
      },
    });

    return this.reloadWorkspace(input.workItemId);
  }

  /* ---------------------------------------------------------------------- */
  /* Reading a secret on demand                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Operator-initiated plaintext read (the "reveal code" button).
   *
   * A reason is mandatory. The audit event names the user, the order, the asset
   * and the reason — and never the code.
   */
  async revealAssetSecret(input: {
    workItemId: string;
    assetId: string;
    staff: StaffContext;
    reason: string;
  }): Promise<{ assetType: string; code?: string; pin?: string; deliveryUrl?: string }> {
    const context = await this.loadContext(input.workItemId);
    this.assertCanOperate(context, input.staff);

    const asset = await this.assets.getView(input.assetId);
    if (asset.orderId !== context.orderId) {
      throw DomainErrors.notFound(`gift card asset ${input.assetId}`);
    }

    const revealed = await this.assets.readSecret({
      assetId: input.assetId,
      actorId: input.staff.id,
      reason: SECRET_READ_REASONS.OPERATOR_VERIFICATION,
      note: input.reason,
    });

    return {
      assetType: revealed.assetType,
      ...(revealed.code === undefined ? {} : { code: revealed.code }),
      ...(revealed.pin === undefined ? {} : { pin: revealed.pin }),
      ...(revealed.deliveryUrl === undefined ? {} : { deliveryUrl: revealed.deliveryUrl }),
    };
  }

  /**
   * Operator-initiated plaintext read of the customer's account password for an
   * international payment.
   *
   * Same contract as `revealAssetSecret`: a reason is mandatory, the audit event
   * is written *before* the envelope is opened, and neither the audit payload nor
   * any log line carries the password. The decryption key is zeroed afterwards.
   */
  async revealServiceAccountPassword(input: {
    workItemId: string;
    staff: StaffContext;
    reason: string;
  }): Promise<{ accountPassword: string }> {
    const context = await this.loadContext(input.workItemId);
    this.assertCanOperate(context, input.staff);

    if (context.workItemType !== 'INTERNATIONAL_PAYMENT') {
      throw DomainErrors.conflict(
        `work item ${input.workItemId} is not an international payment`,
      );
    }

    const envelope = await this.store.findServiceAccountPasswordEnvelope(context.orderId);
    if (envelope === null) {
      throw DomainErrors.conflict(
        `order ${context.orderId} has no stored account password`,
      );
    }

    await this.audit.record({
      actor: input.staff.id,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: FULFILLMENT_AUDIT_ACTIONS.SERVICE_ACCOUNT_PASSWORD_VIEWED,
      entity: 'Order',
      entityId: context.orderId,
      after: {
        workItemId: context.workItemId,
        viewedBy: input.staff.id,
        reason: input.reason,
        viewedAt: new Date().toISOString(),
      },
    });

    const key = this.config.bankDetailsEncryptionKey();
    try {
      return { accountPassword: openServiceAccountPassword(envelope, key) };
    } finally {
      key.fill(0);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                 */
  /* ---------------------------------------------------------------------- */

  private needsOurEmail(asset: GiftCardAssetView): boolean {
    return asset.assetType !== 'PROVIDER_DIRECT_EMAIL';
  }

  private resolveRecipient(context: FulfillmentContext, asset: GiftCardAssetView): string | null {
    if (asset.assetType === 'PROVIDER_DIRECT_EMAIL') {
      return null;
    }
    const email = context.deliveryEmail;
    return email !== null && email.trim().length > 0 ? email.trim() : null;
  }

  private async loadContext(workItemId: string): Promise<FulfillmentContext> {
    const context = await this.store.loadContextByWorkItem(workItemId);
    if (context === null) {
      throw DomainErrors.notFound(`fulfillment context for work item ${workItemId}`);
    }
    return context;
  }

  private assertCanView(context: FulfillmentContext, staff: StaffContext): void {
    if (MANAGER_APPROVAL_ROLE_SET.has(staff.role)) {
      return;
    }
    if (context.assignedToStaffId === null || context.assignedToStaffId === staff.id) {
      return;
    }
    throw DomainErrors.forbidden(
      `work item ${context.workItemId} is assigned to another operator`,
    );
  }

  /** Mutating the workspace requires holding the claim (or a manager role). */
  private assertCanOperate(context: FulfillmentContext, staff: StaffContext): void {
    if (MANAGER_APPROVAL_ROLE_SET.has(staff.role)) {
      return;
    }
    if (context.assignedToStaffId !== staff.id) {
      throw DomainErrors.forbidden(
        `staff ${staff.id} does not hold the claim on work item ${context.workItemId}`,
      );
    }
  }

  private async reloadWorkspace(workItemId: string): Promise<FulfillmentWorkspace> {
    const context = await this.loadContext(workItemId);
    const state = await this.checklists.ensure(context);
    return this.toWorkspace(context, state);
  }

  private async toWorkspace(
    context: FulfillmentContext,
    state: ChecklistState,
  ): Promise<FulfillmentWorkspace> {
    const assets = await this.assets.listForOrder(context.orderId);
    return {
      workItemId: context.workItemId,
      orderId: context.orderId,
      checklist: state.view,
      assets,
      costVariance: state.variance,
      sendBlockers: state.sendBlockers,
      canSend: state.sendBlockers.length === 0,
      internationalPayment: context.internationalPayment,
    };
  }
}
