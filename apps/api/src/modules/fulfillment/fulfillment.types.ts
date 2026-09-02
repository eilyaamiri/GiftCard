import type {
  ChecklistItemStatus,
  ChecklistItemType,
  ChecklistStatus,
  DeliveryAssetType,
  DeliveryStatus,
  OrderStatus,
  QueueKey,
  StaffRole,
  WorkItemType,
} from '@barat/contracts';

/* ============================================================================
 * Injection tokens
 * ==========================================================================*/

export const FULFILLMENT_STORE = Symbol.for('barat.fulfillment-store');
export const ASSET_DELIVERY_TRANSPORT = Symbol.for('barat.asset-delivery-transport');

/* ============================================================================
 * Checklist templates
 * ==========================================================================*/

export interface ChecklistItemDefinition {
  readonly key: string;
  readonly label: string;
  readonly labelFa: string;
  readonly type: ChecklistItemType;
  /** A blocking item that is neither PASSED nor NOT_APPLICABLE prevents sending. */
  readonly isBlocking: boolean;
  readonly sortOrder: number;
}

/**
 * The four SYSTEM_VERIFIED keys the backend derives from real state.
 *
 * `GIFT_CARD_ASSET_PRESENT` is derived from the EXISTENCE of an asset row, never
 * from its plaintext. Checklist logic never decrypts anything.
 */
export const SYSTEM_VERIFIED_KEYS = {
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  ACTUAL_COST_PRESENT: 'ACTUAL_COST_PRESENT',
  PROVIDER_REFERENCE_PRESENT: 'PROVIDER_REFERENCE_PRESENT',
  GIFT_CARD_ASSET_PRESENT: 'GIFT_CARD_ASSET_PRESENT',
} as const;

export type SystemVerifiedKey = (typeof SYSTEM_VERIFIED_KEYS)[keyof typeof SYSTEM_VERIFIED_KEYS];

/* ============================================================================
 * Read models
 * ==========================================================================*/

export interface ChecklistItemView {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly labelFa: string;
  readonly type: ChecklistItemType;
  readonly status: ChecklistItemStatus;
  readonly isBlocking: boolean;
  readonly sortOrder: number;
  /** REQUIRED_FIELD items expose whether a value exists, never the value. */
  readonly hasValue: boolean;
  readonly verifiedByStaffId: string | null;
  readonly verifiedAt: Date | null;
  readonly note: string | null;
  /** Every active item is operator-clickable; legacy manager rows are omitted. */
  readonly isOperatorEditable: boolean;
}

export interface ChecklistView {
  readonly id: string;
  readonly workItemId: string;
  readonly templateId: string | null;
  readonly status: ChecklistStatus;
  readonly blockedReason: string | null;
  readonly completedAt: Date | null;
  /** True once the fulfillment has been sent. Reopening requires OPS_MANAGER. */
  readonly isLocked: boolean;
  readonly items: readonly ChecklistItemView[];
}

/**
 * The customer-facing / operator-facing view of a delivered asset.
 *
 * There is no `code`, `pin`, `encryptedCode` or `encryptedPin` field, by
 * construction. The plaintext is reachable only through
 * `GiftCardAssetService.revealSecret`, which audits every read.
 */
export interface GiftCardAssetView {
  readonly id: string;
  readonly orderId: string;
  readonly fulfillmentId: string | null;
  readonly skuId: string | null;
  readonly assetType: DeliveryAssetType;
  readonly maskedCode: string | null;
  readonly hasPin: boolean;
  readonly serialNumber: string | null;
  readonly deliveryUrl: string | null;
  readonly recipientEmailMasked: string | null;
  readonly expiryDate: Date | null;
  readonly supplierReference: string | null;
  readonly status: DeliveryStatus;
  readonly enteredByUserId: string | null;
  readonly enteredAt: Date | null;
  readonly sentAt: Date | null;
  readonly accessCount: number;
  readonly lastAccessedAt: Date | null;
}

/**
 * What an operator needs in order to make an international payment.
 *
 * Read from the immutable `Quote.snapshot` the order was placed from, so it says
 * what the customer asked for at request time and cannot drift with the service
 * catalogue afterwards.
 *
 * `payableAmount` is the customer's requested foreign amount — deliberately NOT
 * the quote's `supplierCostUsd`, which is our negotiated cost and has no place
 * on a screen that describes what to pay the foreign provider.
 *
 * There is no plaintext password field, by construction. `hasAccountPassword`
 * says only whether one exists; the value is reachable exclusively through the
 * audited reveal, exactly like a gift-card code.
 */
export interface InternationalPaymentBrief {
  readonly serviceNameFa: string | null;
  /** Decimal string in `payableCurrency`, or null for a quote that predates it. */
  readonly payableAmount: string | null;
  readonly payableCurrency: string;
  readonly siteUrl: string | null;
  readonly accountUsername: string | null;
  readonly hasAccountPassword: boolean;
}

/* ============================================================================
 * Asset input
 *
 * Mirrors `SupplierDeliveryAsset` from @barat/suppliers: the code field only
 * exists on the two asset types that actually have one. `URL` and
 * `PROVIDER_DIRECT_EMAIL` cannot carry a code even by accident — the type system
 * rejects it, and the operator UI must disable the field for them.
 * ==========================================================================*/

export type AssetSecretInput =
  | { readonly assetType: 'CODE'; readonly code: string; readonly serialNumber?: string; readonly expiryDate?: Date }
  | {
      readonly assetType: 'CODE_PIN';
      readonly code: string;
      readonly pin: string;
      readonly serialNumber?: string;
      readonly expiryDate?: Date;
    }
  | { readonly assetType: 'URL'; readonly deliveryUrl: string; readonly expiryDate?: Date }
  | { readonly assetType: 'PROVIDER_DIRECT_EMAIL'; readonly recipientEmail: string };

export interface RecordAssetInput {
  /** The order is derived from the work item, never taken from the request. */
  readonly workItemId: string;
  readonly staffId: string;
  readonly skuId?: string;
  readonly supplierId?: string;
  readonly supplierReference?: string;
  /** Decimal string in the supplier's currency. Never a JS number. */
  readonly actualSupplierCost?: string;
  readonly actualSupplierCurrency?: string;
  /** Fulfillment idempotency (AGENTS.md rule 9). */
  readonly idempotencyKey?: string;
  readonly asset: AssetSecretInput;
}

/* ============================================================================
 * Delivery transport
 * ==========================================================================*/

export interface AssetDeliveryMessage {
  readonly orderId: string;
  readonly recipientEmail: string;
  readonly assetType: DeliveryAssetType;
  /** Present only for CODE / CODE_PIN. Never logged, never persisted. */
  readonly code?: string;
  readonly pin?: string;
  readonly deliveryUrl?: string;
  readonly expiryDate?: Date | null;
}

export interface AssetDeliveryResult {
  readonly success: boolean;
  readonly providerMessageId?: string;
  /** Normalised adapter code, never a raw provider body. */
  readonly failureCode?: string;
}

export interface AssetDeliveryTransport {
  readonly name: string;
  send(message: AssetDeliveryMessage): Promise<AssetDeliveryResult>;
}

/* ============================================================================
 * Persistence port
 * ==========================================================================*/

export interface FulfillmentRecord {
  readonly id: string;
  readonly orderId: string;
  readonly workItemId: string | null;
  readonly supplierId: string | null;
  /** Decimal string, supplier currency. */
  readonly actualSupplierCost: string | null;
  readonly actualSupplierCurrency: string | null;
  readonly supplierReference: string | null;
  readonly supplierOrderId: string | null;
  readonly costVarianceBps: number | null;
  readonly approvedByStaffId: string | null;
  readonly approvedAt: Date | null;
  readonly fulfilledByStaffId: string | null;
}

/**
 * Everything the send gate re-validates, read fresh from the database.
 *
 * The gate never trusts a value the frontend submitted; it re-derives all of it
 * from this snapshot.
 */
export interface FulfillmentContext {
  readonly orderId: string;
  readonly orderStatus: OrderStatus;
  readonly hasVerifiedPayment: boolean;
  readonly deliveryEmail: string | null;
  /** Quoted supplier cost as a decimal string, the variance baseline. */
  readonly quotedSupplierCost: string | null;
  /** Currency of `quotedSupplierCost`. A mismatch invalidates the baseline. */
  readonly quotedSupplierCurrency: string;
  readonly maxSupplierCostToleranceBps: number;
  readonly workItemId: string;
  readonly workItemType: WorkItemType;
  readonly queueKey: QueueKey;
  readonly assignedToStaffId: string | null;
  readonly fulfillment: FulfillmentRecord | null;
  readonly assetCount: number;
  /** Populated only for `INTERNATIONAL_PAYMENT` work items. */
  readonly internationalPayment: InternationalPaymentBrief | null;
}

export interface ChecklistItemRecord {
  readonly id: string;
  readonly checklistId: string;
  readonly key: string;
  readonly label: string;
  readonly labelFa: string;
  readonly type: ChecklistItemType;
  readonly status: ChecklistItemStatus;
  readonly isBlocking: boolean;
  readonly sortOrder: number;
  readonly hasValue: boolean;
  readonly verifiedByStaffId: string | null;
  readonly verifiedAt: Date | null;
  readonly note: string | null;
}

export interface ChecklistRecord {
  readonly id: string;
  readonly workItemId: string;
  readonly templateId: string | null;
  readonly status: ChecklistStatus;
  readonly blockedReason: string | null;
  readonly completedAt: Date | null;
  readonly items: readonly ChecklistItemRecord[];
}

export interface AssetSecretRecord {
  readonly id: string;
  readonly orderId: string;
  readonly assetType: DeliveryAssetType;
  readonly encryptedCode: string | null;
  readonly encryptedPin: string | null;
  readonly deliveryUrl: string | null;
  readonly recipientEmail: string | null;
  readonly expiryDate: Date | null;
  readonly status: DeliveryStatus;
}

export interface FulfillmentStore {
  /* ---- context ---------------------------------------------------------- */
  loadContextByWorkItem(workItemId: string): Promise<FulfillmentContext | null>;
  loadContextByOrder(orderId: string): Promise<FulfillmentContext | null>;
  /**
   * The sealed account-password envelope from the order's quote snapshot.
   *
   * Kept off `FulfillmentContext` on purpose: the context is loaded on every
   * workspace read, and a ciphertext that rides along on every read is a
   * ciphertext that eventually ends up in a response body.
   */
  findServiceAccountPasswordEnvelope(orderId: string): Promise<string | null>;

  /* ---- checklist -------------------------------------------------------- */
  findChecklist(workItemId: string): Promise<ChecklistRecord | null>;
  ensureTemplate(input: {
    workItemType: WorkItemType;
    queueKey: QueueKey;
    definition: readonly ChecklistItemDefinition[];
  }): Promise<{ id: string }>;
  createChecklist(input: {
    workItemId: string;
    templateId: string;
    items: readonly (ChecklistItemDefinition & { status: ChecklistItemStatus; hasValue: boolean })[];
  }): Promise<ChecklistRecord>;
  updateChecklistItem(input: {
    itemId: string;
    type?: ChecklistItemType;
    status: ChecklistItemStatus;
    verifiedByStaffId?: string | null;
    verifiedAt?: Date | null;
    note?: string | null;
  }): Promise<void>;
  setChecklistItemValue(input: {
    itemId: string;
    value: unknown;
    status: ChecklistItemStatus;
    verifiedByStaffId: string;
    verifiedAt: Date;
  }): Promise<void>;
  updateChecklistStatus(input: {
    checklistId: string;
    status: ChecklistStatus;
    blockedReason: string | null;
    completedAt?: Date | null;
  }): Promise<void>;

  /* ---- fulfillment record ----------------------------------------------- */
  ensureFulfillment(input: {
    orderId: string;
    workItemId: string;
    supplierId?: string;
    idempotencyKey?: string;
  }): Promise<FulfillmentRecord>;
  findFulfillmentById(fulfillmentId: string): Promise<FulfillmentRecord | null>;
  updateSupplierCost(input: {
    fulfillmentId: string;
    actualSupplierCost: string;
    actualSupplierCurrency: string;
    supplierReference: string | null;
    costVarianceBps: number | null;
    fulfilledByStaffId: string;
  }): Promise<void>;
  /** Atomic: only records an approval when none exists yet. */
  approveCostVariance(input: {
    fulfillmentId: string;
    approvedByStaffId: string;
    approvedAt: Date;
  }): Promise<boolean>;
  markFulfillmentCompleted(fulfillmentId: string, at: Date): Promise<void>;

  /* ---- assets ------------------------------------------------------------ */
  findAssetsByOrder(orderId: string): Promise<readonly GiftCardAssetView[]>;
  findAssetView(assetId: string): Promise<GiftCardAssetView | null>;
  findAssetSecret(assetId: string): Promise<AssetSecretRecord | null>;
  createAsset(input: {
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
  }): Promise<GiftCardAssetView>;
  recordSecretAccess(assetId: string, at: Date): Promise<void>;
  /** Atomic compare-and-set into SENDING; false when another sender won. */
  beginSending(assetId: string, from: readonly DeliveryStatus[]): Promise<boolean>;
  markAssetSent(assetId: string, at: Date): Promise<void>;
  markAssetDeliveryFailed(assetId: string): Promise<void>;

  /* ---- delivery attempts -------------------------------------------------- */
  nextAttemptNumber(assetId: string): Promise<number>;
  createDeliveryAttempt(input: {
    assetId: string;
    orderId: string;
    recipientMasked: string;
    attemptNumber: number;
  }): Promise<{ id: string }>;
  completeDeliveryAttempt(input: {
    attemptId: string;
    status: DeliveryStatus;
    providerMessageId: string | null;
    errorCode: string | null;
    sentAt: Date | null;
  }): Promise<void>;

  /* ---- order ------------------------------------------------------------- */
  markOrderFulfilled(orderId: string, at: Date): Promise<void>;
}

/* ============================================================================
 * Roles
 * ==========================================================================*/

/** Roles allowed to approve a cost variance and to reopen a locked checklist. */
export const MANAGER_APPROVAL_ROLE_SET: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'ADMIN',
  'OPS_MANAGER',
  'MANAGEMENT',
]);
