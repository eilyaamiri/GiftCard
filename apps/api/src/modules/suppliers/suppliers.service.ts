import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { SupplierBalance, SupplierProvider, SupplierPurchaseResult } from '@barat/suppliers';
import { SUPPLIER_PROVIDERS } from '@barat/suppliers';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { WORK_ITEM_ESCALATOR, type WorkItemEscalator } from '../workitems/workitems.types';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { SUPPLIER_STORE } from './suppliers.types';
import type {
  AutoFulfillmentTarget,
  SupplierFundingState,
  SupplierFundingView,
  SupplierOfferView,
  SupplierPurchaseOutcome,
  SupplierPurchaseStatusView,
  SupplierStore,
  SupplierView,
} from './suppliers.types';

/**
 * Narrows a provider result to the fields that are safe to hand to an operator.
 *
 * Written as an explicit field-by-field construction rather than a spread-and-
 * delete: a spread would silently re-admit any new secret-bearing field a future
 * provider adapter adds to `SupplierPurchaseResult`.
 */
function toPurchaseStatusView(
  result: SupplierPurchaseResult,
  fallbackReference: string,
): SupplierPurchaseStatusView {
  return {
    status: result.status,
    providerReference: result.providerReference ?? fallbackReference,
    cost: result.cost === undefined ? null : { amount: result.cost.amount, currency: result.cost.currency },
    assetType: result.asset?.assetType ?? null,
    failureCode: result.failureCode ?? null,
  };
}

export const SUPPLIER_AUDIT_ACTIONS = {
  AVAILABILITY_CHECKED: 'SUPPLIER_AVAILABILITY_CHECKED',
  BALANCE_CHECKED: 'SUPPLIER_BALANCE_CHECKED',
  PURCHASE_SUCCEEDED: 'SUPPLIER_PURCHASE_SUCCEEDED',
  PURCHASE_PENDING: 'SUPPLIER_PURCHASE_PENDING',
  PURCHASE_FAILED: 'SUPPLIER_PURCHASE_FAILED',
  PURCHASE_UNKNOWN: 'SUPPLIER_PURCHASE_UNKNOWN',
} as const;

const UNKNOWN_OUTCOME_PREFIX = 'UNKNOWN_OUTCOME';
const PENDING_FOLLOWUP_PREFIX = 'SUPPLIER_PENDING';

function providerMap(providers: readonly SupplierProvider[]): ReadonlyMap<string, SupplierProvider> {
  return new Map(providers.map((provider) => [provider.key, provider]));
}

/**
 * Provider-neutral supplier orchestration.
 *
 * The domain calls only `SupplierProvider`; it never imports an SDK, a provider
 * payload type or a provider-specific method. Supplier selection is persisted as
 * `SupplierOffer`, so adding Reloadly/Runa/Tillo is data plus an adapter, not a
 * rewrite of order or fulfillment code.
 */
@Injectable()
export class SuppliersService {
  private readonly providersByKey: ReadonlyMap<string, SupplierProvider>;

  constructor(
    @Inject(SUPPLIER_STORE) private readonly store: SupplierStore,
    @Inject(SUPPLIER_PROVIDERS) providers: readonly SupplierProvider[],
    @Inject(WORK_ITEM_ESCALATOR) private readonly escalator: WorkItemEscalator,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.providersByKey = providerMap(providers);
  }

  async listSuppliers(): Promise<readonly SupplierView[]> {
    const rows = await this.store.listSuppliers();
    return rows.map((row) => ({ ...row, hasProvider: this.providersByKey.has(row.code) }));
  }

  async listOffers(skuId: string): Promise<readonly SupplierOfferView[]> {
    return this.store.findOffersForSku(skuId);
  }

  /** The purchase a work item stands for, re-read from the database. */
  async findAutoFulfillmentTarget(workItemId: string): Promise<AutoFulfillmentTarget | null> {
    return this.store.findAutoFulfillmentTarget(workItemId);
  }

  /** True when an adapter is registered for this supplier code. */
  hasProvider(supplierCode: string): boolean {
    return this.providersByKey.has(supplierCode);
  }

  /**
   * Selects the cheapest active offer, with `priority` as deterministic tie-breaker.
   * Availability is checked through the adapter before returning it.
   */
  async selectOffer(skuId: string): Promise<SupplierOfferView> {
    const offers = await this.store.findOffersForSku(skuId);
    if (offers.length === 0) {
      throw DomainErrors.notFound(`active supplier offer for SKU ${skuId}`);
    }

    for (const offer of offers) {
      const provider = this.providersByKey.get(offer.supplierCode);
      if (provider === undefined) {
        // Manual suppliers remain selectable: their offer is fulfilled by an
        // operator, not by an absent API adapter.
        if (offer.availability === 'AVAILABLE') {
          return offer;
        }
        continue;
      }

      const availability = await provider.checkAvailability(offer.providerSku);
      await this.store.recordAvailabilityCheck({
        offerId: offer.id,
        availability: availability.availability,
        checkedAt: availability.observedAt,
      });
      await this.audit.record({
        actor: 'system:supplier-selection',
        actorType: 'SYSTEM',
        action: SUPPLIER_AUDIT_ACTIONS.AVAILABILITY_CHECKED,
        entity: 'SupplierOffer',
        entityId: offer.id,
        after: {
          supplierId: offer.supplierId,
          supplierCode: offer.supplierCode,
          skuId,
          availability: availability.availability,
          checkedAt: availability.observedAt.toISOString(),
        },
      });

      if (availability.availability === 'AVAILABLE') {
        return offer;
      }
    }

    throw DomainErrors.conflict(
      'در حال حاضر تأمین‌کننده‌ای برای این محصول موجود نیست.',
      `no active available supplier offer for SKU ${skuId}`,
    );
  }

  /**
   * Asks the supplier whether we can still afford this offer, before buying.
   *
   * Three rules, all in the same direction — only a positive, comparable answer
   * unlocks a purchase:
   *
   *   - A supplier with no adapter, or an adapter that publishes no balance, is
   *     `NOT_APPLICABLE`. It is never read as "funded".
   *   - An unreachable venue is `UNKNOWN`, never `SUFFICIENT`. We do not know,
   *     and guessing costs a half-placed order.
   *   - A balance in a currency we cannot compare against the cost only passes
   *     when it is strictly positive, and says so via `currencyMismatch`. This
   *     module holds no FX rate for a supplier pair, and inventing one to
   *     compare money would be exactly the float arithmetic rule 2 forbids.
   */
  async checkFunding(input: {
    offerId: string;
    quantity: number;
  }): Promise<SupplierFundingView> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
      throw DomainErrors.validation([
        { path: 'quantity', message: 'quantity must be a positive integer' },
      ]);
    }

    const offer = await this.store.findOfferById(input.offerId);
    if (offer === null || !offer.isActive) {
      throw DomainErrors.notFound(`supplier offer ${input.offerId}`);
    }

    const required = {
      amount: new Decimal(offer.costAmount).times(input.quantity).toFixed(),
      currency: offer.costCurrency,
    };
    const base = { supplierCode: offer.supplierCode, required, currencyMismatch: false };

    const provider = this.providersByKey.get(offer.supplierCode);
    const readBalance = provider?.getBalance;
    if (provider === undefined || readBalance === undefined) {
      return { ...base, state: 'NOT_APPLICABLE', balance: null };
    }

    let balance: SupplierBalance;
    try {
      balance = await readBalance.call(provider);
    } catch {
      // The provider error may carry a credential or a raw body; it is dropped
      // rather than logged, and the state alone tells the caller to stand down.
      await this.recordFundingCheck({ ...base, state: 'UNKNOWN', balance: null });
      return { ...base, state: 'UNKNOWN', balance: null };
    }

    const observed = { amount: balance.amount, currency: balance.currency };
    const currencyMismatch = balance.currency !== offer.costCurrency;
    const held = new Decimal(balance.amount);
    const state: SupplierFundingState = currencyMismatch
      ? held.greaterThan(0)
        ? 'SUFFICIENT'
        : 'INSUFFICIENT'
      : held.greaterThanOrEqualTo(new Decimal(required.amount))
        ? 'SUFFICIENT'
        : 'INSUFFICIENT';

    const view: SupplierFundingView = { ...base, state, balance: observed, currencyMismatch };
    await this.recordFundingCheck(view);
    return view;
  }

  private async recordFundingCheck(view: SupplierFundingView): Promise<void> {
    await this.audit.record({
      actor: 'system:supplier-funding',
      actorType: 'SYSTEM',
      action: SUPPLIER_AUDIT_ACTIONS.BALANCE_CHECKED,
      entity: 'Supplier',
      entityId: view.supplierCode,
      after: {
        supplierCode: view.supplierCode,
        state: view.state,
        balanceAmount: view.balance?.amount ?? null,
        balanceCurrency: view.balance?.currency ?? null,
        requiredAmount: view.required.amount,
        requiredCurrency: view.required.currency,
        currencyMismatch: view.currencyMismatch,
        checkedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Purchase once using the caller's stable idempotency key.
   *
   * UNKNOWN is intentionally terminal for automation. We cannot know whether the
   * provider charged us, so retrying could buy a second card. It opens an
   * UNKNOWN_OUTCOME work item and returns; only a human can reconcile it.
   */
  async purchase(input: {
    orderId: string;
    customerId?: string | null;
    workItemId: string;
    offerId: string;
    quantity: number;
    idempotencyKey: string;
    recipientEmail?: string;
  }): Promise<SupplierPurchaseOutcome> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10) {
      throw DomainErrors.validation([{ path: 'quantity', message: 'quantity must be an integer between 1 and 10' }]);
    }

    const offer = await this.store.findOfferById(input.offerId);
    if (offer === null || !offer.isActive) {
      throw DomainErrors.notFound(`supplier offer ${input.offerId}`);
    }

    const provider = this.providersByKey.get(offer.supplierCode);
    if (provider === undefined) {
      throw DomainErrors.conflict(
        'این تأمین‌کننده اتصال خودکار ندارد و باید به‌صورت دستی پیگیری شود.',
        `no provider adapter registered for ${offer.supplierCode}`,
      );
    }

    let result: SupplierPurchaseResult;
    try {
      result = await provider.purchase({
        providerSku: offer.providerSku,
        quantity: input.quantity,
        idempotencyKey: input.idempotencyKey,
        ...(input.recipientEmail === undefined ? {} : { recipientEmail: input.recipientEmail }),
      });
    } catch {
      // Network ambiguity is UNKNOWN, not FAILED: the provider might have charged
      // us before the connection broke. Never auto-retry this branch.
      result = { status: 'UNKNOWN', failureCode: 'PROVIDER_CONNECTION_AMBIGUOUS' };
    }

    const common = {
      supplierId: offer.supplierId,
      supplierCode: offer.supplierCode,
      offerId: offer.id,
      providerReference: result.providerReference ?? null,
    };

    switch (result.status) {
      case 'SUCCEEDED': {
        if (result.asset === undefined) {
          throw DomainErrors.conflict(
            'پاسخ تأمین‌کننده دارایی تحویل نداشت و نیاز به بررسی دارد.',
            `supplier ${offer.supplierCode} reported SUCCEEDED without an asset`,
          );
        }

        /*
         * The provider response may hold a raw gift-card code. It is handed
         * straight to fulfillment, which encrypts it before it is persisted, and
         * it is deliberately NOT part of this method's return value: the code
         * must not travel back through the controller into an HTTP response.
         */
        const stored = await this.fulfillment.ingestAutomatedSupplierResult({
          workItemId: input.workItemId,
          actorId: `system:supplier:${offer.supplierCode}`,
          supplierId: offer.supplierId,
          supplierReference: result.providerReference ?? null,
          actualSupplierCost: result.cost?.amount ?? null,
          actualSupplierCurrency: result.cost?.currency ?? null,
          skuId: offer.skuId,
          idempotencyKey: input.idempotencyKey,
          asset: result.asset,
        });

        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_SUCCEEDED,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: {
            orderId: input.orderId,
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            providerReference: result.providerReference ?? null,
            status: result.status,
            assetId: stored.id,
            assetType: stored.assetType,
            maskedCode: stored.maskedCode,
            cost: result.cost ?? null,
          },
        });

        return {
          ...common,
          status: 'SUCCEEDED',
          cost: result.cost ?? null,
          assetId: stored.id,
          assetType: stored.assetType,
          maskedCode: stored.maskedCode,
        };
      }

      case 'PENDING': {
        const workItem = await this.escalator.openEscalation({
          code: `${PENDING_FOLLOWUP_PREFIX}:${input.orderId}:${input.idempotencyKey}`,
          orderId: input.orderId,
          customerId: input.customerId,
          type: 'SUPPLIER_FOLLOWUP',
          title: 'پیگیری نتیجهٔ خرید از تأمین‌کننده',
          description: 'خرید در وضعیت انتظار است؛ بدون خرید مجدد نتیجه را پیگیری کنید.',
          payload: {
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            offerId: offer.id,
            providerReference: result.providerReference ?? null,
          },
        });
        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_PENDING,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: { orderId: input.orderId, workItemId: workItem.id, providerReference: result.providerReference ?? null },
        });
        return { ...common, status: 'PENDING', workItemId: workItem.id };
      }

      case 'UNKNOWN': {
        const workItem = await this.escalator.openEscalation({
          code: `${UNKNOWN_OUTCOME_PREFIX}:${input.orderId}:${input.idempotencyKey}`,
          orderId: input.orderId,
          customerId: input.customerId,
          type: 'UNKNOWN_OUTCOME',
          title: 'نتیجهٔ نامشخص خرید از تأمین‌کننده',
          description: 'وضعیت پرداخت تأمین‌کننده نامشخص است؛ خرید مجدد ممنوع است.',
          payload: {
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            offerId: offer.id,
            providerReference: result.providerReference ?? null,
            purchaseIdempotencyKey: input.idempotencyKey,
          },
        });
        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_UNKNOWN,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: {
            orderId: input.orderId,
            workItemId: workItem.id,
            providerReference: result.providerReference ?? null,
            failureCode: result.failureCode ?? 'UNKNOWN',
            autoRetry: false,
          },
        });
        return {
          ...common,
          status: 'UNKNOWN',
          workItemId: workItem.id,
          failureCode: result.failureCode ?? null,
        };
      }

      case 'FAILED': {
        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_FAILED,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: {
            orderId: input.orderId,
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            providerReference: result.providerReference ?? null,
            failureCode: result.failureCode ?? 'SUPPLIER_FAILED',
          },
        });
        return {
          ...common,
          status: 'FAILED',
          failureCode: result.failureCode ?? 'SUPPLIER_FAILED',
        };
      }
      default: {
        const exhaustive: never = result.status;
        throw DomainErrors.conflict('نتیجهٔ تأمین‌کننده قابل شناسایی نیست.', `unknown purchase status ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Explicit human reconciliation for a pending / unknown purchase. This method
   * only asks the provider for status; it never calls `purchase`, which preserves
   * the no-auto-retry invariant.
   *
   * The provider's answer is projected onto `SupplierPurchaseStatusView` and NOT
   * returned raw. A `SupplierPurchaseResult` may legitimately carry `asset`, and
   * for Tillo that asset holds a plaintext code and PIN. Returning the provider
   * object verbatim would publish that code in the HTTP response of an operator
   * endpoint, with no `GIFT_CARD_CODE_VIEWED` audit event — the exact leak the
   * encryption-at-rest design exists to prevent. Only the asset's *type* crosses
   * this boundary; the secret itself reaches persistence solely via
   * `ingestAutomatedSupplierResult`, which encrypts it on the way in.
   */
  async checkPurchaseStatus(input: {
    providerCode: string;
    providerReference: string;
  }): Promise<SupplierPurchaseStatusView> {
    const provider = this.providersByKey.get(input.providerCode);
    if (provider === undefined) {
      throw DomainErrors.notFound(`supplier provider ${input.providerCode}`);
    }

    let result: SupplierPurchaseResult;
    try {
      result = await provider.getPurchaseStatus(input.providerReference);
    } catch {
      result = {
        status: 'UNKNOWN',
        providerReference: input.providerReference,
        failureCode: 'STATUS_CHECK_FAILED',
      };
    }

    return toPurchaseStatusView(result, input.providerReference);
  }
}
