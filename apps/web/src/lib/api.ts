import type { z } from "zod";
import type { ListProductsResponse, GetProductResponse, ListServicesResponse, GetQuoteResponse, GetOrderResponse, MeResponse, RequestOtpResponse } from "@barat/contracts";
import { listProductsResponseSchema, getProductResponseSchema, listServicesResponseSchema, getQuoteResponseSchema, getOrderResponseSchema, meResponseSchema, requestOtpResponseSchema } from "@barat/contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export class ApiClientError extends Error { constructor(public readonly status: number, message: string) { super(message); this.name = "ApiClientError"; } }
async function request<T>(path: string, init?: RequestInit, schema?: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${API_URL.replace(/\/$/, "")}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, credentials: "include", cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) { const message = typeof body === "object" && body && "message" in body && typeof body.message === "string" ? body.message : "ارتباط با سرویس ممکن نیست"; throw new ApiClientError(response.status, message); }
  return schema ? schema.parse(body) : body as T;
}
export const api = {
  products: (query = "") => request<ListProductsResponse>(`/api/catalog/products${query ? `?${query}` : ""}`, undefined, listProductsResponseSchema),
  product: (slug: string) => request<GetProductResponse>(`/api/catalog/products/${encodeURIComponent(slug)}`, undefined, getProductResponseSchema),
  services: () => request<ListServicesResponse>("/api/catalog/services", undefined, listServicesResponseSchema),
  quote: (id: string) => request<GetQuoteResponse>(`/api/quotes/${encodeURIComponent(id)}`, undefined, getQuoteResponseSchema),
  order: (number: string) => request<GetOrderResponse>(`/api/orders/${encodeURIComponent(number)}`, undefined, getOrderResponseSchema),
  me: () => request<MeResponse>("/api/auth/me", undefined, meResponseSchema),
  requestOtp: (payload: unknown) => request<RequestOtpResponse>("/api/auth/otp/request", { method: "POST", body: JSON.stringify(payload) }, requestOtpResponseSchema),
  post: <T>(path: string, payload: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(payload) }),
};
