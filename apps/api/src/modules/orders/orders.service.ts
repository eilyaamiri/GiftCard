import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  GetOrderResponse,
  IrrString,
  ListOrdersResponse,
  OrderDeliveryDto,
  OrderDetailDto,
  OrderStatus,
  OrderSummaryDto,
} from '@barat/contracts';
import { ORDER_STATUS_VALUES } from '@barat/contracts';
import type { Prisma } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { maskEmail } from '../identity/identity.utils';
import { ORDER_STATUS_CHANGED, OrderStateMachine, type OrderActor } from './order-state-machine';
import type { AdminListOrdersQuery, ListOrdersQuery } from './orders.schemas';
import {
  ORDERS_DATABASE,
  type OrderPaymentBridge,
  type OrdersDatabase,
  type OrderTransitionResult,
} from './orders.tokens';

/* ============================================================================
 * Projections
 *
 * `giftCardAsset` is selected field by field on purpose: the model also carries
 * `encryptedCode` / `encryptedPin`, and an `include` would pull them into a
 * response object where a stray `JSON.stringify` could leak them (AGENTS.md
 * rule 10 and data rule 5). Only the masked, display-safe columns are listed.
 * ==========================================================================*/

const ORDER_INCLUDE = {
  quote: {
    select: {
      id: true,
      skuId: true,
      serviceId: true,
      quantity: true,
      finalAmountIrr: true,
      sku: {
        select: {
          denominationLabel: true,
          region: true,
          product: { select: { titleFa: true } },
        },
      },
      service: { select: { nameFa: true } },
    },
  },
  giftCardAssets: {
    select: {
      assetType: true,
      status: true,
      maskedCode: true,
      deliveryUrl: true,
      recipientEmail: true,
      expiryDate: true,
      sentAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/** Customer identity taken from the verified session, never from the payload. */
export interface OrderCustomerActor {
  readonly customerId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

/** How many times we retry when two orders race for the same order number. */
const ORDER_NUMBER_ATTEMPTS = 5;

const POST_PAYMENT_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'PAID',
  'FULFILLMENT_PENDING',
  'FULFILLING',
  'FULFILLED',
  'REFUND_PENDING',
  'REFUNDED',
]);

@Injectable()
export class OrdersService implements OrderPaymentBridge {
  constructor(
    @Inject(ORDERS_DATABASE) private readonly db: OrdersDatabase,
    @Inject(OrderStateMachine) private readonly stateMachine: OrderStateMachine,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /* ================================================================ create */

  /**
   * Create an order from an ACCEPTED quote.
   *
   * The total is COPIED from the quote and then asserted against it — the
   * client's `acknowledgedAmountIrr` is only ever used as a comparison, never
   * as a source. A disagreement is the security event `AMOUNT_MISMATCH`, is
   * audited, and halts the flow (AGENTS.md section 5).
   *
   * Idempotent through the unique `Order.idempotencyKey` column: replaying the
   * same key returns the original order with `created: false`.
   */
  async createOrder(
    input: CreateOrderRequest,
    actor: OrderCustomerActor,
  ): Promise<CreateOrderResponse> {
    const replay = await this.findByIdempotencyKey(input, actor);
    if (replay) {
      return replay;
    }

    const quote = await this.db.quote.findUnique({
      where: { id: input.quoteId },
      select: {
        id: true,
        customerId: true,
        commerceSessionId: true,
        commerceSession: { select: { customerId: true, sessionToken: true } },
        cartId: true,
        status: true,
        expiresAt: true,
        finalAmountIrr: true,
        displayAmountToman: true,
      },
    });

    /* A quote belonging to someone else is reported as missing rather than as
     * forbidden: "not yours" would confirm that the id exists. */
    if (!quote || !ownsQuoteForOrdering(quote, input.commerceSessionToken, actor.customerId)) {
      throw DomainErrors.notFound('quote');
    }

    if (
      quote.status === 'EXPIRED' ||
      (quote.status === 'ACTIVE' && quote.expiresAt <= new Date())
    ) {
      throw DomainErrors.quoteExpired();
    }
    if (quote.status !== 'ACCEPTED') {
      throw DomainErrors.conflict(
        'ابتدا باید این پیش‌فاکتور را تأیید کنید.',
        `Quote ${quote.id} is ${quote.status}, expected ACCEPTED`,
      );
    }

    const acknowledged = BigInt(input.acknowledgedAmountIrr);
    if (acknowledged !== quote.finalAmountIrr) {
      await this.recordAmountMismatch(quote.id, quote.finalAmountIrr, acknowledged, actor);
      throw DomainErrors.amountMismatch(
        'Acknowledged amount differs from the immutable quote snapshot',
      );
    }

    const created = await this.insertOrder(input, actor, quote);

    /* Placing the order is itself an audited transition, so the customer
     * timeline starts at AWAITING_PAYMENT rather than at a bare DRAFT row. */
    const placed = await this.place(created, actor);
    return { order: this.toDetailDto(placed, await this.timeline(placed.id)), created: true };
  }

  /* =================================================================== read */

  /** A customer's own order. Scoped by the session customer id, never by input. */
  async getOrderForCustomer(orderNumber: string, customerId: string): Promise<GetOrderResponse> {
    const order = await this.db.order.findFirst({
      where: { orderNumber, customerId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw DomainErrors.notFound('order');
    }
    return { order: this.toDetailDto(order, await this.timeline(order.id)) };
  }

  /** A customer's own order list. */
  async listOrdersForCustomer(
    customerId: string,
    query: ListOrdersQuery,
  ): Promise<ListOrdersResponse> {
    const where: Prisma.OrderWhereInput = {
      customerId,
      ...(query.status ? { status: query.status } : {}),
    };
    return this.paginate(where, query.page, query.pageSize);
  }

  /** Staff order list, across customers, with filters. */
  async adminListOrders(query: AdminListOrdersQuery): Promise<ListOrdersResponse> {
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.orderNumber ? { orderNumber: query.orderNumber } : {}),
      ...(query.quoteId ? { quoteId: query.quoteId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search, mode: 'insensitive' } },
              { customerId: query.search },
            ],
          }
        : {}),
    };
    return this.paginate(where, query.page, query.pageSize);
  }

  /** Staff order detail by internal id. */
  async adminGetOrder(id: string): Promise<GetOrderResponse> {
    const order = await this.db.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) {
      throw DomainErrors.notFound('order');
    }
    return { order: this.toDetailDto(order, await this.timeline(order.id)) };
  }

  /* ======================================================= payments bridge */

  async markPaymentPending(orderId: string, paymentId: string): Promise<OrderTransitionResult> {
    return this.systemTransition(orderId, 'PAYMENT_PENDING', 'payment session opened', {
      paymentId,
    });
  }

  async markPaid(orderId: string, paymentId: string): Promise<OrderTransitionResult> {
    return this.systemTransition(orderId, 'PAID', 'payment verified server-side', { paymentId });
  }

  async markPaymentFailed(
    orderId: string,
    paymentId: string,
    reason: string,
  ): Promise<OrderTransitionResult> {
    return this.systemTransition(orderId, 'FAILED', reason, { paymentId }, reason);
  }

  /* ================================================================ helpers */

  private async systemTransition(
    orderId: string,
    next: OrderStatus,
    reason: string,
    context: Readonly<Record<string, string>>,
    failureReason?: string,
  ): Promise<OrderTransitionResult> {
    const order = await this.db.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, status: true, paidAt: true },
    });
    if (!order) {
      throw DomainErrors.notFound('order');
    }

    /* Gateway callbacks can arrive out of order. Once a verified payment exists,
     * a late "pending" or "failed" callback must never regress the order. A
     * replay of "paid" after fulfillment is also success, not a transition back. */
    if (order.paidAt instanceof Date || POST_PAYMENT_STATUSES.has(order.status)) {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        changed: false,
      };
    }

    return this.stateMachine.transition(
      order,
      next,
      { id: 'system:payments', type: 'SYSTEM' },
      reason,
      {
        context,
        ...(failureReason === undefined ? {} : { failureReason }),
      },
    );
  }

  /** Replay of a known idempotency key, validated against the same inputs. */
  private async findByIdempotencyKey(
    input: CreateOrderRequest,
    actor: OrderCustomerActor,
  ): Promise<CreateOrderResponse | null> {
    const existing = await this.db.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: ORDER_INCLUDE,
    });
    if (!existing) {
      return null;
    }

    if (existing.customerId !== actor.customerId || existing.quoteId !== input.quoteId) {
      throw DomainErrors.idempotencyConflict(
        'Order idempotency key is already used for a different order',
      );
    }
    if (existing.totalAmountIrr !== BigInt(input.acknowledgedAmountIrr)) {
      await this.recordAmountMismatch(
        existing.quoteId,
        existing.totalAmountIrr,
        BigInt(input.acknowledgedAmountIrr),
        actor,
      );
      throw DomainErrors.amountMismatch('Replayed order acknowledges a different amount');
    }

    /* Self-heal: the process may have died between the insert and the placing
     * transition. Replaying the key finishes the job instead of stranding the
     * order in DRAFT forever. */
    const order = existing.status === 'DRAFT' ? await this.place(existing, actor) : existing;
    return { order: this.toDetailDto(order, await this.timeline(order.id)), created: false };
  }

  private async place(order: OrderRow, actor: OrderCustomerActor): Promise<OrderRow> {
    await this.stateMachine.transition(
      order,
      'AWAITING_PAYMENT',
      this.auditActor(actor),
      'order placed',
    );
    return this.db.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
  }

  private async insertOrder(
    input: CreateOrderRequest,
    actor: OrderCustomerActor,
    quote: {
      id: string;
      cartId: string | null;
      finalAmountIrr: bigint;
      displayAmountToman: bigint;
    },
  ): Promise<OrderRow> {
    for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            /* Re-read inside the transaction: the quote may have been cancelled
             * between the checks above and this write. */
            const fresh = await tx.quote.findUnique({
              where: { id: quote.id },
              select: { status: true, finalAmountIrr: true, displayAmountToman: true },
            });
            if (!fresh || fresh.status !== 'ACCEPTED') {
              throw DomainErrors.conflict(
                'وضعیت این پیش‌فاکتور تغییر کرده است. لطفاً قیمت جدید بگیرید.',
                `Quote ${quote.id} left ACCEPTED before the order was written`,
              );
            }

            const duplicate = await tx.order.findFirst({
              where: { quoteId: quote.id },
              select: { id: true },
            });
            if (duplicate) {
              throw DomainErrors.conflict(
                'برای این پیش‌فاکتور قبلاً سفارشی ثبت شده است.',
                `Quote ${quote.id} already has order ${duplicate.id}`,
              );
            }

            const order = await tx.order.create({
              data: {
                orderNumber: await this.nextOrderNumber(tx),
                customerId: actor.customerId,
                quoteId: quote.id,
                cartId: quote.cartId,
                status: 'DRAFT',
                /* COPIED from the quote — the client never supplies a total. */
                totalAmountIrr: fresh.finalAmountIrr,
                displayAmountToman: fresh.displayAmountToman,
                currency: 'IRR',
                idempotencyKey: input.idempotencyKey,
                deliveryEmail: input.deliveryEmail ?? null,
                customerNote: input.customerNote ?? null,
              },
              include: ORDER_INCLUDE,
            });

            /* The invariant, asserted rather than assumed. If these ever differ
             * the transaction is aborted and nothing is written. */
            if (order.totalAmountIrr !== fresh.finalAmountIrr) {
              throw DomainErrors.amountMismatch(
                `Order total ${order.totalAmountIrr} does not equal quote ${quote.id} final amount ${fresh.finalAmountIrr}`,
              );
            }

            return order;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        const targets = uniqueViolationTargets(error);
        if (targets?.some((target) => target.includes('idempotencyKey'))) {
          /* Another request with the same key won the race. Its result is the
           * canonical one. */
          const replay = await this.findByIdempotencyKey(input, actor);
          if (replay) {
            return this.db.order.findUniqueOrThrow({
              where: { idempotencyKey: input.idempotencyKey },
              include: ORDER_INCLUDE,
            });
          }
          throw DomainErrors.idempotencyConflict(
            'Order idempotency key was committed but its order could not be read',
          );
        }

        const retryable =
          targets?.some((target) => target.includes('orderNumber')) === true ||
          isRetryableTransactionConflict(error);
        if (retryable && attempt < ORDER_NUMBER_ATTEMPTS) {
          continue;
        }
        if (retryable) {
          throw DomainErrors.conflict(
            'ثبت سفارش با خطا مواجه شد. لطفاً دوباره تلاش کنید.',
            `Exhausted ${ORDER_NUMBER_ATTEMPTS} serializable order-creation attempts`,
          );
        }
        throw error;
      }
    }

    throw DomainErrors.conflict(
      'ثبت سفارش با خطا مواجه شد. لطفاً دوباره تلاش کنید.',
      'Exhausted order-number attempts',
    );
  }

  /** `BP-2026-000123`. Sequential within the calendar year, unique by column. */
  private async nextOrderNumber(tx: Pick<OrdersDatabase, 'order'>): Promise<string> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const placed = await tx.order.count({ where: { createdAt: { gte: yearStart } } });
    return `BP-${year}-${String(placed + 1).padStart(6, '0')}`;
  }

  private async paginate(
    where: Prisma.OrderWhereInput,
    page: number,
    pageSize: number,
  ): Promise<ListOrdersResponse> {
    const [rows, total] = await Promise.all([
      this.db.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.order.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toSummaryDto(row)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /** The customer-visible timeline is a projection of the audit trail. */
  private async timeline(orderId: string): Promise<OrderDetailDto['timeline']> {
    const rows = await this.db.auditLog.findMany({
      where: { entity: 'Order', entityId: orderId, action: ORDER_STATUS_CHANGED },
      orderBy: { createdAt: 'asc' },
      select: { after: true, createdAt: true },
    });

    const timeline: Array<{ status: OrderStatus; at: string; noteFa: string | null }> = [];
    for (const row of rows) {
      const status = readStatus(row.after);
      if (status) {
        timeline.push({ status, at: row.createdAt.toISOString(), noteFa: null });
      }
    }
    return timeline;
  }

  private async recordAmountMismatch(
    quoteId: string,
    expected: bigint,
    received: bigint,
    actor: OrderCustomerActor,
  ): Promise<void> {
    await this.audit.record({
      actor: actor.customerId,
      actorType: 'CUSTOMER',
      action: 'AMOUNT_MISMATCH',
      entity: 'Quote',
      entityId: quoteId,
      before: { quoteFinalAmountIrr: expected.toString() },
      after: { acknowledgedAmountIrr: received.toString() },
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      requestId: actor.requestId ?? null,
    });
  }

  private auditActor(actor: OrderCustomerActor): OrderActor {
    return {
      id: actor.customerId,
      type: 'CUSTOMER',
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      requestId: actor.requestId ?? null,
    };
  }

  /* ------------------------------------------------------------- mappers */

  private toSummaryDto(row: OrderRow): OrderSummaryDto {
    return {
      id: row.id,
      orderNumber: row.orderNumber,
      status: row.status,
      totalAmountIrr: row.totalAmountIrr.toString() as IrrString,
      displayAmountToman: row.displayAmountToman.toString() as IrrString,
      currency: row.currency,
      itemTitleFa: itemTitleFa(row),
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
    };
  }

  private toDetailDto(row: OrderRow, timeline: OrderDetailDto['timeline']): OrderDetailDto {
    return {
      ...this.toSummaryDto(row),
      quoteId: row.quoteId,
      cartId: row.cartId,
      customerId: row.customerId,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      failureReason: row.failureReason,
      delivery: toDeliveryDto(row.giftCardAssets[0]),
      timeline,
    };
  }
}

/* ============================================================================
 * Pure helpers
 * ==========================================================================*/

function ownsQuoteForOrdering(
  quote: {
    readonly customerId: string | null;
    readonly commerceSession: {
      readonly customerId: string | null;
      readonly sessionToken: string;
    } | null;
  },
  commerceSessionToken: string | undefined,
  customerId: string,
): boolean {
  if (quote.customerId !== null) {
    return quote.customerId === customerId;
  }
  if (quote.commerceSession === null) {
    return false;
  }
  if (commerceSessionToken !== undefined) {
    return quote.commerceSession.sessionToken === commerceSessionToken;
  }
  return quote.commerceSession.customerId === customerId;
}

function itemTitleFa(row: OrderRow): string {
  const sku = row.quote.sku;
  if (sku) {
    return `${sku.product.titleFa} — ${sku.denominationLabel}`;
  }
  return row.quote.service?.nameFa ?? 'سفارش';
}

function toDeliveryDto(
  asset: OrderRow['giftCardAssets'][number] | undefined,
): OrderDeliveryDto | null {
  if (!asset) {
    return null;
  }
  return {
    assetType: asset.assetType,
    status: asset.status,
    maskedCode: asset.maskedCode,
    deliveryUrl: asset.deliveryUrl,
    recipientEmailMasked: asset.recipientEmail ? maskEmail(asset.recipientEmail) : null,
    expiryDate: asset.expiryDate?.toISOString() ?? null,
    sentAt: asset.sentAt?.toISOString() ?? null,
  };
}

const ORDER_STATUS_SET: ReadonlySet<string> = new Set<string>(ORDER_STATUS_VALUES);

function readStatus(after: Prisma.JsonValue | null): OrderStatus | null {
  if (typeof after !== 'object' || after === null || Array.isArray(after)) {
    return null;
  }
  const value = (after as Record<string, unknown>)['status'];
  if (typeof value !== 'string' || !ORDER_STATUS_SET.has(value)) {
    return null;
  }
  return value as OrderStatus;
}

function isRetryableTransactionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'P2034'
  );
}

/** Prisma unique-constraint targets, or `null` when the error is something else. */
export function uniqueViolationTargets(error: unknown): readonly string[] | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== 'P2002') {
    return null;
  }
  const target = candidate.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof target === 'string' ? [target] : [];
}
