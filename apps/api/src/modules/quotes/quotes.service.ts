import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Decimal from 'decimal.js';
/**
 * Type-only. `@barat/database` constructs the shared PrismaClient at import
 * time, so a VALUE import here would make this service — and every unit test
 * that touches it — require a live `DATABASE_URL`. The database arrives through
 * the `QUOTES_DATABASE` port instead.
 */
import type { Prisma } from '@barat/database';
/** The enum is declared once, in the frozen contracts package, not by the ORM. */
import { QuoteStatus } from '@barat/contracts';
import type {
  AcceptQuoteRequest,
  AcceptQuoteResponse,
  CreateQuoteRequest,
  CreateQuoteResponse,
  FxRateSnapshot,
  GetQuoteResponse,
  QuoteSnapshot,
} from '@barat/contracts';

import { AppConfigService } from '../../common/config/app-config.service';
import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { CatalogService, type SkuQuoteTarget } from '../catalog/catalog.service';
import { PricingRuleService, toEnginePricingRule } from '../pricing/pricing-rule.service';
import type { PricingRule } from '../pricing/pricing.types';
import {
  QUOTES_DATABASE,
  QUOTE_FX_AGGREGATOR,
  QUOTE_PRICING_SERVICE,
  type QuoteFxAggregator,
  type QuotePricingService,
  type QuotesDatabase,
  ruleSnapshot,
} from './quote.ports';
import {
  toAudienceBreakdown,
  toAudienceFxSnapshot,
  toQuoteSnapshotDto,
  type QuoteRow,
  secondsRemaining,
} from './quote-presentation';
import {
  RESERVED_SERVICE_FIELD_KEYS,
  buildServiceAccountSnapshot,
  validateServiceAccountFields,
  withoutReservedKeys,
  type ServiceAccountSnapshot,
} from './service-account-fields';

export interface QuoteActor {
  readonly customerId?: string | null;
  readonly commerceSessionId?: string | null;
}

type QuoteWithComponents = Prisma.QuoteGetPayload<{ include: { components: true } }>;
type DatabaseRule = Awaited<ReturnType<PricingRuleService['list']>>[number];
type QuoteTarget =
  | { readonly kind: 'sku'; readonly id: string; readonly sku: SkuQuoteTarget }
  | {
      readonly kind: 'service';
      readonly id: string;
      readonly service: Awaited<ReturnType<CatalogService['getServiceForQuote']>>;
    };

const COMPONENT_INCLUDE = { components: { orderBy: { sortOrder: 'asc' as const } } } as const;
const QUOTE_ID_RANDOM_BYTES = 16;
const QUOTE_NUMBER_RANDOM_BYTES = 8;

export const QUOTE_CREATED = 'QUOTE_CREATED';
export const QUOTE_ACCEPTED = 'QUOTE_ACCEPTED';
export const QUOTE_AMOUNT_MISMATCH = 'QUOTE_AMOUNT_MISMATCH';

/**
 * Quote orchestration. The pricing engine remains pure; this service only
 * resolves immutable inputs, obtains the FX snapshot and persists the result.
 * No endpoint in this class ever re-prices an existing quote.
 */
@Injectable()
export class QuotesService {
  constructor(
    @Inject(QUOTES_DATABASE) private readonly db: QuotesDatabase,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(PricingRuleService) private readonly pricingRules: PricingRuleService,
    @Inject(QUOTE_PRICING_SERVICE) private readonly pricing: QuotePricingService,
    @Inject(QUOTE_FX_AGGREGATOR) private readonly fx: QuoteFxAggregator,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async createQuote(
    input: CreateQuoteRequest,
    actor: QuoteActor = {},
  ): Promise<CreateQuoteResponse> {
    if (actor.customerId == null && actor.commerceSessionId == null) {
      /* Without an owner the quote could be read back by anyone who guessed its
       * id, so the caller must present either a login or a session token. */
      throw DomainErrors.validation([
        {
          path: 'commerceSessionToken',
          message: 'A session token is required for anonymous quotes',
        },
      ]);
    }
    if (input.discountCode !== undefined) {
      /* There is no Discount/Coupon aggregate in the frozen schema. Silently
       * accepting a code would produce a quote whose discount cannot be audited. */
      throw DomainErrors.validation([
        { path: 'discountCode', message: 'Discount codes are not available' },
      ]);
    }

    const target = await this.resolveTarget(input);
    const ruleRecord = await this.selectRule(target);
    if (!ruleRecord) {
      throw DomainErrors.conflict(
        'در حال حاضر امکان قیمت‌گذاری این خدمت وجود ندارد.',
        'No active pricing rule matched the requested target',
      );
    }

    const fx = await this.fx.getRateSnapshot('USD_IRR');
    if (fx.isStale) {
      throw DomainErrors.fxRateStale(fx.ageSeconds);
    }

    const quantity = input.quantity ?? 1;
    const supplierCostUsd =
      target.kind === 'sku' ? target.sku.effectiveCost : input.requestedAmountForeign;
    if (!supplierCostUsd) {
      throw DomainErrors.validation([
        { path: 'requestedAmountForeign', message: 'A foreign amount is required' },
      ]);
    }
    if (target.kind === 'sku' && target.sku.costCurrency !== 'USD') {
      throw DomainErrors.conflict(
        'این محصول در حال حاضر قابل قیمت‌گذاری نیست.',
        'Only USD supplier costs are supported by the USD_IRR pricing pair',
      );
    }
    if (target.kind === 'service' && target.service.currency !== 'USD') {
      throw DomainErrors.conflict(
        'این خدمت در حال حاضر قابل قیمت‌گذاری نیست.',
        'Only USD international services are supported by the USD_IRR pricing pair',
      );
    }

    const rule = toEnginePricingRule(ruleRecord);
    const breakdown = this.pricing.computeQuote(
      { supplierCostUsd: new Decimal(supplierCostUsd), quantity },
      rule,
      fx,
    );
    const wireBreakdown = this.pricing.toWirePricingBreakdown(breakdown);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + rule.quoteTtlSeconds * 1_000);
    const quoteId = makeQuoteId();
    const quoteNumber = makeQuoteNumber(now);
    const foreignAmount = customerForeignAmount(target, input, quantity);
    const serviceAccount =
      target.kind === 'service' ? this.sealServiceAccount(input.serviceFields ?? {}) : null;
    const snapshot = makeSnapshot({
      quoteId,
      quoteNumber,
      actor,
      input,
      target,
      rule,
      fx,
      wireBreakdown,
      foreignAmount,
      serviceAccount,
      now,
      expiresAt,
    });

    const quote = await this.db.$transaction(async (tx) => {
      const created = await tx.quote.create({
        data: {
          id: quoteId,
          quoteNumber,
          customerId: actor.customerId ?? null,
          commerceSessionId: actor.commerceSessionId ?? null,
          cartId: input.cartId ?? null,
          skuId: target.kind === 'sku' ? target.id : null,
          serviceId: target.kind === 'service' ? target.id : null,
          supplierOfferId: target.kind === 'sku' ? target.sku.offerId : null,
          quantity,
          currency: input.currency ?? 'USD',
          pricingRuleId: rule.id,
          pricingVersion: rule.version,
          marketFxRate: wireBreakdown.marketFxRate,
          effectiveFxRate: wireBreakdown.effectiveFxRate,
          fxProvider: fx.provider,
          fxRateId: fx.id,
          fxRateTimestamp: new Date(fx.receivedAt),
          fxSpreadAmount: BigInt(wireBreakdown.fxSpreadAmount),
          fxRiskBufferAmount: BigInt(wireBreakdown.fxRiskBufferAmount),
          supplierCostUsd: databaseDecimalString(wireBreakdown.supplierCostForeign),
          supplierCostIrr: BigInt(wireBreakdown.supplierCostIrr),
          paymentFee: BigInt(wireBreakdown.paymentFee),
          serviceFee: BigInt(wireBreakdown.serviceFee),
          operationalFee: BigInt(wireBreakdown.operationalFee),
          marginAmount: BigInt(wireBreakdown.marginAmount),
          discountAmount: BigInt(wireBreakdown.discountAmount),
          subtotal: BigInt(wireBreakdown.subtotal),
          finalAmountIrr: BigInt(wireBreakdown.finalAmountIrr),
          displayAmountToman: BigInt(wireBreakdown.displayAmountToman),
          status: QuoteStatus.ACTIVE,
          expiresAt,
          snapshot: snapshot as Prisma.InputJsonValue,
        },
      });
      await tx.quoteComponent.createMany({
        data: wireBreakdown.components.map((component) => ({
          quoteId: created.id,
          kind: component.kind,
          label: component.label,
          labelFa: component.labelFa,
          amountIrr: BigInt(component.amountIrr),
          amountForeign: component.amountForeign,
          currency: component.currency,
          bps: component.bps,
          sortOrder: component.sortOrder,
        })),
      });
      return tx.quote.findUniqueOrThrow({ where: { id: created.id }, include: COMPONENT_INCLUDE });
    });

    /* The full internal calculation is recorded once, here. `snapshot` on the
     * row is the legal artefact; this row is the "who asked for it, when". */
    await this.audit.record({
      actor: actor.customerId ?? actor.commerceSessionId ?? 'anonymous',
      actorType: actor.customerId ? 'CUSTOMER' : 'ANONYMOUS',
      action: QUOTE_CREATED,
      entity: 'Quote',
      entityId: quote.id,
      after: {
        quoteNumber: quote.quoteNumber,
        skuId: quote.skuId,
        serviceId: quote.serviceId,
        supplierOfferId: quote.supplierOfferId,
        quantity: quote.quantity,
        pricingRuleId: quote.pricingRuleId,
        pricingVersion: quote.pricingVersion,
        effectiveFxRate: wireBreakdown.effectiveFxRate,
        finalAmountIrr: quote.finalAmountIrr.toString(),
        expiresAt: expiresAt.toISOString(),
      },
    });

    const publicQuote = this.toPublicSnapshot(quote, now);
    return {
      quote: publicQuote,
      breakdown: toAudienceBreakdown(
        wireBreakdown,
        'CUSTOMER',
        foreignAmount,
        input.currency ?? 'USD',
      ),
      fx: toAudienceFxSnapshot(fx, 'CUSTOMER', wireBreakdown.effectiveFxRate),
    };
  }

  async getQuote(id: string, actor: QuoteActor = {}): Promise<GetQuoteResponse> {
    const quote = await this.db.quote.findUnique({ where: { id }, include: COMPONENT_INCLUDE });
    if (!quote || !ownsQuote(quote, actor)) {
      /* Not "forbidden": telling a stranger that a quote id exists is already
       * more than they should learn. */
      throw DomainErrors.notFound('quote');
    }
    return { quote: this.toPublicSnapshot(quote) };
  }

  /**
   * Resolve (or open) the anonymous commerce session a quote is attached to.
   *
   * Anonymous quoting is a product requirement — the price is shown before
   * login — but a quote with no owner at all could be read by anybody who
   * guessed its id, so every quote is bound to a customer or to a session token.
   */
  async resolveCommerceSession(
    token: string | undefined,
    customerId: string | null,
    metadata: { readonly ip?: string | null; readonly userAgent?: string | null } = {},
  ): Promise<string | null> {
    if (token === undefined) {
      return null;
    }
    const now = new Date();
    const session = await this.db.commerceSession.upsert({
      where: { sessionToken: token },
      create: {
        sessionToken: token,
        customerId,
        ip: metadata.ip ?? null,
        userAgent: metadata.userAgent ?? null,
      },
      update: {
        lastSeenAt: now,
        ...(customerId === null ? {} : { customerId }),
      },
      select: { id: true },
    });
    return session.id;
  }

  /**
   * Atomically changes ACTIVE -> ACCEPTED while storing the key on that same
   * row. The unique key is the database-level idempotency fence; the conditional
   * update is the state/expiry fence.
   */
  async acceptQuote(
    input: AcceptQuoteRequest,
    actor: QuoteActor = {},
  ): Promise<AcceptQuoteResponse> {
    const existingByKey = await this.db.quote.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: COMPONENT_INCLUDE,
    });
    if (existingByKey) {
      return this.replayAcceptance(existingByKey, input, actor);
    }

    const now = new Date();
    try {
      const result = await this.db.$transaction(async (tx) => {
        const current = await tx.quote.findUnique({
          where: { id: input.quoteId },
          include: COMPONENT_INCLUDE,
        });
        if (!current || !ownsQuote(current, actor)) {
          throw DomainErrors.notFound('quote');
        }
        await this.assertAcknowledgedAmount(current, input.acknowledgedAmountIrr, actor);

        if (current.status === QuoteStatus.ACCEPTED) {
          throw DomainErrors.conflict(
            'این پیش‌فاکتور قبلاً پذیرفته شده است.',
            'Quote accepted with a different idempotency key',
          );
        }
        if (current.status !== QuoteStatus.ACTIVE || current.expiresAt <= now) {
          if (current.status === QuoteStatus.ACTIVE && current.expiresAt <= now) {
            await tx.quote.updateMany({
              where: { id: current.id, status: QuoteStatus.ACTIVE },
              data: { status: QuoteStatus.EXPIRED },
            });
          }
          return { quote: current, expired: true, performed: false } as const;
        }

        const updated = await tx.quote.updateMany({
          where: {
            id: current.id,
            status: QuoteStatus.ACTIVE,
            expiresAt: { gt: now },
            idempotencyKey: null,
          },
          data: {
            status: QuoteStatus.ACCEPTED,
            acceptedAt: now,
            idempotencyKey: input.idempotencyKey,
          },
        });
        if (updated.count !== 1) {
          const winner = await tx.quote.findUnique({
            where: { id: current.id },
            include: COMPONENT_INCLUDE,
          });
          if (
            winner?.status === QuoteStatus.ACCEPTED &&
            winner.idempotencyKey === input.idempotencyKey
          ) {
            return { quote: winner, expired: false, performed: false } as const;
          }
          throw DomainErrors.conflict(
            'پذیرش پیش‌فاکتور هم‌زمان تغییر کرد.',
            'Quote acceptance race',
          );
        }
        const accepted = await tx.quote.findUniqueOrThrow({
          where: { id: current.id },
          include: COMPONENT_INCLUDE,
        });
        return { quote: accepted, expired: false, performed: true } as const;
      });

      if (result.expired) {
        throw DomainErrors.quoteExpired();
      }
      if (result.performed) {
        await this.audit.record({
          actor: actor.customerId ?? actor.commerceSessionId ?? 'anonymous',
          actorType: actor.customerId ? 'CUSTOMER' : 'ANONYMOUS',
          action: QUOTE_ACCEPTED,
          entity: 'Quote',
          entityId: result.quote.id,
          before: { status: QuoteStatus.ACTIVE },
          after: {
            status: QuoteStatus.ACCEPTED,
            finalAmountIrr: result.quote.finalAmountIrr.toString(),
            acceptedAt: now.toISOString(),
          },
        });
      }
      return {
        quote: this.toPublicSnapshot(result.quote, now),
        accepted: result.performed,
        requoteRequired: false,
      };
    } catch (error: unknown) {
      if (!isUniqueConstraint(error)) {
        throw error;
      }
      /* A concurrent request may have won the unique idempotency race. Read
       * the committed row and return exactly the same result for a replay. */
      const winner = await this.db.quote.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: COMPONENT_INCLUDE,
      });
      if (!winner) {
        throw DomainErrors.idempotencyConflict('Quote acceptance key collision');
      }
      return this.replayAcceptance(winner, input, actor);
    }
  }

  /** Safe for a scheduler and safe to run concurrently with acceptance. */
  async expireQuotes(now = new Date()): Promise<number> {
    const result = await this.db.quote.updateMany({
      where: { status: QuoteStatus.ACTIVE, expiresAt: { lte: now } },
      data: { status: QuoteStatus.EXPIRED },
    });
    return result.count;
  }

  private async replayAcceptance(
    quote: QuoteWithComponents,
    input: AcceptQuoteRequest,
    actor: QuoteActor,
  ): Promise<AcceptQuoteResponse> {
    if (quote.id !== input.quoteId) {
      throw DomainErrors.idempotencyConflict(
        'Quote acceptance key is already used for another quote',
      );
    }
    if (!ownsQuote(quote, actor)) {
      throw DomainErrors.idempotencyConflict('Quote acceptance key belongs to another caller');
    }
    await this.assertAcknowledgedAmount(quote, input.acknowledgedAmountIrr, actor);
    if (quote.status !== QuoteStatus.ACCEPTED) {
      if (quote.status === QuoteStatus.EXPIRED) {
        throw DomainErrors.quoteExpired();
      }
      throw DomainErrors.conflict(
        'این پیش‌فاکتور قابل پذیرش نیست.',
        `Idempotency key points to ${quote.status}`,
      );
    }
    return {
      quote: this.toPublicSnapshot(quote),
      accepted: false,
      requoteRequired: false,
    };
  }

  /**
   * A disagreement between the amount the customer confirmed and the immutable
   * quote is a security event, not a validation slip (AGENTS.md rule 11): it is
   * audited before the flow is halted, and the amount is never "corrected".
   */
  private async assertAcknowledgedAmount(
    quote: { readonly id: string; readonly finalAmountIrr: bigint },
    acknowledged: string,
    actor: QuoteActor,
  ): Promise<void> {
    if (BigInt(acknowledged) === quote.finalAmountIrr) {
      return;
    }
    await this.audit.record({
      actor: actor.customerId ?? actor.commerceSessionId ?? 'anonymous',
      actorType: actor.customerId ? 'CUSTOMER' : 'ANONYMOUS',
      action: QUOTE_AMOUNT_MISMATCH,
      entity: 'Quote',
      entityId: quote.id,
      before: { finalAmountIrr: quote.finalAmountIrr.toString() },
      after: { acknowledgedAmountIrr: acknowledged },
    });
    throw DomainErrors.amountMismatch('Acknowledged amount differs from the immutable quote');
  }

  private toPublicSnapshot(quote: QuoteWithComponents, now = new Date()): QuoteSnapshot {
    return toQuoteSnapshotDto(quote as unknown as QuoteRow, 'CUSTOMER', now);
  }

  private async resolveTarget(input: CreateQuoteRequest): Promise<QuoteTarget> {
    if (input.skuId) {
      const sku = await this.catalog.getSkuQuoteTarget(input.skuId, input.currency ?? 'USD');
      const quantity = input.quantity ?? 1;
      if (quantity < sku.sku.minQuantity || quantity > sku.sku.maxQuantity) {
        throw DomainErrors.validation([
          { path: 'quantity', message: 'Quantity is outside SKU limits' },
        ]);
      }
      if (input.currency !== undefined && input.currency !== sku.sku.currency) {
        throw DomainErrors.validation([
          { path: 'currency', message: 'Currency does not match the SKU currency' },
        ]);
      }
      return { kind: 'sku', id: sku.sku.id, sku };
    }
    if (!input.serviceId) {
      throw DomainErrors.validation([
        { path: 'serviceId', message: 'A product or service is required' },
      ]);
    }

    const service = await this.catalog.getServiceForQuote(input.serviceId);
    validateServiceFields(service.fields, input.serviceFields ?? {});
    if (!input.requestedAmountForeign) {
      throw DomainErrors.validation([
        { path: 'requestedAmountForeign', message: 'A foreign amount is required' },
      ]);
    }
    const amount = new Decimal(input.requestedAmountForeign);
    if (service.minAmount && amount.lt(service.minAmount.toString())) {
      throw DomainErrors.validation([
        { path: 'requestedAmountForeign', message: 'Amount is below the service minimum' },
      ]);
    }
    if (service.maxAmount && amount.gt(service.maxAmount.toString())) {
      throw DomainErrors.validation([
        { path: 'requestedAmountForeign', message: 'Amount exceeds the service maximum' },
      ]);
    }
    if (input.currency !== undefined && input.currency !== service.currency) {
      throw DomainErrors.validation([
        { path: 'currency', message: 'Currency does not match the service currency' },
      ]);
    }
    return { kind: 'service', id: service.id, service };
  }

  /**
   * Turns the reserved account fields into the block that goes in the snapshot.
   *
   * The plaintext password exists only inside this call: it arrives in `values`,
   * is sealed, and the envelope is what the caller gets back. The key is zeroed
   * on the way out whether or not sealing succeeded.
   */
  private sealServiceAccount(values: Readonly<Record<string, string>>): ServiceAccountSnapshot {
    const key = this.config.bankDetailsEncryptionKey();
    try {
      return buildServiceAccountSnapshot(values, key);
    } finally {
      key.fill(0);
    }
  }

  private async selectRule(target: QuoteTarget): Promise<DatabaseRule | null> {
    const rules = await this.pricingRules.list();
    const candidates =
      target.kind === 'sku'
        ? ([
            ['SKU', target.id],
            ['PRODUCT', target.sku.sku.productId],
            ['GLOBAL', null],
          ] as const)
        : ([
            ['SERVICE', target.id],
            ['GLOBAL', null],
          ] as const);
    for (const [scope, targetId] of candidates) {
      const matched = rules.find((rule) => rule.scope === scope && rule.targetId === targetId);
      if (matched) return matched;
    }
    return null;
  }
}

/**
 * Ownership for a quote that may have been created before login.
 *
 * A logged-in customer owns their own quotes; an anonymous caller owns only the
 * quotes bound to the commerce session they presented. A quote that is bound to
 * a customer is never readable through a session token alone.
 */
function ownsQuote(
  quote: { readonly customerId: string | null; readonly commerceSessionId: string | null },
  actor: QuoteActor,
): boolean {
  if (actor.customerId != null && quote.customerId === actor.customerId) {
    return true;
  }
  return (
    quote.customerId === null &&
    actor.commerceSessionId != null &&
    quote.commerceSessionId === actor.commerceSessionId
  );
}

function makeQuoteId(): string {
  return `quote_${randomBytes(QUOTE_ID_RANDOM_BYTES).toString('hex')}`;
}

function makeQuoteNumber(now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = randomBytes(QUOTE_NUMBER_RANDOM_BYTES).toString('hex').toUpperCase();
  return `BQ-${day}-${suffix}`;
}

function customerForeignAmount(
  target: QuoteTarget,
  input: CreateQuoteRequest,
  quantity: number,
): string {
  if (target.kind === 'service') {
    const amount = input.requestedAmountForeign;
    if (amount === undefined) {
      throw DomainErrors.validation([
        { path: 'requestedAmountForeign', message: 'A foreign amount is required' },
      ]);
    }
    return amount;
  }
  return new Decimal(target.sku.sku.faceValue.toString())
    .mul(quantity.toString())
    .toFixed(Math.min(6, new Decimal(target.sku.sku.faceValue.toString()).decimalPlaces()));
}

function makeSnapshot(params: {
  readonly quoteId: string;
  readonly quoteNumber: string;
  readonly actor: QuoteActor;
  readonly input: CreateQuoteRequest;
  readonly target: QuoteTarget;
  readonly rule: PricingRule;
  readonly fx: FxRateSnapshot;
  readonly wireBreakdown: ReturnType<QuotePricingService['toWirePricingBreakdown']>;
  readonly foreignAmount: string;
  /** Sealed already: this function never sees a plaintext credential. */
  readonly serviceAccount: ServiceAccountSnapshot | null;
  readonly now: Date;
  readonly expiresAt: Date;
}): Prisma.InputJsonObject {
  const {
    quoteId,
    quoteNumber,
    actor,
    input,
    target,
    rule,
    fx,
    wireBreakdown,
    foreignAmount,
    serviceAccount,
    now,
    expiresAt,
  } = params;
  /* The reserved keys live in `serviceAccount`, never in `serviceFields`, so a
   * consumer that renders the configured fields cannot render a password. */
  const configuredFields =
    input.serviceFields === undefined ? undefined : withoutReservedKeys(input.serviceFields);
  return {
    id: quoteId,
    quoteNumber,
    customerId: actor.customerId ?? null,
    commerceSessionId: actor.commerceSessionId ?? null,
    cartId: input.cartId ?? null,
    skuId: target.kind === 'sku' ? target.id : null,
    serviceId: target.kind === 'service' ? target.id : null,
    target: quoteTargetSnapshot(target),
    supplierOfferId: target.kind === 'sku' ? target.sku.offerId : null,
    quantity: input.quantity ?? 1,
    currency: input.currency ?? 'USD',
    pricingRuleId: rule.id,
    pricingVersion: rule.version,
    rule: ruleSnapshot(rule) as unknown as Prisma.InputJsonObject,
    fx: fx as unknown as Prisma.InputJsonObject,
    marketFxRate: databaseDecimalString(wireBreakdown.marketFxRate),
    effectiveFxRate: databaseDecimalString(wireBreakdown.effectiveFxRate),
    fxProvider: fx.provider,
    fxRateId: fx.id,
    fxRateTimestamp: fx.receivedAt,
    fxSpreadAmount: wireBreakdown.fxSpreadAmount,
    fxRiskBufferAmount: wireBreakdown.fxRiskBufferAmount,
    supplierCostUsd: databaseDecimalString(wireBreakdown.supplierCostForeign),
    supplierCostIrr: wireBreakdown.supplierCostIrr,
    paymentFee: wireBreakdown.paymentFee,
    serviceFee: wireBreakdown.serviceFee,
    operationalFee: wireBreakdown.operationalFee,
    marginAmount: wireBreakdown.marginAmount,
    discountAmount: wireBreakdown.discountAmount,
    subtotal: wireBreakdown.subtotal,
    finalAmountIrr: wireBreakdown.finalAmountIrr,
    displayAmountToman: wireBreakdown.displayAmountToman,
    status: 'ACTIVE',
    expiresAt: expiresAt.toISOString(),
    remainingSeconds: secondsRemaining(expiresAt, now),
    acceptedAt: null,
    cancelledAt: null,
    createdAt: now.toISOString(),
    components: wireBreakdown.components as unknown as Prisma.InputJsonArray,
    customerForeignAmount: foreignAmount,
    ...(configuredFields === undefined
      ? {}
      : { serviceFields: configuredFields as Prisma.InputJsonObject }),
    ...(serviceAccount === null
      ? {}
      : { serviceAccount: serviceAccount as unknown as Prisma.InputJsonObject }),
  };
}

/** Product/service and supplier values by value, never mutable references only. */
function quoteTargetSnapshot(target: QuoteTarget): Prisma.InputJsonObject {
  if (target.kind === 'sku') {
    const sku = target.sku.sku;
    return {
      kind: 'SKU',
      sku: {
        id: sku.id,
        productId: sku.productId,
        code: sku.code,
        region: sku.region,
        currency: sku.currency,
        faceValue: databaseDecimalString(sku.faceValue.toString()),
        denominationLabel: sku.denominationLabel,
        deliveryAssetType: sku.deliveryAssetType,
      },
      supplierOffer: {
        id: target.sku.offerId,
        supplierId: target.sku.supplierId,
        costCurrency: target.sku.costCurrency,
        listedCost: databaseDecimalString(target.sku.listedCost),
        discountBps: target.sku.discountBps,
        effectiveCost: databaseDecimalString(target.sku.effectiveCost),
      },
    };
  }

  const service = target.service;
  return {
    kind: 'SERVICE',
    service: {
      id: service.id,
      slug: service.slug,
      name: service.name,
      nameFa: service.nameFa,
      category: service.category,
      currency: service.currency,
      minAmount:
        service.minAmount === null ? null : databaseDecimalString(service.minAmount.toString()),
      maxAmount:
        service.maxAmount === null ? null : databaseDecimalString(service.maxAmount.toString()),
      requiresManualReview: service.requiresManualReview,
      fields: service.fields.map((field) => ({
        key: field.key,
        label: field.label,
        labelFa: field.labelFa,
        fieldType: field.fieldType,
        isRequired: field.isRequired,
        validationRegex: field.validationRegex,
        helpTextFa: field.helpTextFa,
        options: field.options,
        sortOrder: field.sortOrder,
      })) as Prisma.InputJsonArray,
    },
  };
}

/** Canonical representation of a value persisted in Decimal(18,6). */
function databaseDecimalString(value: string): string {
  return new Decimal(value).toFixed(6);
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'P2002'
  );
}

function validateServiceFields(
  definitions: ReadonlyArray<{
    readonly key: string;
    readonly isRequired: boolean;
    readonly validationRegex: string | null;
    readonly fieldType: string;
    readonly options: Prisma.JsonValue | null;
  }>,
  values: Readonly<Record<string, string>>,
): void {
  const known = new Set(definitions.map((field) => field.key));
  const details: Array<{ path: string; message: string }> = [];
  for (const key of Object.keys(values)) {
    /* The reserved account keys are accepted on every international service and
     * are validated by their own rules below, not by a definition row. */
    if (!known.has(key) && !RESERVED_SERVICE_FIELD_KEYS.has(key))
      details.push({ path: `serviceFields.${key}`, message: 'Unknown service field' });
  }
  details.push(...validateServiceAccountFields(values));
  for (const field of definitions) {
    const value = values[field.key];
    if (value === undefined || value.trim() === '') {
      if (field.isRequired)
        details.push({ path: `serviceFields.${field.key}`, message: 'This field is required' });
      continue;
    }
    if (field.validationRegex !== null) {
      let regex: RegExp;
      try {
        regex = new RegExp(field.validationRegex, 'u');
      } catch {
        throw DomainErrors.conflict(
          'این خدمت در حال حاضر قابل استفاده نیست.',
          `Invalid validation regex configured for service field ${field.key}`,
        );
      }
      if (!regex.test(value))
        details.push({ path: `serviceFields.${field.key}`, message: 'Invalid field format' });
    }
    if (field.fieldType === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
      details.push({ path: `serviceFields.${field.key}`, message: 'Invalid email address' });
    }
    if (field.fieldType === 'URL') {
      try {
        new URL(value);
      } catch {
        details.push({ path: `serviceFields.${field.key}`, message: 'Invalid URL' });
      }
    }
    if (field.fieldType === 'NUMBER' && !/^[-+]?\d+(?:\.\d+)?$/u.test(value)) {
      details.push({ path: `serviceFields.${field.key}`, message: 'Invalid number' });
    }
    if (field.fieldType === 'SELECT' && !optionValues(field.options).has(value)) {
      details.push({ path: `serviceFields.${field.key}`, message: 'Invalid option' });
    }
  }
  if (details.length > 0) throw DomainErrors.validation(details);
}

function optionValues(value: Prisma.JsonValue | null): ReadonlySet<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const candidate = (entry as Record<string, Prisma.JsonValue>)['value'];
      return typeof candidate === 'string' ? [candidate] : [];
    }),
  );
}
