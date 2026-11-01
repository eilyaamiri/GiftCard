import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ListRefundsQuery,
  OrderStatus,
  PaymentStatus,
  RefundStatus,
  StaffRefundDto,
} from '@barat/contracts';
import type { Prisma, PrismaClient } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff } from '../identity/identity.tokens';
import { OrderStateMachine } from '../orders/order-state-machine';
import type { OrdersDatabaseCore } from '../orders/orders.tokens';
import { PAYMENTS_DATABASE } from './payments.service';

/** The slice of the client refund processing touches. */
export type RefundsDatabase = Pick<PrismaClient, 'refund' | 'payment' | 'order' | 'reconciliationIssue' | '$transaction'>;

/** Reasons the payments module files for a second capture. The order is not refunded, only that payment. */
export const CAPTURE_REFUND_REASONS: ReadonlySet<string> = new Set([
  'DUPLICATE_PAYMENT_FOR_ORDER',
  'PAYMENT_FOR_CLOSED_ORDER',
]);

const OPEN_STATUSES: readonly RefundStatus[] = ['REQUESTED', 'APPROVED'];

const REFUND_INCLUDE = {
  order: { select: { orderNumber: true, status: true } },
  payment: { select: { status: true, provider: true } },
  requestedBy: { select: { fullName: true } },
  approvedBy: { select: { fullName: true } },
} satisfies Prisma.RefundInclude;

type RefundRow = Prisma.RefundGetPayload<{ include: typeof REFUND_INCLUDE }>;

/**
 * The refund queue (PAY-10).
 *
 * No gateway in use offers a refund API we have verified (every adapter answers
 * NOT_SUPPORTED), so money goes back by bank transfer. This service is the
 * record of that, with two people on every refund:
 *
 *   REQUESTED  -> an operator converted a task to a refund, or the payments
 *                 module found a second capture of an already-paid order;
 *   APPROVED   -> a FINANCE or ADMIN user who did not request it agreed;
 *   COMPLETED  -> finance sent the transfer and recorded its bank reference.
 *                 The payment becomes REFUNDED, and an order refunded as a
 *                 whole becomes REFUNDED through its state machine.
 *   REJECTED   -> a request that will not be paid; the order goes back to
 *                 REVIEW_REQUIRED for an operator to serve the customer.
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(PAYMENTS_DATABASE) private readonly db: RefundsDatabase,
    @Inject(OrderStateMachine) private readonly orderStates: OrderStateMachine,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  async list(query: ListRefundsQuery): Promise<StaffRefundDto[]> {
    const statuses = query.status === undefined ? OPEN_STATUSES : [query.status];
    const rows = await this.db.refund.findMany({
      where: { status: { in: [...statuses] } },
      include: REFUND_INCLUDE,
      orderBy: { requestedAt: 'asc' },
      take: 200,
    });
    return rows.map(toDto);
  }

  /** The second pair of eyes. Whoever requested the refund cannot approve it. */
  async approve(refundId: string, staff: AuthenticatedStaff): Promise<StaffRefundDto> {
    await this.db.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (refund === null) throw DomainErrors.notFound('Refund');
      if (refund.status === 'APPROVED' && refund.approvedByStaffId === staff.staffId) return;
      if (refund.status !== 'REQUESTED') {
        throw DomainErrors.conflict('این درخواست بازگشت وجه در وضعیت قابل تأیید نیست.', `Refund ${refundId} is ${refund.status}`);
      }
      if (refund.requestedByStaffId === staff.staffId) {
        throw DomainErrors.conflict(
          'درخواست‌دهندهٔ بازگشت وجه نمی‌تواند همان درخواست را تأیید کند.',
          `Staff ${staff.staffId} requested refund ${refundId}`,
        );
      }

      /* An operator's refund names the order, not the payment. When it returns
       * the whole payment, tie it to that payment so completing it closes the
       * payment too; a partial refund leaves the payment PAID. */
      let paymentId = refund.paymentId;
      if (paymentId === null) {
        const paid = await tx.payment.findFirst({ where: { orderId: refund.orderId, status: 'PAID' } });
        if (paid !== null && paid.amountIrr === refund.amountIrr) paymentId = paid.id;
      }

      const moved = await tx.refund.updateMany({
        where: { id: refundId, status: 'REQUESTED' },
        data: { status: 'APPROVED', approvedByStaffId: staff.staffId, paymentId },
      });
      if (moved.count !== 1) {
        throw DomainErrors.conflict('وضعیت این درخواست هم‌زمان تغییر کرد.', `Refund ${refundId} changed concurrently`);
      }
      if (paymentId !== null) {
        await tx.payment.updateMany({
          where: { id: paymentId, status: 'PAID' },
          data: { status: 'REFUND_PENDING' },
        });
      }
    });
    await this.record(staff, 'REFUND_APPROVED', refundId, {});
    return this.get(refundId);
  }

  /** Finance sent the transfer. The bank reference is the evidence. */
  async complete(refundId: string, bankReference: string, staff: AuthenticatedStaff): Promise<StaffRefundDto> {
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        include: { order: { select: { id: true, orderNumber: true, status: true } } },
      });
      if (refund === null) throw DomainErrors.notFound('Refund');
      if (refund.status === 'COMPLETED' && refund.providerRefundRef === bankReference) return;
      if (refund.status !== 'APPROVED') {
        throw DomainErrors.conflict(
          'فقط بازگشت وجه تأییدشده را می‌توان انجام‌شده ثبت کرد.',
          `Refund ${refundId} is ${refund.status}`,
        );
      }

      const moved = await tx.refund.updateMany({
        where: { id: refundId, status: 'APPROVED' },
        data: { status: 'COMPLETED', providerRefundRef: bankReference, processedAt: now },
      });
      if (moved.count !== 1) {
        throw DomainErrors.conflict('وضعیت این درخواست هم‌زمان تغییر کرد.', `Refund ${refundId} changed concurrently`);
      }

      if (refund.paymentId !== null) {
        await tx.payment.updateMany({
          where: { id: refund.paymentId, status: 'REFUND_PENDING' },
          data: { status: 'REFUNDED' },
        });
        /* The second capture this refund answered is settled. */
        await tx.reconciliationIssue.updateMany({
          where: {
            paymentId: refund.paymentId,
            type: 'duplicate_payment',
            status: { in: ['OPEN', 'INVESTIGATING'] },
          },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            resolvedByStaffId: staff.staffId,
            resolutionNote: 'Refund completed',
            openDedupeKey: null,
          },
        });
      }

      if (!CAPTURE_REFUND_REASONS.has(refund.reason) && refund.order.status === 'REFUND_PENDING') {
        await this.orderStates.transition(
          { id: refund.order.id, orderNumber: refund.order.orderNumber, status: refund.order.status },
          'REFUNDED',
          { id: staff.staffId, type: 'STAFF', role: staff.role },
          'refund completed',
          { db: tx as unknown as OrdersDatabaseCore, context: { refundId } },
        );
      }
    });
    await this.record(staff, 'REFUND_COMPLETED', refundId, { bankReference });
    return this.get(refundId);
  }

  /**
   * A request that will not be paid. Only before approval, and never for a
   * second capture: that money is not ours to keep.
   */
  async reject(refundId: string, reason: string, staff: AuthenticatedStaff): Promise<StaffRefundDto> {
    await this.db.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        include: { order: { select: { id: true, orderNumber: true, status: true } } },
      });
      if (refund === null) throw DomainErrors.notFound('Refund');
      if (refund.status === 'REJECTED') return;
      if (refund.status !== 'REQUESTED') {
        throw DomainErrors.conflict('فقط درخواست تأییدنشده را می‌توان رد کرد.', `Refund ${refundId} is ${refund.status}`);
      }
      if (CAPTURE_REFUND_REASONS.has(refund.reason)) {
        throw DomainErrors.conflict(
          'مبلغ پرداخت تکراری باید به مشتری بازگردانده شود و این درخواست قابل رد نیست.',
          `Refund ${refundId} returns a second capture`,
        );
      }

      const moved = await tx.refund.updateMany({
        where: { id: refundId, status: 'REQUESTED' },
        data: { status: 'REJECTED', processedAt: new Date() },
      });
      if (moved.count !== 1) {
        throw DomainErrors.conflict('وضعیت این درخواست هم‌زمان تغییر کرد.', `Refund ${refundId} changed concurrently`);
      }
      if (refund.order.status === 'REFUND_PENDING') {
        await this.orderStates.transition(
          { id: refund.order.id, orderNumber: refund.order.orderNumber, status: refund.order.status },
          'REVIEW_REQUIRED',
          { id: staff.staffId, type: 'STAFF', role: staff.role },
          'refund rejected',
          { db: tx as unknown as OrdersDatabaseCore, context: { refundId } },
        );
      }
    });
    await this.record(staff, 'REFUND_REJECTED', refundId, { reason });
    return this.get(refundId);
  }

  private async get(refundId: string): Promise<StaffRefundDto> {
    const row = await this.db.refund.findUnique({ where: { id: refundId }, include: REFUND_INCLUDE });
    if (row === null) throw DomainErrors.notFound('Refund');
    return toDto(row);
  }

  private async record(
    staff: AuthenticatedStaff,
    action: string,
    refundId: string,
    after: Record<string, string>,
  ): Promise<void> {
    if (this.audit === undefined) return;
    await this.audit.record({
      actor: staff.staffId,
      actorType: 'STAFF',
      action,
      entity: 'Refund',
      entityId: refundId,
      after,
    });
  }
}

function toDto(row: RefundRow): StaffRefundDto {
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    orderStatus: row.order.status as OrderStatus,
    paymentId: row.paymentId,
    paymentStatus: (row.payment?.status ?? null) as PaymentStatus | null,
    provider: row.payment?.provider ?? null,
    amountIrr: row.amountIrr.toString() as StaffRefundDto['amountIrr'],
    reason: row.reason,
    status: row.status as RefundStatus,
    requestedByStaffId: row.requestedByStaffId,
    requestedByName: row.requestedBy?.fullName ?? null,
    approvedByStaffId: row.approvedByStaffId,
    approvedByName: row.approvedBy?.fullName ?? null,
    bankReference: row.providerRefundRef,
    requestedAt: row.requestedAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}
