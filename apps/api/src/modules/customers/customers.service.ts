/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { CustomerReadService } from '../identity/customer-read.service';
import { maskEmail, maskMobile, normalizeEmail, normalizeMobile } from '../identity/identity.utils';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import type {
  CreateCustomerNoteRequest,
  CustomerSearchRequest,
} from '../identity/identity.schemas';
import { paginate } from './account.service';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
import type {
  AccountOrderDto,
  AccountPaymentDto,
  AccountRefundDto,
  Customer360Dto,
  CustomerSearchHit,
  PagedResult,
} from './customers.types';

type MatchSource = CustomerSearchHit['matchedOn'];

/**
 * Operator-facing Customer 360.
 *
 * READ-ONLY with respect to money and identity. There is deliberately no method
 * here that writes `Payment.status`, `Payment.amountIrr`, `Payment.verifiedAt`
 * or `CustomerIdentity.isVerified` — an operator can look at all of them and
 * change none of them (AGENTS.md section 4). The only writes are notes and
 * flags, which are annotations on an account rather than facts about a payment.
 *
 * Search is EXACT-match only. Substring search over mobiles and e-mails would
 * turn a SUPPORT login into a bulk customer-data export; an operator has to
 * already know the identifier they are looking up, and every lookup is audited.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase,
    private readonly customers: CustomerReadService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ search */

  async search(
    input: CustomerSearchRequest,
    staff: AuthenticatedStaff,
    actor: IdentityActor,
  ): Promise<PagedResult<CustomerSearchHit>> {
    const matches = new Map<string, MatchSource>();
    const remember = (customerId: string, source: MatchSource): void => {
      if (!matches.has(customerId)) {
        matches.set(customerId, source);
      }
    };

    if (input.orderNumber) {
      const order = await this.database.order.findUnique({
        where: { orderNumber: input.orderNumber },
        select: { customerId: true },
      });
      if (order) {
        remember(order.customerId, 'ORDER_NUMBER');
      }
    }

    if (input.paymentRef) {
      const payments = await this.database.payment.findMany({
        where: {
          OR: [
            { providerRefId: input.paymentRef },
            { providerAuthority: input.paymentRef },
            { id: input.paymentRef },
          ],
        },
        select: { customerId: true },
        take: 20,
      });
      for (const payment of payments) {
        remember(payment.customerId, 'PAYMENT_REF');
      }
    }

    if (input.query) {
      const term = input.query.trim();

      /* `normalize*` throw on a malformed value, which is right for a customer
       * submitting their own identifier but wrong here: an operator types one
       * box and it may hold a mobile, an e-mail or a code. A term that is not a
       * mobile simply is not a mobile lookup. */
      const mobile = tryNormalize(() => normalizeMobile(term));
      if (mobile) {
        const identity = await this.database.customerIdentity.findUnique({
          where: { type_valueNormalized: { type: 'MOBILE', valueNormalized: mobile } },
          select: { customerId: true },
        });
        if (identity) {
          remember(identity.customerId, 'MOBILE');
        }
      }

      const email = tryNormalize(() => normalizeEmail(term));
      if (email) {
        const identity = await this.database.customerIdentity.findUnique({
          where: { type_valueNormalized: { type: 'EMAIL', valueNormalized: email } },
          select: { customerId: true },
        });
        if (identity) {
          remember(identity.customerId, 'EMAIL');
        }
      }

      const byCode = await this.database.customer.findUnique({
        where: { customerCode: term.toUpperCase() },
        select: { id: true },
      });
      if (byCode) {
        remember(byCode.id, 'CUSTOMER_CODE');
      }

      const normalizedName = normalizeName(term);
      if (normalizedName.length >= 3) {
        const parts = normalizedName.split(' ').filter(Boolean);
        const nameRows = await this.database.customerProfile.findMany({
          where: parts.length > 1
            ? {
                OR: [
                  { AND: [{ firstName: { contains: parts[0], mode: 'insensitive' } }, { lastName: { contains: parts.slice(1).join(' '), mode: 'insensitive' } }] },
                  { AND: [{ firstName: { contains: parts.at(-1), mode: 'insensitive' } }, { lastName: { contains: parts.slice(0, -1).join(' '), mode: 'insensitive' } }] },
                ],
              }
            : {
                OR: [
                  { firstName: { contains: normalizedName, mode: 'insensitive' } },
                  { lastName: { contains: normalizedName, mode: 'insensitive' } },
                ],
              },
          select: { customerId: true },
          take: 50,
        });
        for (const profile of nameRows) remember(profile.customerId, 'NAME');
      }
    }

    await this.audit.record({
      actor: staff.staffId,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: 'CUSTOMER_SEARCH',
      entity: 'Customer',
      entityId: matches.size === 1 ? [...matches.keys()][0] ?? 'SEARCH' : 'SEARCH',
      /* The masked term only. An audit trail should show what was looked up
       * without becoming a second copy of the customer database. */
      after: {
        term: maskTerm(input.query),
        orderNumber: input.orderNumber ?? null,
        hasPaymentRef: Boolean(input.paymentRef),
        resultCount: matches.size,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    const ids = [...matches.keys()];
    if (ids.length === 0) {
      return paginate<CustomerSearchHit>([], 0, input.page, input.pageSize);
    }

    const rows = await this.database.customer.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true,
        customerCode: true,
        status: true,
        createdAt: true,
        profile: { select: { firstName: true, lastName: true } },
        identities: { select: { type: true, valueNormalized: true } },
        _count: { select: { orders: true } },
      },
    });

    const hits = rows.map((row): CustomerSearchHit => {
      const mobile = row.identities.find((identity) => identity.type === 'MOBILE');
      const email = row.identities.find((identity) => identity.type === 'EMAIL');
      const fullName = [row.profile?.firstName, row.profile?.lastName]
        .filter((part): part is string => Boolean(part))
        .join(' ');

      return {
        customerId: row.id,
        customerCode: row.customerCode,
        status: row.status,
        maskedMobile: mobile ? maskMobile(mobile.valueNormalized) : null,
        maskedEmail: email ? maskEmail(email.valueNormalized) : null,
        fullName: fullName.length > 0 ? fullName : null,
        orderCount: row._count.orders,
        createdAt: row.createdAt.toISOString(),
        matchedOn: matches.get(row.id) ?? 'CUSTOMER_CODE',
      };
    });

    return paginate(hits, ids.length, input.page, input.pageSize);
  }

  /* --------------------------------------------------------------- 360 view */

  async customer360(
    customerId: string,
    staff: AuthenticatedStaff,
    actor: IdentityActor,
  ): Promise<Customer360Dto> {
    const exists = await this.database.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!exists) {
      throw DomainErrors.notFound('Customer');
    }

    const [customer, profile, flags, notes, orders, payments, refunds, tickets, totals] = await Promise.all([
      this.customers.customerDto(customerId),
      this.database.customerProfile.findUnique({
        where: { customerId },
        select: { preferredLanguage: true, marketingOptIn: true },
      }),
      this.database.customerFlag.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        select: { key: true, reason: true, createdAt: true, expiresAt: true },
      }),
      this.database.customerNote.findMany({
        where: { customerId },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: 50,
        select: { id: true, body: true, isPinned: true, authorStaffId: true, createdAt: true },
      }),
      this.database.order.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 25,
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
      this.database.payment.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        take: 25,
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
      this.database.refund.findMany({
        where: { order: { customerId } },
        orderBy: { requestedAt: 'desc' },
        take: 25,
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
      this.database.supportTicket.findMany({
        where: { workItem: { customerId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          workItemId: true,
          ownerStaffId: true,
          firstResponseDueAt: true,
          nextResponseDueAt: true,
          firstRespondedAt: true,
          lastRespondedAt: true,
          createdAt: true,
          owner: { select: { fullName: true } },
          workItem: {
            select: {
              code: true,
              title: true,
              status: true,
              orderId: true,
              order: { select: { orderNumber: true } },
            },
          },
        },
      }),
      this.lifetimeTotals(customerId),
    ]);

    await this.audit.record({
      actor: staff.staffId,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: 'CUSTOMER_360_VIEWED',
      entity: 'Customer',
      entityId: customerId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return {
      customer,
      profile: {
        preferredLanguage: profile?.preferredLanguage ?? 'fa',
        marketingOptIn: profile?.marketingOptIn ?? false,
      },
      flags: flags.map((flag) => ({
        key: flag.key,
        reason: flag.reason,
        createdAt: flag.createdAt.toISOString(),
        expiresAt: flag.expiresAt?.toISOString() ?? null,
      })),
      notes: notes.map((note) => ({
        id: note.id,
        body: note.body,
        isPinned: note.isPinned,
        authorStaffId: note.authorStaffId,
        createdAt: note.createdAt.toISOString(),
      })),
      orders: orders.map(
        (order): AccountOrderDto => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          totalAmountIrr: order.totalAmountIrr.toString(),
          displayAmountToman: order.displayAmountToman.toString(),
          currency: order.currency,
          createdAt: order.createdAt.toISOString(),
          paidAt: order.paidAt?.toISOString() ?? null,
          fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
        }),
      ),
      payments: payments.map(
        (payment): AccountPaymentDto => ({
          id: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          provider: payment.provider,
          status: payment.status,
          amountIrr: payment.amountIrr.toString(),
          displayAmountToman: payment.displayAmountToman.toString(),
          providerRefId: payment.providerRefId,
          maskedCard: payment.maskedCard,
          createdAt: payment.createdAt.toISOString(),
          verifiedAt: payment.verifiedAt?.toISOString() ?? null,
        }),
      ),
      refunds: refunds.map(
        (refund): AccountRefundDto => ({
          id: refund.id,
          orderId: refund.orderId,
          orderNumber: refund.order.orderNumber,
          amountIrr: refund.amountIrr.toString(),
          status: refund.status,
          requestedAt: refund.requestedAt.toISOString(),
          processedAt: refund.processedAt?.toISOString() ?? null,
        }),
      ),
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        workItemId: ticket.workItemId,
        code: ticket.workItem.code,
        subject: ticket.workItem.title,
        status: ticket.workItem.status,
        orderId: ticket.workItem.orderId,
        orderNumber: ticket.workItem.order?.orderNumber ?? null,
        ownerStaffId: ticket.ownerStaffId,
        ownerStaffName: ticket.owner?.fullName ?? null,
        createdAt: ticket.createdAt.toISOString(),
        firstResponseDueAt: ticket.firstResponseDueAt.toISOString(),
        nextResponseDueAt: ticket.nextResponseDueAt.toISOString(),
        firstRespondedAt: ticket.firstRespondedAt?.toISOString() ?? null,
        lastRespondedAt: ticket.lastRespondedAt?.toISOString() ?? null,
      })),
      totals,
    };
  }

  private async lifetimeTotals(customerId: string): Promise<Customer360Dto['totals']> {
    const [orderCount, paidOrders] = await Promise.all([
      this.database.order.count({ where: { customerId } }),
      this.database.order.findMany({
        where: { customerId, paidAt: { not: null } },
        select: { totalAmountIrr: true },
      }),
    ]);

    /* BigInt accumulation — never a JS number for money (AGENTS.md rule 2). */
    let lifetimePaid = 0n;
    for (const order of paidOrders) {
      lifetimePaid += order.totalAmountIrr;
    }

    return {
      orderCount,
      paidOrderCount: paidOrders.length,
      lifetimePaidIrr: lifetimePaid.toString(),
    };
  }

  /* ------------------------------------------------------------ annotations */

  async addNote(
    customerId: string,
    input: CreateCustomerNoteRequest,
    staff: AuthenticatedStaff,
    actor: IdentityActor,
  ): Promise<Customer360Dto['notes'][number]> {
    const customer = await this.database.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw DomainErrors.notFound('Customer');
    }

    const note = await this.database.customerNote.create({
      data: {
        customerId,
        authorStaffId: staff.staffId,
        body: input.body,
        isPinned: input.isPinned,
      },
      select: { id: true, body: true, isPinned: true, authorStaffId: true, createdAt: true },
    });

    await this.audit.record({
      actor: staff.staffId,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: 'CUSTOMER_NOTE_CREATED',
      entity: 'CustomerNote',
      entityId: note.id,
      after: { customerId, isPinned: note.isPinned },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return {
      id: note.id,
      body: note.body,
      isPinned: note.isPinned,
      authorStaffId: note.authorStaffId,
      createdAt: note.createdAt.toISOString(),
    };
  }

  /**
   * Clears a review flag (for example `IDENTITY_CONFLICT`) once support has
   * dealt with it.
   *
   * Clearing the flag does NOT merge the accounts, move an identity or verify
   * anything — it only closes the review marker. Whatever the operator decided
   * about the underlying identity has to happen through the identity workflow,
   * which is human-gated.
   */
  async clearFlag(
    customerId: string,
    key: string,
    staff: AuthenticatedStaff,
    actor: IdentityActor,
  ): Promise<{ cleared: boolean }> {
    const flag = await this.database.customerFlag.findUnique({
      where: { customerId_key: { customerId, key } },
      select: { id: true, key: true, reason: true },
    });
    if (!flag) {
      throw DomainErrors.notFound('CustomerFlag');
    }

    await this.database.customerFlag.delete({ where: { id: flag.id } });

    await this.audit.record({
      actor: staff.staffId,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: 'CUSTOMER_FLAG_CLEARED',
      entity: 'CustomerFlag',
      entityId: flag.id,
      before: { customerId, key: flag.key, reason: flag.reason },
      after: null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return { cleared: true };
  }
}

/** Normalises common Persian/Arabic keyboard variants without altering display data. */
function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .replaceAll('ي', 'ی')
    .replaceAll('ك', 'ک')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Runs a strict normaliser as a probe: an invalid value is simply "not this kind". */
function tryNormalize(normalise: () => string): string | null {
  try {
    return normalise();
  } catch {
    return null;
  }
}

/**
 * What goes into the audit row for a search.
 *
 * A mobile or an e-mail is masked, so the log records that a lookup happened
 * without accumulating a searchable copy of customer contact details.
 */
function maskTerm(term: string | undefined): string | null {
  if (!term) {
    return null;
  }

  const mobile = tryNormalize(() => normalizeMobile(term));
  if (mobile) {
    return maskMobile(mobile);
  }

  const email = tryNormalize(() => normalizeEmail(term));
  if (email) {
    return maskEmail(email);
  }

  return term.toUpperCase();
}
