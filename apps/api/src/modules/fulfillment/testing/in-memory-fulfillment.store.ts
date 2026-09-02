import type {
  ChecklistItemStatus,
  ChecklistStatus,
  DeliveryAssetType,
  DeliveryStatus,
  OrderStatus,
  QueueKey,
  WorkItemType,
} from '@barat/contracts';

import { maskEmail } from '../mask-recipient';
import type {
  AssetSecretRecord,
  ChecklistItemDefinition,
  ChecklistItemRecord,
  ChecklistRecord,
  FulfillmentContext,
  FulfillmentRecord,
  FulfillmentStore,
  GiftCardAssetView,
  InternationalPaymentBrief,
} from '../fulfillment.types';

/**
 * An in-memory `FulfillmentStore` for tests.
 *
 * It exists so the send gate, the cost-variance rule and the retry path can be
 * proved without a database — which matters because those three are exactly the
 * rules that must hold when someone calls the API directly instead of using the
 * panel. The two operations the real store implements atomically
 * (`beginSending` and `approveCostVariance`) are implemented here with the same
 * compare-and-set semantics, so a test that passes here is testing the same
 * concurrency contract Postgres enforces.
 */

interface AssetRow {
  id: string;
  orderId: string;
  fulfillmentId: string | null;
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
  status: DeliveryStatus;
  enteredByUserId: string | null;
  enteredAt: Date | null;
  sentAt: Date | null;
  accessCount: number;
  lastAccessedAt: Date | null;
}

interface AttemptRow {
  id: string;
  assetId: string;
  orderId: string;
  recipientMasked: string;
  attemptNumber: number;
  status: DeliveryStatus;
  providerMessageId: string | null;
  errorCode: string | null;
  sentAt: Date | null;
}

/**
 * The persisted record types are deeply `readonly` so that no service can mutate
 * a snapshot it was handed. The in-memory test store is the one place that owns
 * the storage itself, so it strips `readonly` for its own backing rows and hands
 * out frozen snapshots via {@link snapshotChecklist}.
 */
type MutableChecklistItem = {
  -readonly [K in keyof ChecklistItemRecord]: ChecklistItemRecord[K];
} & { value?: unknown };

interface MutableChecklist {
  id: string;
  workItemId: string;
  templateId: string | null;
  status: ChecklistStatus;
  blockedReason: string | null;
  completedAt: Date | null;
  items: MutableChecklistItem[];
}

export interface SeedFulfillment {
  readonly orderId?: string;
  readonly workItemId?: string;
  readonly orderStatus?: OrderStatus;
  readonly hasVerifiedPayment?: boolean;
  readonly deliveryEmail?: string | null;
  readonly quotedSupplierCost?: string | null;
  readonly quotedSupplierCurrency?: string;
  readonly maxSupplierCostToleranceBps?: number;
  readonly workItemType?: WorkItemType;
  readonly queueKey?: QueueKey;
  readonly assignedToStaffId?: string | null;
  readonly internationalPayment?: InternationalPaymentBrief | null;
  /** Sealed `v1.<iv>.<tag>.<ciphertext>` password, as the real store returns it. */
  readonly serviceAccountPasswordEnvelope?: string | null;
}

export class InMemoryFulfillmentStore implements FulfillmentStore {
  orderId: string;
  workItemId: string;
  orderStatus: OrderStatus;
  hasVerifiedPayment: boolean;
  deliveryEmail: string | null;
  quotedSupplierCost: string | null;
  quotedSupplierCurrency: string;
  maxSupplierCostToleranceBps: number;
  workItemType: WorkItemType;
  queueKey: QueueKey;
  assignedToStaffId: string | null;
  internationalPayment: InternationalPaymentBrief | null;
  serviceAccountPasswordEnvelope: string | null;
  orderFulfilledAt: Date | null = null;

  readonly checklists = new Map<string, MutableChecklist>();
  readonly fulfillments = new Map<string, FulfillmentRecord>();
  readonly assets = new Map<string, AssetRow>();
  readonly attempts: AttemptRow[] = [];
  readonly templates = new Map<string, { id: string }>();

  private sequence = 0;

  constructor(seed: SeedFulfillment = {}) {
    this.orderId = seed.orderId ?? 'order-1';
    this.workItemId = seed.workItemId ?? 'wi-1';
    this.orderStatus = seed.orderStatus ?? 'PAID';
    this.hasVerifiedPayment = seed.hasVerifiedPayment ?? true;
    this.deliveryEmail = seed.deliveryEmail === undefined ? 'buyer@example.com' : seed.deliveryEmail;
    this.quotedSupplierCost = seed.quotedSupplierCost === undefined ? '100.00' : seed.quotedSupplierCost;
    this.quotedSupplierCurrency = seed.quotedSupplierCurrency ?? 'USD';
    this.maxSupplierCostToleranceBps = seed.maxSupplierCostToleranceBps ?? 500;
    this.workItemType = seed.workItemType ?? 'MANUAL_GIFT_CARD_FULFILLMENT';
    this.queueKey = seed.queueKey ?? 'GIFT_CARD_MANUAL';
    this.assignedToStaffId = seed.assignedToStaffId === undefined ? 'staff-operator' : seed.assignedToStaffId;
    this.internationalPayment = seed.internationalPayment ?? null;
    this.serviceAccountPasswordEnvelope = seed.serviceAccountPasswordEnvelope ?? null;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence)}`;
  }

  /* ---- context ---------------------------------------------------------- */

  private context(): FulfillmentContext {
    const fulfillment = [...this.fulfillments.values()].find((row) => row.orderId === this.orderId) ?? null;
    return {
      orderId: this.orderId,
      orderStatus: this.orderStatus,
      hasVerifiedPayment: this.hasVerifiedPayment,
      deliveryEmail: this.deliveryEmail,
      quotedSupplierCost: this.quotedSupplierCost,
      quotedSupplierCurrency: this.quotedSupplierCurrency,
      maxSupplierCostToleranceBps: this.maxSupplierCostToleranceBps,
      workItemId: this.workItemId,
      workItemType: this.workItemType,
      queueKey: this.queueKey,
      assignedToStaffId: this.assignedToStaffId,
      fulfillment,
      assetCount: [...this.assets.values()].filter((row) => row.orderId === this.orderId).length,
      internationalPayment:
        this.workItemType === 'INTERNATIONAL_PAYMENT' ? this.internationalPayment : null,
    };
  }

  async findServiceAccountPasswordEnvelope(orderId: string): Promise<string | null> {
    return orderId === this.orderId ? this.serviceAccountPasswordEnvelope : null;
  }

  async loadContextByWorkItem(workItemId: string): Promise<FulfillmentContext | null> {
    return workItemId === this.workItemId ? this.context() : null;
  }

  async loadContextByOrder(orderId: string): Promise<FulfillmentContext | null> {
    return orderId === this.orderId ? this.context() : null;
  }

  /* ---- checklist -------------------------------------------------------- */

  async findChecklist(workItemId: string): Promise<ChecklistRecord | null> {
    const record = this.checklists.get(workItemId);
    return record === undefined ? null : snapshotChecklist(record);
  }

  async ensureTemplate(input: {
    workItemType: WorkItemType;
    queueKey: QueueKey;
    definition: readonly ChecklistItemDefinition[];
  }): Promise<{ id: string }> {
    const key = `${input.workItemType}:${input.queueKey}`;
    const existing = this.templates.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = { id: this.nextId('template') };
    this.templates.set(key, created);
    return created;
  }

  async createChecklist(input: {
    workItemId: string;
    templateId: string;
    items: readonly (ChecklistItemDefinition & { status: ChecklistItemStatus; hasValue: boolean })[];
  }): Promise<ChecklistRecord> {
    const record: MutableChecklist = {
      id: this.nextId('checklist'),
      workItemId: input.workItemId,
      templateId: input.templateId,
      status: 'INCOMPLETE',
      blockedReason: null,
      completedAt: null,
      items: input.items.map((item) => ({
        id: this.nextId('item'),
        checklistId: '',
        key: item.key,
        label: item.label,
        labelFa: item.labelFa,
        type: item.type,
        status: item.status,
        isBlocking: item.isBlocking,
        sortOrder: item.sortOrder,
        hasValue: item.hasValue,
        verifiedByStaffId: null,
        verifiedAt: null,
        note: null,
      })),
    };
    record.items = record.items.map((item) => ({ ...item, checklistId: record.id }));
    this.checklists.set(input.workItemId, record);
    return snapshotChecklist(record);
  }

  private findItem(itemId: string): MutableChecklistItem | undefined {
    for (const checklist of this.checklists.values()) {
      const found = checklist.items.find((item) => item.id === itemId);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  async updateChecklistItem(input: {
    itemId: string;
    type?: ChecklistItemRecord['type'];
    status: ChecklistItemStatus;
    verifiedByStaffId?: string | null;
    verifiedAt?: Date | null;
    note?: string | null;
  }): Promise<void> {
    const item = this.findItem(input.itemId);
    if (item === undefined) {
      return;
    }
    item.status = input.status;
    if (input.type !== undefined) {
      item.type = input.type;
    }
    if (input.verifiedByStaffId !== undefined) {
      item.verifiedByStaffId = input.verifiedByStaffId;
    }
    if (input.verifiedAt !== undefined) {
      item.verifiedAt = input.verifiedAt;
    }
    if (input.note !== undefined) {
      item.note = input.note;
    }
  }

  async setChecklistItemValue(input: {
    itemId: string;
    value: unknown;
    status: ChecklistItemStatus;
    verifiedByStaffId: string;
    verifiedAt: Date;
  }): Promise<void> {
    const item = this.findItem(input.itemId);
    if (item === undefined) {
      return;
    }
    item.value = input.value;
    item.hasValue = input.value !== null && input.value !== undefined;
    item.status = input.status;
    item.verifiedByStaffId = input.verifiedByStaffId;
    item.verifiedAt = input.verifiedAt;
  }

  async updateChecklistStatus(input: {
    checklistId: string;
    status: ChecklistStatus;
    blockedReason: string | null;
    completedAt?: Date | null;
  }): Promise<void> {
    for (const checklist of this.checklists.values()) {
      if (checklist.id === input.checklistId) {
        checklist.status = input.status;
        checklist.blockedReason = input.blockedReason;
        if (input.completedAt !== undefined) {
          checklist.completedAt = input.completedAt;
        }
        return;
      }
    }
  }

  /* ---- fulfillment ------------------------------------------------------- */

  async ensureFulfillment(input: {
    orderId: string;
    workItemId: string;
    supplierId?: string;
    idempotencyKey?: string;
  }): Promise<FulfillmentRecord> {
    const existing = [...this.fulfillments.values()].find((row) => row.orderId === input.orderId);
    if (existing !== undefined) {
      return existing;
    }
    const created: FulfillmentRecord = {
      id: this.nextId('fulfillment'),
      orderId: input.orderId,
      workItemId: input.workItemId,
      supplierId: input.supplierId ?? null,
      actualSupplierCost: null,
      actualSupplierCurrency: null,
      supplierReference: null,
      supplierOrderId: null,
      costVarianceBps: null,
      approvedByStaffId: null,
      approvedAt: null,
      fulfilledByStaffId: null,
    };
    this.fulfillments.set(created.id, created);
    return created;
  }

  async findFulfillmentById(fulfillmentId: string): Promise<FulfillmentRecord | null> {
    return this.fulfillments.get(fulfillmentId) ?? null;
  }

  async updateSupplierCost(input: {
    fulfillmentId: string;
    actualSupplierCost: string;
    actualSupplierCurrency: string;
    supplierReference: string | null;
    costVarianceBps: number | null;
    fulfilledByStaffId: string;
  }): Promise<void> {
    const existing = this.fulfillments.get(input.fulfillmentId);
    if (existing === undefined) {
      return;
    }
    this.fulfillments.set(input.fulfillmentId, {
      ...existing,
      actualSupplierCost: input.actualSupplierCost,
      actualSupplierCurrency: input.actualSupplierCurrency,
      supplierReference: input.supplierReference,
      costVarianceBps: input.costVarianceBps,
      fulfilledByStaffId: input.fulfilledByStaffId,
    });
  }

  /** Mirrors the real `updateMany(... approvedByStaffId: null)` compare-and-set. */
  async approveCostVariance(input: {
    fulfillmentId: string;
    approvedByStaffId: string;
    approvedAt: Date;
  }): Promise<boolean> {
    const existing = this.fulfillments.get(input.fulfillmentId);
    if (existing === undefined || existing.approvedByStaffId !== null) {
      return false;
    }
    this.fulfillments.set(input.fulfillmentId, {
      ...existing,
      approvedByStaffId: input.approvedByStaffId,
      approvedAt: input.approvedAt,
    });
    return true;
  }

  async markFulfillmentCompleted(_fulfillmentId: string, _at: Date): Promise<void> {
    // Status lives on the Prisma row only; nothing in the gate reads it.
  }

  /* ---- assets ------------------------------------------------------------ */

  async findAssetsByOrder(orderId: string): Promise<readonly GiftCardAssetView[]> {
    return [...this.assets.values()].filter((row) => row.orderId === orderId).map(toView);
  }

  async findAssetView(assetId: string): Promise<GiftCardAssetView | null> {
    const row = this.assets.get(assetId);
    return row === undefined ? null : toView(row);
  }

  async findAssetSecret(assetId: string): Promise<AssetSecretRecord | null> {
    const row = this.assets.get(assetId);
    if (row === undefined) {
      return null;
    }
    return {
      id: row.id,
      orderId: row.orderId,
      assetType: row.assetType,
      encryptedCode: row.encryptedCode,
      encryptedPin: row.encryptedPin,
      deliveryUrl: row.deliveryUrl,
      recipientEmail: row.recipientEmail,
      expiryDate: row.expiryDate,
      status: row.status,
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
    enteredByUserId: string;
    enteredAt: Date;
  }): Promise<GiftCardAssetView> {
    const row: AssetRow = {
      id: this.nextId('asset'),
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
      status: 'READY',
      enteredByUserId: input.enteredByUserId,
      enteredAt: input.enteredAt,
      sentAt: null,
      accessCount: 0,
      lastAccessedAt: null,
    };
    this.assets.set(row.id, row);
    return toView(row);
  }

  async recordSecretAccess(assetId: string, at: Date): Promise<void> {
    const row = this.assets.get(assetId);
    if (row !== undefined) {
      row.accessCount += 1;
      row.lastAccessedAt = at;
    }
  }

  /** Mirrors the real compare-and-set: only one caller can win. */
  async beginSending(assetId: string, from: readonly DeliveryStatus[]): Promise<boolean> {
    const row = this.assets.get(assetId);
    if (row === undefined || !from.includes(row.status)) {
      return false;
    }
    row.status = 'SENDING';
    return true;
  }

  async markAssetSent(assetId: string, at: Date): Promise<void> {
    const row = this.assets.get(assetId);
    if (row !== undefined) {
      row.status = 'SENT';
      row.sentAt = at;
    }
  }

  async markAssetDeliveryFailed(assetId: string): Promise<void> {
    const row = this.assets.get(assetId);
    if (row !== undefined) {
      row.status = 'DELIVERY_FAILED';
    }
  }

  /* ---- attempts ---------------------------------------------------------- */

  async nextAttemptNumber(assetId: string): Promise<number> {
    const highest = this.attempts
      .filter((attempt) => attempt.assetId === assetId)
      .reduce((max, attempt) => Math.max(max, attempt.attemptNumber), 0);
    return highest + 1;
  }

  async createDeliveryAttempt(input: {
    assetId: string;
    orderId: string;
    recipientMasked: string;
    attemptNumber: number;
  }): Promise<{ id: string }> {
    const row: AttemptRow = {
      id: this.nextId('attempt'),
      assetId: input.assetId,
      orderId: input.orderId,
      recipientMasked: input.recipientMasked,
      attemptNumber: input.attemptNumber,
      status: 'SENDING',
      providerMessageId: null,
      errorCode: null,
      sentAt: null,
    };
    this.attempts.push(row);
    return { id: row.id };
  }

  async completeDeliveryAttempt(input: {
    attemptId: string;
    status: DeliveryStatus;
    providerMessageId: string | null;
    errorCode: string | null;
    sentAt: Date | null;
  }): Promise<void> {
    const row = this.attempts.find((attempt) => attempt.id === input.attemptId);
    if (row !== undefined) {
      row.status = input.status;
      row.providerMessageId = input.providerMessageId;
      row.errorCode = input.errorCode;
      row.sentAt = input.sentAt;
    }
  }

  /* ---- order ------------------------------------------------------------- */

  async markOrderFulfilled(orderId: string, at: Date): Promise<void> {
    if (orderId === this.orderId) {
      this.orderStatus = 'FULFILLED';
      this.orderFulfilledAt = at;
    }
  }

  /* ---- test helpers ------------------------------------------------------ */

  /** Raw rows, ciphertext included — used to assert nothing is stored in clear. */
  rawAssets(): readonly AssetRow[] {
    return [...this.assets.values()];
  }
}

function toView(row: AssetRow): GiftCardAssetView {
  return {
    id: row.id,
    orderId: row.orderId,
    fulfillmentId: row.fulfillmentId,
    skuId: row.skuId,
    assetType: row.assetType,
    maskedCode: row.maskedCode,
    hasPin: row.assetType === 'CODE_PIN',
    serialNumber: row.serialNumber,
    deliveryUrl: row.deliveryUrl,
    recipientEmailMasked: row.recipientEmail === null ? null : maskEmail(row.recipientEmail),
    expiryDate: row.expiryDate,
    supplierReference: row.supplierReference,
    status: row.status,
    enteredByUserId: row.enteredByUserId,
    enteredAt: row.enteredAt,
    sentAt: row.sentAt,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt,
  };
}

function snapshotChecklist(record: MutableChecklist): ChecklistRecord {
  return {
    id: record.id,
    workItemId: record.workItemId,
    templateId: record.templateId,
    status: record.status,
    blockedReason: record.blockedReason,
    completedAt: record.completedAt,
    items: record.items.map((item) => ({
      id: item.id,
      checklistId: item.checklistId,
      key: item.key,
      label: item.label,
      labelFa: item.labelFa,
      type: item.type,
      status: item.status,
      isBlocking: item.isBlocking,
      sortOrder: item.sortOrder,
      hasValue: item.hasValue,
      verifiedByStaffId: item.verifiedByStaffId,
      verifiedAt: item.verifiedAt,
      note: item.note,
    })),
  };
}
