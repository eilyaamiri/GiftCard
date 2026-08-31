import { z } from "zod";
import { isoDateTimeSchema, orderStatusSchema } from "@barat/contracts";
import { ApiClientError, api } from "@/lib/api";

/**
 * The read-only order header an operator needs while working a task.
 *
 * `GET /api/admin/orders/:id` admits every staff role including OPERATOR, and it
 * returns far more than this — only the fields the desk actually renders are
 * modelled, so a future field on the order can never leak into this screen by
 * accident. Amounts stay decimal strings and are formatted with BigInt helpers.
 */
export const operatorOrderSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  status: orderStatusSchema,
  totalAmountIrr: z.string(),
  currency: z.string(),
  itemTitleFa: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  paidAt: isoDateTimeSchema.nullable(),
  fulfilledAt: isoDateTimeSchema.nullable(),
  customerId: z.string().nullable(),
});
export type OperatorOrder = z.infer<typeof operatorOrderSchema>;

const orderEnvelopeSchema = z.object({ order: operatorOrderSchema });

/**
 * Returns null rather than throwing when the order cannot be read: a missing
 * order header must not blank out the task the operator has to finish.
 */
export async function loadOrderContext(orderId: string): Promise<OperatorOrder | null> {
  try {
    const { order } = await api.get(`/api/admin/orders/${encodeURIComponent(orderId)}`, orderEnvelopeSchema);
    return order;
  } catch (error) {
    if (error instanceof ApiClientError) return null;
    throw error;
  }
}
