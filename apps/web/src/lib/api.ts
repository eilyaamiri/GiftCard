import { z } from "zod";
import type { CustomerDto, ListProductsResponse, GetProductResponse, ListServicesResponse, GetQuoteResponse, GetOrderResponse, LogoutResponse, MeResponse, RequestOtpRequest, RequestOtpResponse, VerifyOtpRequest, VerifyOtpResponse } from "@barat/contracts";
import { listProductsResponseSchema, getProductResponseSchema, listServicesResponseSchema, getQuoteResponseSchema, getOrderResponseSchema, logoutResponseSchema, meResponseSchema, requestOtpResponseSchema, verifyOtpResponseSchema, customerDtoSchema, idSchema, isoDateTimeSchema, orderStatusSchema, paymentStatusSchema, positiveIrrStringSchema, currencyCodeSchema } from "@barat/contracts";

/**
 * Empty is the intended default: the browser calls `/api/...` on its own origin,
 * which is the only way the Secure/SameSite=Lax session cookie is ever sent and
 * the only shape the API's CORS allowlist accepts. nginx routes it in
 * production and a dev rewrite does the same locally.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * A server component has no origin of its own, so it needs an absolute address.
 * `API_INTERNAL_URL` lets a container reach the API over the private network
 * without that hostname ever reaching the browser bundle.
 */
const SERVER_API_URL = process.env.API_INTERNAL_URL || API_URL || "http://localhost:4000";

/** Set by POST /api/auth/otp/verify. HttpOnly — never readable from JS. */
export const AUTH_SESSION_COOKIE = "barat_session";

export class ApiClientError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); this.name = "ApiClientError"; }

  get isUnauthenticated(): boolean { return this.status === 401; }
  get isNotFound(): boolean { return this.status === 404; }
  /** The API uses 409 for OTP cooldown / bad-or-expired code, 429 for throttling. */
  get isRateLimited(): boolean { return this.status === 429; }
}

const isServer = typeof window === "undefined";

/**
 * A server component's fetch carries no cookies of its own, so the incoming
 * request's cookie header has to be replayed by hand or every RSC call is 401.
 */
async function forwardedCookieHeader(): Promise<Record<string, string>> {
  if (!isServer) return {};
  const { cookies } = await import("next/headers");
  const header = (await cookies()).toString();
  return header ? { cookie: header } : {};
}

async function request<T>(path: string, init?: RequestInit, schema?: z.ZodType<T>): Promise<T> {
  const base = (isServer ? SERVER_API_URL : API_URL).replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(await forwardedCookieHeader()), ...init?.headers }, credentials: "include", cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const message = typeof envelope["message"] === "string" ? envelope["message"] : "ارتباط با سرویس ممکن نیست";
    const code = typeof envelope["code"] === "string" ? envelope["code"] : undefined;
    throw new ApiClientError(response.status, message, code);
  }
  return schema ? schema.parse(body) : body as T;
}

/* ============================================================================
 * Account contracts
 *
 * packages/contracts stops at /api/auth; the /api/account/* DTOs live only in
 * apps/api. The shapes below are pinned to the live responses and reuse the
 * package's primitives rather than restating them, so a drift in the money or
 * date representation fails here instead of silently rendering wrong.
 * ==========================================================================*/

const pageMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

function pagedSchema<TItem>(item: z.ZodType<TItem>) {
  return z.object({ items: z.array(item), meta: pageMetaSchema });
}

export const accountProfileSchema = z.object({
  customer: customerDtoSchema,
  preferredLanguage: z.string(),
  marketingOptIn: z.boolean(),
  /** True until first and last name are present; checkout is gated on it. */
  requiresProfileCompletion: z.boolean(),
  updatedAt: isoDateTimeSchema,
});
export type AccountProfile = z.infer<typeof accountProfileSchema>;

export const updateAccountProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(60).nullable().optional(),
  lastName: z.string().trim().min(1).max(60).nullable().optional(),
  preferredLanguage: z.enum(["fa", "en"]).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type UpdateAccountProfile = z.infer<typeof updateAccountProfileSchema>;

export const accountOrderSchema = z.object({
  id: idSchema,
  orderNumber: z.string().min(1),
  status: orderStatusSchema,
  /** Rial, as a digit string. Never parse it into a JS number. */
  totalAmountIrr: positiveIrrStringSchema,
  displayAmountToman: z.string(),
  currency: currencyCodeSchema,
  createdAt: isoDateTimeSchema,
  paidAt: isoDateTimeSchema.nullable(),
  fulfilledAt: isoDateTimeSchema.nullable(),
});
export type AccountOrder = z.infer<typeof accountOrderSchema>;

export const accountPaymentSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  orderNumber: z.string().min(1),
  provider: z.string(),
  status: paymentStatusSchema,
  amountIrr: positiveIrrStringSchema,
  displayAmountToman: z.string(),
  providerRefId: z.string().nullable(),
  maskedCard: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  verifiedAt: isoDateTimeSchema.nullable(),
});
export type AccountPayment = z.infer<typeof accountPaymentSchema>;

export const REFUND_STATUS_VALUES = ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED", "FAILED"] as const;
export type AccountRefundStatus = (typeof REFUND_STATUS_VALUES)[number];

export const accountRefundSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  orderNumber: z.string().min(1),
  amountIrr: positiveIrrStringSchema,
  status: z.enum(REFUND_STATUS_VALUES),
  requestedAt: isoDateTimeSchema,
  processedAt: isoDateTimeSchema.nullable(),
});
export type AccountRefund = z.infer<typeof accountRefundSchema>;

export const supportTicketSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  subject: z.string(),
  status: z.string(),
  orderId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  resolutionNote: z.string().nullable(),
});
export type SupportTicket = z.infer<typeof supportTicketSchema>;

export const createSupportRequestSchema = z.object({
  orderId: z.string().min(1).max(64).optional(),
  subject: z.string().trim().min(3, "موضوع باید حداقل ۳ نویسه باشد.").max(120),
  message: z.string().trim().min(3, "متن پیام باید حداقل ۳ نویسه باشد.").max(2000),
});
export type CreateSupportRequest = z.infer<typeof createSupportRequestSchema>;

const accountOrdersSchema = pagedSchema(accountOrderSchema);
const accountPaymentsSchema = pagedSchema(accountPaymentSchema);
const accountRefundsSchema = pagedSchema(accountRefundSchema);
const supportTicketsSchema = z.array(supportTicketSchema);

export type Paged<TItem> = { readonly items: readonly TItem[]; readonly meta: z.infer<typeof pageMetaSchema> };

export type Customer = CustomerDto;

function pageQuery(params?: { readonly page?: number; readonly pageSize?: number }): string {
  const search = new URLSearchParams();
  if (params?.page) search.set("page", String(params.page));
  if (params?.pageSize) search.set("pageSize", String(params.pageSize));
  const query = search.toString();
  return query ? `?${query}` : "";
}

export const api = {
  products: (query = "") => request<ListProductsResponse>(`/api/catalog/products${query ? `?${query}` : ""}`, undefined, listProductsResponseSchema),
  product: (slug: string) => request<GetProductResponse>(`/api/catalog/products/${encodeURIComponent(slug)}`, undefined, getProductResponseSchema),
  services: () => request<ListServicesResponse>("/api/catalog/services", undefined, listServicesResponseSchema),
  quote: (id: string) => request<GetQuoteResponse>(`/api/quotes/${encodeURIComponent(id)}`, undefined, getQuoteResponseSchema),
  order: (number: string) => request<GetOrderResponse>(`/api/orders/${encodeURIComponent(number)}`, undefined, getOrderResponseSchema),
  me: () => request<MeResponse>("/api/auth/me", undefined, meResponseSchema),
  requestOtp: (payload: RequestOtpRequest | unknown) => request<RequestOtpResponse>("/api/auth/otp/request", { method: "POST", body: JSON.stringify(payload) }, requestOtpResponseSchema),
  /** The response carries a customer and a token; the session itself arrives as an HttpOnly cookie. */
  verifyOtp: (payload: VerifyOtpRequest) => request<VerifyOtpResponse>("/api/auth/otp/verify", { method: "POST", body: JSON.stringify(payload) }, verifyOtpResponseSchema),
  logout: () => request<LogoutResponse>("/api/auth/logout", { method: "POST" }, logoutResponseSchema),

  /* /api/account/* is scoped server-side to the session's own customer. No call
   * here takes a customer id — there is no parameter that could carry one. */
  accountProfile: () => request<AccountProfile>("/api/account/profile", undefined, accountProfileSchema),
  updateAccountProfile: (payload: UpdateAccountProfile) => request<AccountProfile>("/api/account/profile", { method: "PATCH", body: JSON.stringify(payload) }, accountProfileSchema),
  accountOrders: (params?: { readonly page?: number; readonly pageSize?: number }) => request<Paged<AccountOrder>>(`/api/account/orders${pageQuery(params)}`, undefined, accountOrdersSchema),
  accountOrder: (orderId: string) => request<AccountOrder>(`/api/account/orders/${encodeURIComponent(orderId)}`, undefined, accountOrderSchema),
  accountPayments: (params?: { readonly page?: number; readonly pageSize?: number }) => request<Paged<AccountPayment>>(`/api/account/payments${pageQuery(params)}`, undefined, accountPaymentsSchema),
  accountRefunds: (params?: { readonly page?: number; readonly pageSize?: number }) => request<Paged<AccountRefund>>(`/api/account/refunds${pageQuery(params)}`, undefined, accountRefundsSchema),
  supportRequests: () => request<readonly SupportTicket[]>("/api/account/support", undefined, supportTicketsSchema),
  createSupportRequest: (payload: CreateSupportRequest) => request<SupportTicket>("/api/account/support", { method: "POST", body: JSON.stringify(payload) }, supportTicketSchema),

  get: <T>(path: string, schema?: z.ZodType<T>) => request<T>(path, undefined, schema),
  /** `headers` exists for the money path: POST /api/orders is rejected outright without an `Idempotency-Key`. */
  post: <T>(path: string, payload?: unknown, schema?: z.ZodType<T>, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}), ...(headers ? { headers } : {}) }, schema),
  patch: <T>(path: string, payload?: unknown, schema?: z.ZodType<T>) => request<T>(path, { method: "PATCH", body: JSON.stringify(payload ?? {}) }, schema),
};
