import type { z } from "zod";
import type {
  AcceptQuoteResponse,
  CreateOrderResponse,
  CreatePaymentResponse,
  CreateQuoteRequest,
  CreateQuoteResponse,
  QuoteSnapshot,
  VerifyPaymentResponse,
} from "@barat/contracts";
import {
  acceptQuoteResponseSchema,
  createOrderResponseSchema,
  createPaymentResponseSchema,
  createQuoteResponseSchema,
  verifyPaymentResponseSchema,
} from "@barat/contracts";
import { formatToman } from "@barat/ui";
import { ApiClientError, api } from "@/lib/api";

/**
 * The money path's client calls.
 *
 * Quote acceptance, order creation and payment creation all have to carry an
 * `Idempotency-Key` HTTP header — the API's `IdempotencyHeaderInterceptor`
 * rejects the request outright when it is missing on POST /api/orders — so they
 * go through `api.post`'s header argument rather than a second HTTP client.
 */

/** Mirrors `IDEMPOTENCY_KEY_PATTERN` in the API's interceptor. */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/u;

/**
 * A key derived from the entity it protects rather than from a random draw, so
 * a double click, a refresh mid-submit and a retry in a second tab all resolve
 * to the same key and therefore to the same order.
 */
export function idempotencyKeyFor(scope: string, ...parts: readonly string[]): string {
  const raw = [scope, ...parts].join("-").replace(/[^A-Za-z0-9_-]/gu, "-");
  return raw.length < 16 ? raw.padEnd(16, "0") : raw.slice(0, 64);
}

function idempotentPost<T>(path: string, payload: unknown, idempotencyKey: string, schema: z.ZodType<T>): Promise<T> {
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new ApiClientError(400, "کلید یکتای درخواست معتبر نیست.", "VALIDATION_ERROR");
  }
  return api.post<T>(path, payload, schema, { "Idempotency-Key": idempotencyKey });
}

export function createQuote(payload: CreateQuoteRequest): Promise<CreateQuoteResponse> {
  return api.post<CreateQuoteResponse>("/api/quotes", payload, createQuoteResponseSchema);
}

/**
 * Freeze the quote the customer is looking at. `acknowledgedAmountIrr` is the
 * amount that was on screen: the server refuses the acceptance if it no longer
 * matches the stored snapshot, which is what makes a silent reprice impossible.
 */
export function acceptQuote(quote: QuoteSnapshot): Promise<AcceptQuoteResponse> {
  const key = idempotencyKeyFor("accept", quote.id);
  return idempotentPost(`/api/quotes/${encodeURIComponent(quote.id)}/accept`, { quoteId: quote.id, idempotencyKey: key, acknowledgedAmountIrr: quote.finalAmountIrr }, key, acceptQuoteResponseSchema);
}

export function createOrder(quote: QuoteSnapshot): Promise<CreateOrderResponse> {
  return idempotentPost("/api/orders", { quoteId: quote.id, acknowledgedAmountIrr: quote.finalAmountIrr }, idempotencyKeyFor("order", quote.id), createOrderResponseSchema);
}

export function createPayment(orderId: string, attempt: string): Promise<CreatePaymentResponse> {
  const key = idempotencyKeyFor("pay", orderId, attempt);
  return idempotentPost("/api/payments", { orderId, idempotencyKey: key }, key, createPaymentResponseSchema);
}

/**
 * The only authority on whether a payment succeeded. Callback query parameters
 * are never consulted for the outcome — they only say which payment to ask about.
 */
export function verifyPayment(paymentId: string): Promise<VerifyPaymentResponse> {
  const key = idempotencyKeyFor("verify", paymentId);
  return idempotentPost(`/api/payments/${encodeURIComponent(paymentId)}/verify`, { idempotencyKey: key }, key, verifyPaymentResponseSchema);
}

/* ============================================================================
 * Payment attempt tokens
 * ==========================================================================*/

const ATTEMPT_STORAGE_PREFIX = "barat.payment-attempt.";

/**
 * A payment attempt token, stable across reloads of the same attempt.
 *
 * The idempotency key cannot be derived from the order id alone: a customer
 * whose first payment failed must be able to start a genuinely new gateway
 * session, and replaying the old key would hand them back the failed one.
 * The token is an opaque random string — nothing about the payment is stored.
 */
export function paymentAttempt(orderId: string): string {
  const storageKey = `${ATTEMPT_STORAGE_PREFIX}${orderId}`;
  const existing = readSession(storageKey);
  if (existing !== null) return existing;
  const token = randomToken();
  writeSession(storageKey, token);
  return token;
}

/** Called when the customer explicitly retries after a failed payment. */
export function resetPaymentAttempt(orderId: string): void {
  try {
    window.sessionStorage.removeItem(`${ATTEMPT_STORAGE_PREFIX}${orderId}`);
  } catch {
    /* Private browsing modes can refuse storage; a fresh token is then used. */
  }
}

function readSession(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    return value !== null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* Ignored: the attempt still works, it just is not stable across reloads. */
  }
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/gu, "");
}

/* ============================================================================
 * Presentation helpers
 * ==========================================================================*/

/**
 * IRR arrives as a decimal string because it is a BigInt server-side. It goes
 * to `BigInt`, never to `Number` — a 64-bit rial total loses precision as a
 * double, and that is a financial bug, not a rounding nit.
 */
export function tomanFromIrr(irr: string): string {
  return formatToman(BigInt(irr));
}

/**
 * Where to send the browser to pay, or `null` when there is nowhere to send it.
 *
 * Hosts under the RFC 2606 / RFC 6761 reserved test suffixes are guaranteed not
 * to resolve, so a gateway adapter that hands one back is telling us it has no
 * hosted page — the flow then continues straight to server-side verification
 * instead of navigating the customer into a DNS error. This is a property of
 * the URL, not of any particular provider.
 */
const RESERVED_TEST_SUFFIXES = [".invalid", ".test", ".example", ".localhost"] as const;

export function gatewayDestination(redirectUrl: string): string | null {
  if (redirectUrl === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  if (RESERVED_TEST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  return parsed.toString();
}

/** Persian message plus whether the customer should be offered a fresh price. */
export interface PurchaseError {
  readonly message: string;
  readonly requoteRequired: boolean;
}

export function purchaseError(error: unknown): PurchaseError {
  if (error instanceof ApiClientError) {
    return { message: error.message, requoteRequired: error.code === "QUOTE_EXPIRED" || error.code === "AMOUNT_MISMATCH" };
  }
  return { message: "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید.", requoteRequired: false };
}
