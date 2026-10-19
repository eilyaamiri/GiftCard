import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';

import { prisma } from '@barat/database';
import { Roles } from '../identity/rbac/roles.decorator';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';

/** No Prisma dependency means this lives outside any module and avoids the
 * frozen app.module.ts. One Prisma read-only call is the right amount of coupling. */

const refundQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
type RefundQuery = z.infer<typeof refundQuerySchema>;

@Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER')
@Controller('admin/finance')
export class FinanceController {
  /**
   * Lists refund records within a date range for the finance report.
   * Filtered by `requestedAt` so it matches the report's own date window.
   */
  @Get('refunds')
  async getRefunds(
    @Query(zodPipe(refundQuerySchema)) query: RefundQuery,
  ): Promise<{ refunds: RefundRecord[]; totalIrr: string; count: number }> {
    const from = new Date(query.from + 'T00:00:00.000Z');
    const to = new Date(query.to + 'T23:59:59.999Z');

    const rows = await prisma.refund.findMany({
      where: {
        requestedAt: { gte: from, lte: to },
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
