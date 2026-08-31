import { z } from "zod";
import {
  customerDtoSchema,
  isoDateTimeSchema,
  paymentStatusSchema,
} from "@barat/contracts";
import { api } from "@/lib/api";

const nullableDate = isoDateTimeSchema.nullable();

export const customerSearchHitSchema = z.object({
  customerId: z.string().min(1),
  customerCode: z.string().min(1),
  status: customerDtoSchema.shape.status,
  maskedMobile: z.string().nullable(),
  maskedEmail: z.string().nullable(),
  fullName: z.string().nullable(),
  orderCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  matchedOn: z.enum(["CUSTOMER_CODE", "MOBILE", "EMAIL", "NAME", "ORDER_NUMBER", "PAYMENT_REF"]),
});

const accountOrderSchema = z.object({
  id: z.string().min(1), orderNumber: z.string(), status: z.string(),
  totalAmountIrr: z.string().regex(/^\d+$/u), displayAmountToman: z.string().regex(/^\d+$/u),
  currency: z.string(), createdAt: isoDateTimeSchema, paidAt: nullableDate, fulfilledAt: nullableDate,
});
const accountPaymentSchema = z.object({
  id: z.string().min(1), orderId: z.string(), orderNumber: z.string(), provider: z.string(),
  status: paymentStatusSchema, amountIrr: z.string().regex(/^\d+$/u), displayAmountToman: z.string().regex(/^\d+$/u),
  providerRefId: z.string().nullable(), maskedCard: z.string().nullable(), createdAt: isoDateTimeSchema, verifiedAt: nullableDate,
});
const accountRefundSchema = z.object({
  id: z.string().min(1), orderId: z.string(), orderNumber: z.string(), amountIrr: z.string().regex(/^\d+$/u),
  status: z.string(), requestedAt: isoDateTimeSchema, processedAt: nullableDate,
});

export const customer360Schema = z.object({
  customer: customerDtoSchema,
  profile: z.object({ preferredLanguage: z.string(), marketingOptIn: z.boolean() }),
  flags: z.array(z.object({ key: z.string(), reason: z.string().nullable(), createdAt: isoDateTimeSchema, expiresAt: nullableDate })),
  notes: z.array(z.object({ id: z.string(), body: z.string(), isPinned: z.boolean(), authorStaffId: z.string().nullable(), createdAt: isoDateTimeSchema })),
  orders: z.array(accountOrderSchema),
  payments: z.array(accountPaymentSchema),
  refunds: z.array(accountRefundSchema),
  tickets: z.array(z.object({
    id: z.string().min(1), workItemId: z.string().min(1), code: z.string(), subject: z.string(), status: z.string(),
    orderId: z.string().nullable(), orderNumber: z.string().nullable(), ownerStaffId: z.string().nullable(), ownerStaffName: z.string().nullable(),
    createdAt: isoDateTimeSchema, firstResponseDueAt: isoDateTimeSchema, nextResponseDueAt: isoDateTimeSchema,
    firstRespondedAt: nullableDate, lastRespondedAt: nullableDate,
  })),
  totals: z.object({ orderCount: z.number().int().nonnegative(), paidOrderCount: z.number().int().nonnegative(), lifetimePaidIrr: z.string().regex(/^\d+$/u) }),
});

const customerSearchResponseSchema = z.object({
  items: z.array(customerSearchHitSchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() }),
});
const noteSchema = customer360Schema.shape.notes.element;

export type CustomerSearchHit = z.infer<typeof customerSearchHitSchema>;
export type Customer360 = z.infer<typeof customer360Schema>;

export function searchCustomers(kind: "query" | "orderNumber" | "paymentRef", value: string) {
  const params = new URLSearchParams({ [kind]: value, page: "1", pageSize: "50" });
  return api.get(`/api/customers/search?${params.toString()}`, customerSearchResponseSchema);
}

export function fetchCustomer360(customerId: string) {
  return api.get(`/api/customers/${encodeURIComponent(customerId)}`, customer360Schema);
}

export function addCustomerNote(customerId: string, body: string, isPinned: boolean) {
  return api.post(`/api/customers/${encodeURIComponent(customerId)}/notes`, { body, isPinned }, noteSchema);
}
