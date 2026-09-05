import { Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@barat/database';
import type {
  ChecklistItemStatus,
  ChecklistItemType,
  ChecklistStatus,
  DeliveryAssetType,
  DeliveryStatus,
  OrderStatus,
  QueueKey,
  WorkItemType,
} from '@barat/contracts';

import { readServiceAccountSnapshot } from '../quotes/service-account-fields';
import { isUniqueConstraintViolation } from '../workitems/prisma-errors';
import { maskEmail } from './mask-recipient';
import type {
  AssetSecretRecord,
  ChecklistItemDefinition,
  ChecklistRecord,
  FulfillmentContext,
  FulfillmentRecord,
  FulfillmentStore,
  GiftCardAssetView,
  InternationalPaymentBrief,
} from './fulfillment.types';

/**
 * The Prisma implementation of `FulfillmentStore`.
 *
 * Two projections exist for `GiftCardAsset` and they are not interchangeable:
 *
 *   ASSET_VIEW_SELECT   – everything except `encryptedCode` / `encryptedPin`.
 *                         This is what list and detail endpoints get.
 *   findAssetSecret()   – the only method that reads the ciphertext columns, and
 *                         the only caller is `GiftCardAssetService.revealSecret`,
 *                         which audits every single call.
 *
 * Keeping the ciphertext out of the default projection means a future endpoint
 * cannot leak it by accident: it would have to reach for the second method by
 * name, which is the moment a reviewer notices.
 */

const ASSET_VIEW_SELECT = {
  id: true,
  orderId: true,
  fulfillmentId: true,
  skuId: true,
  assetType: true,
  maskedCode: true,
  serialNumber: true,
  deliveryUrl: true,
  recipientEmail: true,
  expiryDate: true,
  supplierReference: true,
  status: true,
  enteredByUserId: true,
  enteredAt: true,
  sentAt: true,
  accessCount: true,
  lastAccessedAt: true,
} satisfies Prisma.GiftCardAssetSelect;

type SelectedAsset = Prisma.GiftCardAssetGetPayload<{ select: typeof ASSET_VIEW_SELECT }>;

/**
 * `hasPin` is derived from the asset TYPE, not from the ciphertext column, so a
 * plain read never pulls `encryptedPin` into the Node process at all. The two are
 * equivalent by construction: only `CODE_PIN` assets are ever written with a PIN.
 */
function toAssetView(row: SelectedAsset): GiftCardAssetView {
  return {
    id: row.id,
    orderId: row.orderId,
    fulfillmentId: row.fulfillmentId,
    skuId: row.skuId,
    assetType: row.assetType as DeliveryAssetType,
    maskedCode: row.maskedCode,
    hasPin: row.assetType === 'CODE_PIN',
    serialNumber: row.serialNumber,
    deliveryUrl: row.deliveryUrl,
    recipientEmailMasked: row.recipientEmail === null ? null : maskEmail(row.recipientEmail),
    expiryDate: row.expiryDate,
    supplierReference: row.supplierReference,
    status: row.status as DeliveryStatus,
    enteredByUserId: row.enteredByUserId,
    enteredAt: row.enteredAt,
    sentAt: row.sentAt,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt,
  };
}

const CHECKLIST_SELECT = {
  id: true,
  workItemId: true,
  templateId: true,
  status: true,
  blockedReason: true,
  completedAt: true,
  items: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      checklistId: true,
      key: true,
      label: true,
      labelFa: true,
      type: true,
      status: true,
      isBlocking: true,
      sortOrder: true,
      value: true,
      verifiedByStaffId: true,
      verifiedAt: true,
      note: true,
    },
  },
} satisfies Prisma.FulfillmentChecklistSelect;

type SelectedChecklist = Prisma.FulfillmentChecklistGetPayload<{ select: typeof CHECKLIST_SELECT }>;

function toChecklistRecord(row: SelectedChecklist): ChecklistRecord {
  return {
    id: row.id,
    workItemId: row.workItemId,
    templateId: row.templateId,
    status: row.status as ChecklistStatus,
    blockedReason: row.blockedReason,
    completedAt: row.completedAt,
    items: row.items.map((item) => ({
      id: item.id,
      checklistId: item.checklistId,
      key: item.key,
      label: item.label,
      labelFa: item.labelFa,
      type: item.type as ChecklistItemType,
      status: item.status as ChecklistItemStatus,
      isBlocking: item.isBlocking,
      sortOrder: item.sortOrder,
      hasValue: item.value !== null,
      verifiedByStaffId: item.verifiedByStaffId,
      verifiedAt: item.verifiedAt,
      note: item.note,
    })),
  };
}

const FULFILLMENT_SELECT = {
  id: true,
  orderId: true,
  workItemId: true,
  supplierId: true,
  actualSupplierCost: true,
  actualSupplierCurrency: true,
  supplierReference: true,
  supplierOrderId: true,
  costVarianceBps: true,
  approvedByStaffId: true,
  approvedAt: true,
  fulfilledByStaffId: true,
} satisfies Prisma.FulfillmentSelect;

type SelectedFulfillment = Prisma.FulfillmentGetPayload<{ select: typeof FULFILLMENT_SELECT }>;

function toFulfillmentRecord(row: SelectedFulfillment): FulfillmentRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    workItemId: row.workItemId,
    supplierId: row.supplierId,
    // Decimal -> string. Never `.toNumber()`: that is the float bug rule 2 forbids.
    actualSupplierCost: row.actualSupplierCost === null ? null : row.actualSupplierCost.toString(),
    actualSupplierCurrency: row.actualSupplierCurrency,
    supplierReference: row.supplierReference,
    supplierOrderId: row.supplierOrderId,
    costVarianceBps: row.costVarianceBps,
    approvedByStaffId: row.approvedByStaffId,
    approvedAt: row.approvedAt,
    fulfilledByStaffId: row.fulfilledByStaffId,
  };
}

/**
 * Projects the operator's payment brief out of the quote snapshot.
 *
 * `customerForeignAmount` is what the customer asked us to pay abroad, kept as
 * the decimal string it was written as — money is never parsed into a JS number
 * on its way to a screen. The password envelope is read but never carried: only
 * its presence survives into the brief.
 */
function toInternationalPaymentBrief(input: {
  snapshot: Prisma.JsonValue;
  currency: string;
  serviceNameFa: string | null;
}): InternationalPaymentBrief {
  const account = readServiceAccountSnapshot(input.snapshot);
  const snapshot =
    typeof input.snapshot === 'object' && input.snapshot !== null && !Array.isArray(input.snapshot)
      ? (input.snapshot as Record<string, Prisma.JsonValue>)
      : {};
  const payable = snapshot['customerForeignAmount'];

  return {
    serviceNameFa: input.serviceNameFa,
    payableAmount: typeof payable === 'string' && payable !== '' ? payable : null,
    payableCurrency: input.currency,
    siteUrl: account?.siteUrl ?? null,
    accountUsername: account?.accountUsername ?? null,
    hasAccountPassword: account?.accountPasswordEnvelope != null,
  };
}

@Injectable()
export class PrismaFulfillmentStore implements FulfillmentStore {
  private readonly db: typeof prisma;

  constructor() {
    this.db = prisma;
  }

  /* ---- context ---------------------------------------------------------- */

  async loadContextByWorkItem(workItemId: string): Promise<FulfillmentContext | null> {
    const workItem = await this.db.workItem.findUnique({
      where: { id: workItemId },
      select: {
        id: true,
        orderId: true,
        type: true,
        assignedToStaffId: true,
        queue: { select: { key: true } },
      },
    });
    if (workItem === null || workItem.orderId === null) {
      return null;
    }
    return this.buildContext({
      workItemId: workItem.id,
      orderId: workItem.orderId,
      workItemType: workItem.type as WorkItemType,
      queueKey: workItem.queue.key as QueueKey,
      assignedToStaffId: workItem.assignedToStaffId,
    });
  }

  async loadContextByOrder(orderId: string): Promise<FulfillmentContext | null> {
    const workItem = await this.db.workItem.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        assignedToStaffId: true,
        queue: { select: { key: true } },
      },
    });
    if (workItem === null) {
      return null;
    }
    return this.buildContext({
      workItemId: workItem.id,
      orderId,
      workItemType: workItem.type as WorkItemType,
      queueKey: workItem.queue.key as QueueKey,
      assignedToStaffId: workItem.assignedToStaffId,
    });
  }

  private async buildContext(input: {
    workItemId: string;
    orderId: string;
    workItemType: WorkItemType;
    queueKey: QueueKey;
    assignedToStaffId: string | null;
  }): Promise<FulfillmentContext | null> {
    const order = await this.db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        status: true,
        deliveryEmail: true,
        quote: {
          select: {
            supplierCostUsd: true,
            currency: true,
            snapshot: true,
            service: { select: { nameFa: true } },
            pricingRule: { select: { maxSupplierCostToleranceBps: true } },
          },
        },
      },
    });
    if (order === null) {
      return null;
    }

    const [verifiedPayments, assetCount, fulfillmentRow] = await Promise.all([
      this.db.payment.count({
        where: { orderId: order.id, status: 'PAID', verifiedAt: { not: null } },
      }),
      this.db.giftCardAsset.count({ where: { orderId: order.id } }),
      this.db.fulfillment.findFirst({
        where: { orderId: order.id, workItemId: input.workItemId },
        orderBy: { createdAt: 'desc' },
        select: FULFILLMENT_SELECT,
      }),
    ]);

    return {
      orderId: order.id,
      orderStatus: order.status as OrderStatus,
      hasVerifiedPayment: verifiedPayments > 0,
      deliveryEmail: order.deliveryEmail,
      quotedSupplierCost: order.quote.supplierCostUsd.toString(),
      // The quote's supplier cost column is denominated in USD by definition.
      quotedSupplierCurrency: 'USD',
      maxSupplierCostToleranceBps: order.quote.pricingRule?.maxSupplierCostToleranceBps ?? 0,
      workItemId: input.workItemId,
      workItemType: input.workItemType,
      queueKey: input.queueKey,
      assignedToStaffId: input.assignedToStaffId,
      fulfillment: fulfillmentRow === null ? null : toFulfillmentRecord(fulfillmentRow),
      assetCount,
      internationalPayment:
        input.workItemType === 'INTERNATIONAL_PAYMENT'
          ? toInternationalPaymentBrief({
              snapshot: order.quote.snapshot,
              currency: order.quote.currency,
              serviceNameFa: order.quote.service?.nameFa ?? null,
            })
          : null,
    };
  }

  /**
   * Reads the sealed password on its own.
   *
   * Separate from `buildContext` so the ciphertext is fetched only when someone
   * has already passed the reveal's authorisation and audit.
   */
  async findServiceAccountPasswordEnvelope(orderId: string): Promise<string | null> {
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      select: { quote: { select: { snapshot: true } } },
    });
    if (order === null) {
      return null;
    }
    return readServiceAccountSnapshot(order.quote.snapshot)?.accountPasswordEnvelope ?? null;
  }

  /* ---- checklist -------------------------------------------------------- */

  async findChecklist(workItemId: string): Promise<ChecklistRecord | null> {
    const row = await this.db.fulfillmentChecklist.findUnique({
      where: { workItemId },
      select: CHECKLIST_SELECT,
    });
    return row === null ? null : toChecklistRecord(row);
  }

  async ensureTemplate(input: {
    workItemType: WorkItemType;
    queueKey: QueueKey;
    definition: readonly ChecklistItemDefinition[];
  }): Promise<{ id: string }> {
    const existing = await this.db.taskChecklistTemplate.findFirst({
      where: { workItemType: input.workItemType, isActive: true },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (existing !== null) {
      return existing;
    }

    // Version 1 is the shipped seed. Later versions are authored in the admin
    // panel; this never overwrites one.
    return this.db.taskChecklistTemplate.upsert({
      where: {
        workItemType_queueKey_version: {
          workItemType: input.workItemType,
          queueKey: input.queueKey,
          version: 1,
        },
      },
      create: {
        workItemType: input.workItemType,
        queueKey: input.queueKey,
        version: 1,
        name: `${input.workItemType} default checklist`,
        isActive: true,
        definition: input.definition as unknown as Prisma.InputJsonValue,
      },
      update: {},
      select: { id: true },
    });
  }

  async createChecklist(input: {
    workItemId: string;
    templateId: string;
    items: readonly (ChecklistItemDefinition & { status: ChecklistItemStatus; hasValue: boolean })[];
  }): Promise<ChecklistRecord> {
    const row = await this.db.fulfillmentChecklist.create({
      data: {
        workItemId: input.workItemId,
        templateId: input.templateId,
        status: 'INCOMPLETE',
        items: {
          create: input.items.map((item) => ({
            key: item.key,
            label: item.label,
            labelFa: item.labelFa,
            type: item.type,
            status: item.status,
            isBlocking: item.isBlocking,
            sortOrder: item.sortOrder,
          })),
        },
      },
      select: CHECKLIST_SELECT,
    });
    return toChecklistRecord(row);
  }

  async updateChecklistItem(input: {
    itemId: string;
    type?: ChecklistItemType;
    status: ChecklistItemStatus;
    verifiedByStaffId?: string | null;
    verifiedAt?: Date | null;
    note?: string | null;
  }): Promise<void> {
    await this.db.fulfillmentChecklistItem.update({
      where: { id: input.itemId },
      data: {
        ...(input.type === undefined ? {} : { type: input.type }),
        status: input.status,
        ...(input.verifiedByStaffId === undefined ? {} : { verifiedByStaffId: input.verifiedByStaffId }),
        ...(input.verifiedAt === undefined ? {} : { verifiedAt: input.verifiedAt }),
        ...(input.note === undefined ? {} : { note: input.note }),
      },
    });
  }

  async setChecklistItemValue(input: {
    itemId: string;
    value: unknown;
    status: ChecklistItemStatus;
    verifiedByStaffId: string;
    verifiedAt: Date;
  }): Promise<void> {
    await this.db.fulfillmentChecklistItem.update({
      where: { id: input.itemId },
      data: {
        value: input.value as Prisma.InputJsonValue,
        status: input.status,
        verifiedByStaffId: input.verifiedByStaffId,
        verifiedAt: input.verifiedAt,
      },
    });
  }

  async updateChecklistStatus(input: {
    checklistId: string;
    status: ChecklistStatus;
    blockedReason: string | null;
    completedAt?: Date | null;
  }): Promise<void> {
    await this.db.fulfillmentChecklist.update({
      where: { id: input.checklistId },
      data: {
        status: input.status,
        blockedReason: input.blockedReason,
        ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
      },
    });
  }

  /* ---- fulfillment record ----------------------------------------------- */

  async ensureFulfillment(input: {
    orderId: string;
    workItemId: string;
    supplierId?: string;
    idempotencyKey?: string;
  }): Promise<FulfillmentRecord> {
    const existing = await this.db.fulfillment.findFirst({
      where: { orderId: input.orderId, workItemId: input.workItemId },
      orderBy: { createdAt: 'desc' },
      select: FULFILLMENT_SELECT,
    });
    if (existing !== null) {
      return toFulfillmentRecord(existing);
    }

    try {
      const created = await this.db.fulfillment.create({
        data: {
          orderId: input.orderId,
          workItemId: input.workItemId,
          status: 'IN_PROGRESS',
          method: 'MANUAL',
          startedAt: new Date(),
          ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
          ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
        },
        select: FULFILLMENT_SELECT,
      });
      return toFulfillmentRecord(created);
    } catch (error) {
      // Two operators opened the workspace at the same time. The unique
      // idempotency key decided it; return the winner rather than failing.
      if (isUniqueConstraintViolation(error)) {
        const winner = await this.db.fulfillment.findFirst({
          where: { orderId: input.orderId, workItemId: input.workItemId },
          orderBy: { createdAt: 'desc' },
          select: FULFILLMENT_SELECT,
        });
        if (winner !== null) {
          return toFulfillmentRecord(winner);
        }
      }
      throw error;
    }
  }

  async findFulfillmentById(fulfillmentId: string): Promise<FulfillmentRecord | null> {
    const row = await this.db.fulfillment.findUnique({
      where: { id: fulfillmentId },
      select: FULFILLMENT_SELECT,
    });
    return row === null ? null : toFulfillmentRecord(row);
  }

  async updateSupplierCost(input: {
    fulfillmentId: string;
    actualSupplierCost: string;
    actualSupplierCurrency: string;
    supplierReference: string | null;
    costVarianceBps: number | null;
    fulfilledByStaffId: string | null;
  }): Promise<void> {
    await this.db.fulfillment.update({
      where: { id: input.fulfillmentId },
      data: {
        actualSupplierCost: new Prisma.Decimal(input.actualSupplierCost),
        actualSupplierCurrency: input.actualSupplierCurrency,
        costVarianceBps: input.costVarianceBps,
        fulfilledByStaffId: input.fulfilledByStaffId,
        ...(input.supplierReference === null ? {} : { supplierReference: input.supplierReference }),
      },
    });
  }

  /**
   * Conditional update: the approval only lands while none exists.
   *
   * Without the `approvedByStaffId: null` predicate a second manager could
   * overwrite the first approver's identity, and the audit trail would name the
   * wrong person for a financial decision.
   */
  async approveCostVariance(input: {
    fulfillmentId: string;
    approvedByStaffId: string;
    approvedAt: Date;
  }): Promise<boolean> {
    const result = await this.db.fulfillment.updateMany({
      where: { id: input.fulfillmentId, approvedByStaffId: null },
      data: { approvedByStaffId: input.approvedByStaffId, approvedAt: input.approvedAt },
    });
    return result.count === 1;
  }

  async markFulfillmentCompleted(fulfillmentId: string, at: Date): Promise<void> {
    await this.db.fulfillment.update({
      where: { id: fulfillmentId },
      data: { status: 'COMPLETED', completedAt: at },
    });
  }

  /* ---- assets ------------------------------------------------------------ */

  async findAssetsByOrder(orderId: string): Promise<readonly GiftCardAssetView[]> {
    const rows = await this.db.giftCardAsset.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: ASSET_VIEW_SELECT,
    });
    return rows.map(toAssetView);
  }

  async findAssetView(assetId: string): Promise<GiftCardAssetView | null> {
    const row = await this.db.giftCardAsset.findUnique({
      where: { id: assetId },
      select: ASSET_VIEW_SELECT,
    });
    return row === null ? null : toAssetView(row);
  }

  /**
   * The ONLY read of the ciphertext columns in the entire codebase.
   * `GiftCardAssetService.revealSecret` is its only caller and audits every call.
   */
  async findAssetSecret(assetId: string): Promise<AssetSecretRecord | null> {
    const row = await this.db.giftCardAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        orderId: true,
        assetType: true,
        encryptedCode: true,
        encryptedPin: true,
        deliveryUrl: true,
        recipientEmail: true,
        expiryDate: true,
        status: true,
      },
    });
    if (row === null) {
      return null;
    }
    return {
      id: row.id,
      orderId: row.orderId,
      assetType: row.assetType as DeliveryAssetType,
      encryptedCode: row.encryptedCode,
      encryptedPin: row.encryptedPin,
      deliveryUrl: row.deliveryUrl,
      recipientEmail: row.recipientEmail,
      expiryDate: row.expiryDate,
      status: row.status as DeliveryStatus,
    };
  }

  async createAsset(input: {
    orderId: string;
    fulfillmentId: string;
    skuId: string | null;
    assetType: DeliveryAssetType;
    encryptedCode: string | null;
    encryptedPin: string | null;
    maskedCode: string | null;
    serialNumber: string | null;
    deliveryUrl: string | null;
    recipientEmail: string | null;
    expiryDate: Date | null;
    supplierReference: string | null;
    actualSupplierCost: string | null;
    actualSupplierCurrency: string | null;
    enteredByUserId: string | null;
    enteredAt: Date;
  }): Promise<GiftCardAssetView> {
    const row = await this.db.giftCardAsset.create({
      data: {
        orderId: input.orderId,
        fulfillmentId: input.fulfillmentId,
        skuId: input.skuId,
        assetType: input.assetType,
        encryptedCode: input.encryptedCode,
        encryptedPin: input.encryptedPin,
        maskedCode: input.maskedCode,
        serialNumber: input.serialNumber,
        deliveryUrl: input.deliveryUrl,
        recipientEmail: input.recipientEmail,
        expiryDate: input.expiryDate,
        supplierReference: input.supplierReference,
        actualSupplierCost:
          input.actualSupplierCost === null ? null : new Prisma.Decimal(input.actualSupplierCost),
        actualSupplierCurrency: input.actualSupplierCurrency,
        status: 'READY',
        enteredByUserId: input.enteredByUserId,
        enteredAt: input.enteredAt,
        encryptionKeyVersion: 1,
      },
      select: ASSET_VIEW_SELECT,
    });
    return toAssetView(row);
  }

  async recordSecretAccess(assetId: string, at: Date): Promise<void> {
    await this.db.giftCardAsset.update({
      where: { id: assetId },
      data: { accessCount: { increment: 1 }, lastAccessedAt: at },
    });
  }

  /**
   * Atomic transition into SENDING.
   *
   * This is what prevents a double send: the retry endpoint and the delivery
   * worker can both fire, but only the caller whose `UPDATE` matched a row is
   * allowed to hand the asset to the transport.
   */
  async beginSending(assetId: string, from: readonly DeliveryStatus[]): Promise<boolean> {
    const result = await this.db.giftCardAsset.updateMany({
      where: { id: assetId, status: { in: [...from] } },
      data: { status: 'SENDING' },
    });
    return result.count === 1;
  }

  async markAssetSent(assetId: string, at: Date): Promise<void> {
    await this.db.giftCardAsset.update({
      where: { id: assetId },
      data: { status: 'SENT', sentAt: at },
    });
  }

  /**
   * A failed delivery only moves the status. The row — and with it the encrypted
   * code we already paid the supplier for — is never deleted or replaced.
   */
  async markAssetDeliveryFailed(assetId: string): Promise<void> {
    await this.db.giftCardAsset.update({
      where: { id: assetId },
      data: { status: 'DELIVERY_FAILED' },
    });
  }

  /* ---- delivery attempts -------------------------------------------------- */

  async nextAttemptNumber(assetId: string): Promise<number> {
    const last = await this.db.deliveryAttempt.findFirst({
      where: { giftCardAssetId: assetId },
      orderBy: { attemptNumber: 'desc' },
      select: { attemptNumber: true },
    });
    return (last?.attemptNumber ?? 0) + 1;
  }

  async createDeliveryAttempt(input: {
    assetId: string;
    orderId: string;
    recipientMasked: string;
    attemptNumber: number;
  }): Promise<{ id: string }> {
    return this.db.deliveryAttempt.create({
      data: {
        giftCardAssetId: input.assetId,
        orderId: input.orderId,
        channel: 'EMAIL',
        recipientMasked: input.recipientMasked,
        status: 'SENDING',
        attemptNumber: input.attemptNumber,
      },
      select: { id: true },
    });
  }

  async completeDeliveryAttempt(input: {
    attemptId: string;
    status: DeliveryStatus;
    providerMessageId: string | null;
    errorCode: string | null;
    sentAt: Date | null;
  }): Promise<void> {
    await this.db.deliveryAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: input.status,
        providerMessageId: input.providerMessageId,
        errorCode: input.errorCode,
        sentAt: input.sentAt,
      },
    });
  }

  /* ---- order ------------------------------------------------------------- */

  async markOrderFulfilled(orderId: string, at: Date): Promise<void> {
    await this.db.order.update({
      where: { id: orderId },
      data: { status: 'FULFILLED', fulfilledAt: at },
    });
  }
}
