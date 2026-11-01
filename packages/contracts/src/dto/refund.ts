import { z } from 'zod';

import { paymentStatusSchema, orderStatusSchema } from '../enums/commerce';
import { refundStatusSchema } from '../enums/finance';
import { positiveIrrStringSchema } from '../money/schemas';
import { idSchema, isoDateTimeSchema } from './common';

/* ============================================================================
 * Staff refund queue  — /api/admin/refunds
 *
 * A refund is money leaving the business, so it takes two people: whoever
 * requested it cannot approve it, and nothing is marked returned until finance
 * records the bank reference of the transfer that returned it.
 * ==========================================================================*/

export const staffRefundDtoSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  orderNumber: z.string().min(1),
  orderStatus: orderStatusSchema,
  paymentId: idSchema.nullable(),
  paymentStatus: paymentStatusSchema.nullable(),
  provider: z.string().nullable(),
  amountIrr: positiveIrrStringSchema,
  reason: z.string(),
  status: refundStatusSchema,
  requestedByStaffId: idSchema.nullable(),
  requestedByName: z.string().nullable(),
  approvedByStaffId: idSchema.nullable(),
  approvedByName: z.string().nullable(),
  bankReference: z.string().nullable(),
  requestedAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable(),
});
export type StaffRefundDto = z.infer<typeof staffRefundDtoSchema>;

export const listRefundsQuerySchema = z.object({
  /** Defaults to the open queue: REQUESTED and APPROVED. */
  status: refundStatusSchema.optional(),
});
export type ListRefundsQuery = z.infer<typeof listRefundsQuerySchema>;

export const listRefundsResponseSchema = z.object({
  items: z.array(staffRefundDtoSchema),
});
export type ListRefundsResponse = z.infer<typeof listRefundsResponseSchema>;

/**
 * Finance has sent the money back by bank transfer. The transfer's reference
 * is required: it is the evidence that ties this row to the bank statement.
 */
export const completeRefundRequestSchema = z.object({
  bankReference: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9\-_/]+$/u, 'bankReference must be the bank transfer reference'),
});
export type CompleteRefundRequest = z.infer<typeof completeRefundRequestSchema>;

export const rejectRefundRequestSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});
export type RejectRefundRequest = z.infer<typeof rejectRefundRequestSchema>;
