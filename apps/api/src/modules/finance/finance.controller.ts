import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import { prisma } from '@barat/database';
import { Roles } from '../identity/rbac/roles.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';

/** No Prisma dependency means this lives outside any module and avoids the
 * frozen app.module.ts. One Prisma read-only call is the right amount of coupling. */

/**
 * A real calendar day. The bare pattern accepted `2026-13-45`, which became an
 * Invalid Date, reached Prisma, and came back as a 500 rather than a 400.
 */
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Not a valid calendar date');

export const refundQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
  })
  /* ISO dates compare correctly as strings. */
  .refine((query) => query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });
type RefundQuery = z.infer<typeof refundQuerySchema>;

/**
 * The operational calendar, matching `REPORT_ZONE_OFFSET` in the admin's
 * `report-filters.ts`. Both sides must cut the day at the same instant or a
 * refund requested between midnight and 03:30 Tehran lands in the orders of one
 * day and the refunds of another, and the two totals stop reconciling.
 */
const REPORT_ZONE_OFFSET = '+03:30';

/**
 * Who may read the refund ledger.
 *
 * Mirrors `REPORT_ROLES` in the admin app, which is what gates the reports page
 * itself. FINANCE is the role that exists to read this, so leaving it out makes
 * the page load and the one number on it 403.
 */
@Roles('ADMIN', 'MANAGEMENT', 'FINANCE')
@Controller('admin/finance')
export class FinanceController {
  /**
   * Lists refund records within a date range for the finance report.
   *
   * Filtered by `requestedAt`: the moment an operator committed to returning
   * the money, which is the date the order it belongs to is reported under. A
   * refund approved weeks later still belongs to the day it was decided.
   */
  @Get('refunds')
  async getRefunds(
    @Query(zodPipe(refundQuerySchema)) query: RefundQuery,
  ): Promise<{ refunds: RefundRecord[]; totalIrr: string; count: number }> {
    /* Half-open [from, nextDayAfterTo) in Tehran time: an inclusive `lte` on a
     * .999 millisecond drops a row stamped in the final microsecond of the day,
     * which Postgres stores and JavaScript cannot represent. */
    const from = new Date(`${query.from}T00:00:00.000${REPORT_ZONE_OFFSET}`);
    const toExclusive = new Date(
      new Date(`${query.to}T00:00:00.000${REPORT_ZONE_OFFSET}`).getTime() + 86_400_000,
    );

    const rows = await prisma.refund.findMany({
      where: {
        requestedAt: { gte: from, lt: toExclusive },
      },
      orderBy: { requestedAt: 'asc' },
      select: {
        id: true,
        orderId: true,
        amountIrr: true,
        status: true,
        reason: true,
        requestedAt: true,
        requestedBy: { select: { fullName: true } },
      },
    });

    const totalIrr = rows.reduce((sum, r) => sum + r.amountIrr, 0n);
    return {
      refunds: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        amountIrr: r.amountIrr.toString(),
        status: r.status,
        reason: r.reason,
        requestedAt: r.requestedAt.toISOString(),
        requestedBy: r.requestedBy?.fullName ?? null,
      })),
      totalIrr: totalIrr.toString(),
      count: rows.length,
    };
  }
}

interface RefundRecord {
  id: string;
  orderId: string;
  amountIrr: string;
  status: string;
  reason: string;
  requestedAt: string;
  requestedBy: string | null;
}
