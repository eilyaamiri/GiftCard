/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { CustomerReadService } from '../identity/customer-read.service';
import type { IdentityActor } from '../identity/identity.tokens';
import type { UpdateProfileRequest } from '../identity/identity.schemas';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
import type {
  AccountOrderDto,
  AccountPaymentDto,
  AccountRefundDto,
  CustomerProfileDto,
  PagedResult,
} from './customers.types';

/**
 * Everything under `/api/account/*`.
 *
 * EVERY query in this class filters by the `customerId` that the guard read from
 * the verified session. No method accepts a customer id from the caller, so
 * there is no path by which customer A reaches customer B's data — the ownership
 * check is a `where` clause, not an `if`.
 */
@Injectable()
export class AccountService {
  constructor(
    @Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase,
    private readonly customers: CustomerReadService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(customerId: string): Promise<CustomerProfileDto> {
    const [customer, profile] = await Promise.all([
      this.customers.customerDto(customerId),
      this.database.customerProfile.findUnique({
        where: { customerId },
        select: {
          firstName: true,
          lastName: true,
          preferredLanguage: true,
          marketingOptIn: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      customer,
      preferredLanguage: profile?.preferredLanguage ?? 'fa',
      marketingOptIn: profile?.marketingOptIn ?? false,
      requiresProfileCompletion: !profile?.firstName || !profile.lastName,
      updatedAt: (profile?.updatedAt ?? new Date()).toISOString(),
    };
  }

  async updateProfile(
    customerId: string,
    input: UpdateProfileRequest,
    actor: IdentityActor,
  ): Promise<CustomerProfileDto> {
    const before = await this.database.customerProfile.findUnique({
      where: { customerId },
      select: {
        firstName: true,
        lastName: true,
        preferredLanguage: true,
        marketingOptIn: true,
      },
    });

    const data = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.preferredLanguage !== undefined
        ? { preferredLanguage: input.preferredLanguage }
        : {}),
      ...(input.marketingOptIn !== undefined ? { marketingOptIn: input.marketingOptIn } : {}),
    };

    await this.database.customerProfile.upsert({
      where: { customerId },
      create: { customerId, ...data },
      update: data,
    });

    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'CUSTOMER_PROFILE_UPDATED',
      entity: 'CustomerProfile',
      entityId: customerId,
      before,
      after: data,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return this.getProfile(customerId);
  }

  /* -------------------------------------------------------------- collections */

  async listOrders(
    customerId: string,
    page: number,
    pageSize: number,
  ): Promise<PagedResult<AccountOrderDto>> {
    const where = { customerId };
    const [total, rows] = await Promise.all([
      this.database.order.count({ where }),
      this.database.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmountIrr: true,
          displayAmountToman: true,
          currency: true,
          createdAt: true,
          paidAt: true,
          fulfilledAt: true,
        },
      }),
    ]);

    return paginate(
      rows.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmountIrr: order.totalAmountIrr.toString(),
        displayAmountToman: order.displayAmountToman.toString(),
        currency: order.currency,
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
        fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    );
  }

  async getOrder(customerId: string, orderId: string): Promise<AccountOrderDto> {
    /* The customer id is part of the lookup, so a guessed order id from another
     * account returns 404 rather than leaking its existence. */
    const order = await this.database.order.findFirst({
      where: { id: orderId, customerId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmountIrr: true,
        displayAmountToman: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        fulfilledAt: true,
      },
    });
    if (!order) {
      throw DomainErrors.notFound('Order');
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmountIrr: order.totalAmountIrr.toString(),
      displayAmountToman: order.displayAmountToman.toString(),
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
    };
  }

  async listPayments(
    customerId: string,
    page: number,
    pageSize: number,
  ): Promise<PagedResult<AccountPaymentDto>> {
    const where = { customerId };
    const [total, rows] = await Promise.all([
      this.database.payment.count({ where }),
      this.database.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderId: true,
          provider: true,
          status: true,
          amountIrr: true,
          displayAmountToman: true,
          providerRefId: true,
          maskedCard: true,
          createdAt: true,
          verifiedAt: true,
          order: { select: { orderNumber: true } },
        },
      }),
    ]);

    return paginate(
      rows.map((payment) => ({
        id: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        provider: payment.provider,
        status: payment.status,
        amountIrr: payment.amountIrr.toString(),
        displayAmountToman: payment.displayAmountToman.toString(),
        /* No authority, no merchant id, no provider payload — rule 10. */
        providerRefId: payment.providerRefId,
        maskedCard: payment.maskedCard,
        createdAt: payment.createdAt.toISOString(),
        verifiedAt: payment.verifiedAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    );
  }

  async listRefunds(
    customerId: string,
    page: number,
    pageSize: number,
  ): Promise<PagedResult<AccountRefundDto>> {
    const where = { order: { customerId } };
    const [total, rows] = await Promise.all([
      this.database.refund.count({ where }),
      this.database.refund.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderId: true,
          amountIrr: true,
          status: true,
          requestedAt: true,
          processedAt: true,
          order: { select: { orderNumber: true } },
        },
      }),
    ]);

    return paginate(
      rows.map((refund) => ({
        id: refund.id,
        orderId: refund.orderId,
        orderNumber: refund.order.orderNumber,
        amountIrr: refund.amountIrr.toString(),
        status: refund.status,
        requestedAt: refund.requestedAt.toISOString(),
        processedAt: refund.processedAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    );
  }
}

export function paginate<TItem>(
  items: readonly TItem[],
  total: number,
  page: number,
  pageSize: number,
): PagedResult<TItem> {
  return {
    items,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}
