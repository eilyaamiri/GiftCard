import { Inject, Injectable } from '@nestjs/common';

import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
import type {
  AccountNotificationDto,
  AccountNotificationFeed,
  AccountNotificationKind,
} from './customers.types';

/**
 * The customer's notification feed.
 *
 * There is no `Notification` table. Every line below is derived on read from
 * something that already happened — an order transition, a refund decision, a
 * staff reply — and that is deliberate. A stored feed is a second copy of state
 * that can drift from the order it describes, and it needs a writer on every
 * path that touches an order. Deriving it means the feed cannot disagree with
 * the order, and no existing flow has to be changed to keep it honest.
 *
 * What that costs: nothing is written here, so read state cannot live in the
 * API. `generatedAt` is the marker the client stores instead. When a
 * `Notification` model exists this service is the seam to replace, and the DTO
 * it returns does not have to change.
 *
 * Every query filters by the `customerId` the guard read from the session, so
 * one customer's feed can never contain another's row.
 */
@Injectable()
export class NotificationsService {
  constructor(@Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase) {}

  async list(customerId: string): Promise<AccountNotificationFeed> {
    const [orders, refunds, replies] = await Promise.all([
      this.database.order.findMany({
        /* A DRAFT order is a checkout that never got as far as a price the
         * customer accepted. Telling them about it would be noise. */
        where: { customerId, status: { not: 'DRAFT' } },
        orderBy: { createdAt: 'desc' },
        take: SOURCE_LIMIT,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          placedAt: true,
          paidAt: true,
          fulfilledAt: true,
          cancelledAt: true,
          updatedAt: true,
        },
      }),
      this.database.refund.findMany({
        where: { order: { customerId } },
        orderBy: { requestedAt: 'desc' },
        take: SOURCE_LIMIT,
        select: {
          id: true,
          orderId: true,
          status: true,
          requestedAt: true,
          processedAt: true,
          order: { select: { orderNumber: true } },
        },
      }),
      this.database.supportMessage.findMany({
        /* The customer's own replies are not news to them. */
        where: { authorType: 'STAFF', ticket: { workItem: { customerId } } },
        orderBy: { createdAt: 'desc' },
        take: SOURCE_LIMIT,
        select: {
          id: true,
          ticketId: true,
          createdAt: true,
          ticket: { select: { workItem: { select: { title: true } } } },
        },
      }),
    ]);

    const items = [
      ...orders.flatMap(orderEvents),
      ...refunds.flatMap(refundEvents),
      ...replies.map(supportReplyEvent),
    ]
      .sort(newestFirst)
      .slice(0, FEED_LIMIT);

    return { items, generatedAt: new Date().toISOString() };
  }
}

/** How many rows each source contributes before the merge. */
const SOURCE_LIMIT = 20;
/** How many lines the customer actually sees. */
const FEED_LIMIT = 20;

interface OrderRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly placedAt: Date | null;
  readonly paidAt: Date | null;
  readonly fulfilledAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly updatedAt: Date;
}

interface RefundRow {
  readonly id: string;
  readonly orderId: string;
  readonly status: string;
  readonly requestedAt: Date;
  readonly processedAt: Date | null;
  readonly order: { readonly orderNumber: string };
}

interface SupportReplyRow {
  readonly id: string;
  readonly ticketId: string;
  readonly createdAt: Date;
  readonly ticket: { readonly workItem: { readonly title: string } };
}

/**
 * One order becomes up to four lines, one per timestamp it carries.
 *
 * `FAILED` and `REVIEW_REQUIRED` have no timestamp column of their own, so they
 * are dated by `updatedAt` — the write that put the order in that state. That is
 * an approximation, and the only one in this file: any later write to the row
 * moves the line. It is still better than hiding a failed order from its owner.
 */
function orderEvents(order: OrderRow): readonly AccountNotificationDto[] {
  const href = `/account/orders/${order.id}`;
  const events: AccountNotificationDto[] = [];

  if (order.placedAt !== null) {
    events.push(
      line(
        `order:${order.id}:placed`,
        'ORDER_PLACED',
        `سفارش ${order.orderNumber} ثبت شد`,
        'در انتظار پرداخت شماست.',
        href,
        order.placedAt,
      ),
    );
  }
  if (order.paidAt !== null) {
    events.push(
      line(
        `order:${order.id}:paid`,
        'ORDER_PAID',
        `پرداخت سفارش ${order.orderNumber} تأیید شد`,
        'سفارش شما در صف آماده‌سازی قرار گرفت.',
        href,
        order.paidAt,
      ),
    );
  }
  if (order.fulfilledAt !== null) {
    events.push(
      line(
        `order:${order.id}:delivered`,
        'ORDER_DELIVERED',
        `سفارش ${order.orderNumber} تحویل شد`,
        'دارایی خریداری‌شده در صفحهٔ سفارش قابل مشاهده است.',
        href,
        order.fulfilledAt,
      ),
    );
  }
  if (order.cancelledAt !== null) {
    events.push(
      line(
        `order:${order.id}:cancelled`,
        'ORDER_CANCELLED',
        `سفارش ${order.orderNumber} لغو شد`,
        null,
        href,
        order.cancelledAt,
      ),
    );
  }
  if (order.status === 'FAILED') {
    events.push(
      line(
        `order:${order.id}:failed`,
        'ORDER_FAILED',
        `سفارش ${order.orderNumber} ناتمام ماند`,
        'برای پیگیری می‌توانید از بخش پشتیبانی درخواست ثبت کنید.',
        href,
        order.updatedAt,
      ),
    );
  }
  if (order.status === 'REVIEW_REQUIRED') {
    events.push(
      line(
        `order:${order.id}:review`,
        'ORDER_REVIEW_REQUIRED',
        `سفارش ${order.orderNumber} در حال بررسی است`,
        'کارشناسان ما در حال بررسی سفارش شما هستند.',
        href,
        order.updatedAt,
      ),
    );
  }

  return events;
}

/**
 * A refund is announced when it is asked for and again when it is decided.
 * `APPROVED` and `PROCESSING` are intentionally silent: the money has not moved
 * yet, and a "in progress" line every time the status ticks forward would train
 * the customer to ignore the bell.
 */
function refundEvents(refund: RefundRow): readonly AccountNotificationDto[] {
  const href = `/account/orders/${refund.orderId}`;
  const events: AccountNotificationDto[] = [
    line(
      `refund:${refund.id}:requested`,
      'REFUND_REQUESTED',
      `درخواست بازگشت وجه سفارش ${refund.order.orderNumber} ثبت شد`,
      null,
      href,
      refund.requestedAt,
    ),
  ];

  const outcome = REFUND_OUTCOMES[refund.status];
  if (outcome !== undefined && refund.processedAt !== null) {
    events.push(
      line(
        `refund:${refund.id}:${outcome.suffix}`,
        outcome.kind,
        `${outcome.titleFa} — سفارش ${refund.order.orderNumber}`,
        outcome.bodyFa,
        href,
        refund.processedAt,
      ),
    );
  }

  return events;
}

const REFUND_OUTCOMES: Readonly<
  Record<
    string,
    | {
        readonly suffix: string;
        readonly kind: AccountNotificationKind;
        readonly titleFa: string;
        readonly bodyFa: string | null;
      }
    | undefined
  >
> = {
  COMPLETED: {
    suffix: 'completed',
    kind: 'REFUND_COMPLETED',
    titleFa: 'بازگشت وجه انجام شد',
    bodyFa: 'مبلغ به حساب اعلام‌شدهٔ شما واریز شد.',
  },
  REJECTED: {
    suffix: 'rejected',
    kind: 'REFUND_REJECTED',
    titleFa: 'درخواست بازگشت وجه پذیرفته نشد',
    bodyFa: 'برای اطلاع از دلیل، از بخش پشتیبانی پیگیری کنید.',
  },
  FAILED: {
    suffix: 'failed',
    kind: 'REFUND_FAILED',
    titleFa: 'بازگشت وجه ناموفق بود',
    bodyFa: 'موضوع در حال پیگیری است؛ نیازی به اقدام مجدد نیست.',
  },
};

/**
 * The ticket subject is carried as the body; the message itself is not.
 *
 * A support conversation may contain anything an operator typed. The bell is a
 * new surface, and the ticket page is one click away, so there is no reason for
 * the feed to become a second place that message text can appear.
 */
function supportReplyEvent(reply: SupportReplyRow): AccountNotificationDto {
  return line(
    `support:${reply.id}`,
    'SUPPORT_REPLY',
    'پاسخ جدید پشتیبانی',
    reply.ticket.workItem.title,
    `/account/support/${reply.ticketId}`,
    reply.createdAt,
  );
}

function line(
  id: string,
  kind: AccountNotificationKind,
  title: string,
  body: string | null,
  href: string | null,
  at: Date,
): AccountNotificationDto {
  return { id, kind, title, body, href, createdAt: at.toISOString() };
}

/**
 * Newest first, ties broken by id.
 *
 * Two events on one order can share a timestamp to the millisecond (a paid
 * order that is fulfilled by an automated supplier, for instance). Without the
 * tie-break the order of those two lines would depend on the sort's stability
 * and could differ between requests, which makes the client's read marker
 * flicker.
 */
function newestFirst(left: AccountNotificationDto, right: AccountNotificationDto): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? 1 : -1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
