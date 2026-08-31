import type {
  DeliveryAssetType,
  DeliveryStatus,
  GetOrderResponse,
  ListOrdersResponse,
  OrderStatus,
} from "@barat/contracts";
import { getOrderResponseSchema, listOrdersResponseSchema } from "@barat/contracts";
import { formatIrr, formatJalaliDate, formatToman, toPersianDigits } from "@barat/ui";
import { api } from "@/lib/api";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "پیش‌نویس",
  AWAITING_PAYMENT: "در انتظار پرداخت",
  PAYMENT_PENDING: "پرداخت در جریان",
  PAID: "پرداخت‌شده",
  FULFILLMENT_PENDING: "در انتظار تحویل",
  FULFILLING: "در حال تحویل",
  FULFILLED: "تحویل‌شده",
  FAILED: "ناموفق",
  REVIEW_REQUIRED: "نیازمند بررسی",
  REFUND_PENDING: "بازگشت‌وجه در جریان",
  REFUNDED: "بازگشت‌وجه شده",
  CANCELLED: "لغوشده",
};

export const ORDER_STATUS_BADGE: Record<OrderStatus, string> = {
  DRAFT: "badge-wait",
  AWAITING_PAYMENT: "badge-wait",
  PAYMENT_PENDING: "badge-wait",
  PAID: "badge-info",
  FULFILLMENT_PENDING: "badge-wait",
  FULFILLING: "badge-info",
  FULFILLED: "badge-success",
  FAILED: "badge-danger",
  REVIEW_REQUIRED: "badge-danger",
  REFUND_PENDING: "badge-wait",
  REFUNDED: "badge-wait",
  CANCELLED: "badge-danger",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  NOT_READY: "آماده نیست",
  READY: "آمادهٔ ارسال",
  SENDING: "در حال ارسال",
  SENT: "ارسال‌شده",
  DELIVERY_FAILED: "ارسال ناموفق",
};

export const DELIVERY_STATUS_BADGE: Record<DeliveryStatus, string> = {
  NOT_READY: "badge-wait",
  READY: "badge-info",
  SENDING: "badge-info",
  SENT: "badge-success",
  DELIVERY_FAILED: "badge-danger",
};

export const DELIVERY_ASSET_TYPE_LABEL: Record<DeliveryAssetType, string> = {
  CODE: "کد گیفت کارت",
  CODE_PIN: "کد به همراه پین",
  URL: "لینک بازخرید",
  PROVIDER_DIRECT_EMAIL: "ارسال مستقیم از سوی ارائه‌دهنده",
};

/**
 * Statuses the money view cares about. Everything before AWAITING_PAYMENT has
 * no payment attached, and the fulfilment-only states say nothing new about it.
 */
export const PAYMENT_RELEVANT_STATUSES = [
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
  "PAID",
  "FAILED",
  "REFUND_PENDING",
  "REFUNDED",
] as const satisfies readonly OrderStatus[];

/**
 * `Order.failureReason` is a free-form column server-side, not an enum, so this
 * map is a best effort over the codes the domain actually writes. An unmapped
 * code is shown verbatim rather than hidden — an operator reconciling a failed
 * payment needs the exact token to search the audit log for.
 */
const FAILURE_REASON_LABEL: Record<string, string> = {
  PAYMENT_VERIFY_FAILED: "صحت‌سنجی پرداخت ناموفق بود",
  CUSTOMER_CANCELLED: "لغو توسط مشتری",
  REQUEST_REJECTED: "درخواست از سوی درگاه رد شد",
  VERIFY_FAILED: "صحت‌سنجی ناموفق بود",
  INVALID_AUTHORITY: "شناسهٔ درگاه نامعتبر بود",
  AMOUNT_MISMATCH: "مغایرت مبلغ",
  PROVIDER_TIMEOUT: "پاسخ درگاه به‌موقع دریافت نشد",
  PROVIDER_NETWORK_ERROR: "خطای شبکه در ارتباط با درگاه",
  PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH: "پرداخت پیش‌تر تأیید شده بود — نیازمند تطبیق دستی",
  UNKNOWN_PROVIDER_RESPONSE: "پاسخ نامشخص از درگاه",
};

export function failureReasonLabel(reason: string | null): string {
  if (reason === null) return "—";
  return FAILURE_REASON_LABEL[reason] ?? reason;
}

export function isOrderStatus(value: string): value is OrderStatus {
  return value in ORDER_STATUS_LABEL;
}

/**
 * IRR arrives as an integer digit string because JSON has no bigint. BigInt is
 * the only exact way back — Number() would silently round anything past 2^53
 * and a rounded rial total is a financial bug, not a display glitch.
 */
export function parseIrr(wire: string): bigint {
  return BigInt(wire);
}

/**
 * Toman for humans. A rial amount that is not a whole Toman makes `formatToman`
 * throw rather than truncate, so the rial value is shown instead of losing the
 * remainder or crashing the page.
 */
export function tomanFromIrr(wire: string): string {
  const irr = parseIrr(wire);
  return irr % 10n === 0n ? formatToman(irr) : formatIrr(irr);
}

/** The stored value, for the panels that must show what is actually on record. */
export function irrLabel(wire: string): string {
  return formatIrr(parseIrr(wire));
}

export function formatDateTime(iso: string): string {
  return formatJalaliDate(iso, "yyyy/MM/dd HH:mm");
}

export function formatOptionalDateTime(iso: string | null): string {
  return iso === null ? "—" : formatDateTime(iso);
}

export function formatCount(value: number): string {
  return toPersianDigits(value.toLocaleString("en-US"));
}

/* ============================================================================
 * Data access
 *
 * Both order screens and the payment view read the same two endpoints, so the
 * query construction lives here rather than being restated per page. The list
 * filters are exactly those `adminListOrdersQuerySchema` accepts server-side;
 * anything else is dropped instead of being forwarded and rejected with a 400.
 * ==========================================================================*/

export const ORDERS_PAGE_SIZE = 20;

export interface OrdersQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly status?: OrderStatus;
  readonly search?: string;
}

/** Coerces untrusted `searchParams` into the query the API will actually accept. */
export function readOrdersQuery(
  params: Record<string, string | string[] | undefined>,
  pageSize = ORDERS_PAGE_SIZE,
): OrdersQuery {
  const first = (key: string): string | undefined => {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    return single !== undefined && single.trim() !== "" ? single.trim() : undefined;
  };

  const rawPage = Number.parseInt(first("page") ?? "1", 10);
  const status = first("status");
  const search = first("search");

  return {
    page: Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1,
    pageSize,
    ...(status !== undefined && isOrderStatus(status) ? { status } : {}),
    // The API caps `search` at 120 characters and would 400 on anything longer.
    ...(search !== undefined ? { search: search.slice(0, 120) } : {}),
  };
}

export function ordersQueryString(query: OrdersQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.status) params.set("status", query.status);
  if (query.search) params.set("search", query.search);
  return params.toString();
}

/**
 * Href for the same screen with some part of the query replaced. `null` clears a
 * filter; an absent key keeps whatever the current query has.
 */
export function ordersHref(
  basePath: string,
  query: OrdersQuery,
  overrides: { page?: number; status?: OrderStatus | null; search?: string },
): string {
  const params = new URLSearchParams();
  const status = overrides.status === undefined ? query.status : (overrides.status ?? undefined);
  const search = overrides.search === undefined ? query.search : overrides.search;
  const page = overrides.page ?? 1;
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export function fetchOrders(query: OrdersQuery): Promise<ListOrdersResponse> {
  return api.get(`/api/admin/orders?${ordersQueryString(query)}`, listOrdersResponseSchema);
}

export function fetchOrder(id: string): Promise<GetOrderResponse> {
  return api.get(`/api/admin/orders/${encodeURIComponent(id)}`, getOrderResponseSchema);
}
