import { z } from "zod";
import type { LogoutResponse, StaffRole } from "@barat/contracts";
import { emailSchema, isoDateTimeSchema, logoutResponseSchema, staffRoleSchema } from "@barat/contracts";

/**
 * Empty is the intended default: the browser calls `/api/...` on its own origin,
 * which is the only way a SameSite=Strict staff session cookie is ever sent.
 * nginx routes it in production and a dev rewrite does the same locally.
 *
 * Server components have no origin of their own, so they need an absolute
 * address — the internal container one when it is configured.
 */
const BROWSER_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const SERVER_API_URL = process.env.API_INTERNAL_URL || BROWSER_API_URL || "http://localhost:4000";

/** Set by POST /api/auth/staff/login. HttpOnly — never readable from JS. */
export const STAFF_SESSION_COOKIE = "barat_staff_session";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

const isServer = typeof window === "undefined";

/**
 * A server component's fetch carries no cookies of its own, so the incoming
 * request's cookie header has to be replayed by hand or every RSC call is 401.
 */
async function forwardedCookieHeader(): Promise<Record<string, string>> {
  if (!isServer) return {};
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const header = store.toString();
  return header ? { cookie: header } : {};
}

async function request<T>(path: string, init?: RequestInit, schema?: z.ZodType<T>): Promise<T> {
  const base = (isServer ? SERVER_API_URL : BROWSER_API_URL).replace(/\/$/, "");
  const headers = new Headers(init?.headers);
  /* The browser must supply the multipart boundary for FormData. Setting
   * Content-Type here would omit it and make Nest see no uploaded file. */
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const forwarded = await forwardedCookieHeader();
  for (const [key, value] of Object.entries(forwarded)) headers.set(key, value);
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const message = typeof envelope["message"] === "string" ? envelope["message"] : "ارتباط با سرویس ممکن نیست";
    const code = typeof envelope["code"] === "string" ? envelope["code"] : undefined;
    throw new ApiClientError(response.status, message, code);
  }
  return schema ? schema.parse(body) : (body as T);
}

/* ============================================================================
 * Staff session contracts
 *
 * @barat/contracts has no staff-auth DTO yet, so the shapes below are pinned to
 * the live responses of /api/auth/staff/{login,me,logout}. The role enum and the
 * logout envelope are reused from the package rather than restated.
 * ==========================================================================*/

export const staffUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: staffRoleSchema,
});
export type StaffUser = z.infer<typeof staffUserSchema>;

export const staffLoginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "گذرواژه باید حداقل ۸ نویسه باشد."),
});
export type StaffLoginRequest = z.infer<typeof staffLoginRequestSchema>;

export const staffLoginResponseSchema = staffUserSchema.extend({
  fullName: z.string(),
  expiresAt: isoDateTimeSchema,
});
export type StaffLoginResponse = z.infer<typeof staffLoginResponseSchema>;

export const api = {
  staffLogin: (payload: StaffLoginRequest) =>
    request<StaffLoginResponse>(
      "/api/auth/staff/login",
      { method: "POST", body: JSON.stringify(payload) },
      staffLoginResponseSchema,
    ),
  staffMe: () => request<StaffUser>("/api/auth/staff/me", undefined, staffUserSchema),
  staffLogout: () =>
    request<LogoutResponse>("/api/auth/staff/logout", { method: "POST" }, logoutResponseSchema),

  get: <T>(path: string, schema?: z.ZodType<T>) => request<T>(path, undefined, schema),
  post: <T>(path: string, payload?: unknown, schema?: z.ZodType<T>) =>
    request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) }, schema),
  patch: <T>(path: string, payload?: unknown, schema?: z.ZodType<T>) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(payload ?? {}) }, schema),
  put: <T>(path: string, payload?: unknown, schema?: z.ZodType<T>) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(payload ?? {}) }, schema),
  uploadProductImage: (productId: string, file: File) => {
    const form = new FormData();
    form.append("image", file);
    return request<unknown>(`/api/admin/catalog/products/${productId}/image`, {
      method: "POST",
      body: form,
    });
  },
  del: <T>(path: string, schema?: z.ZodType<T>) => request<T>(path, { method: "DELETE" }, schema),
};

/* ============================================================================
 * Role vocabulary
 *
 * Everything here is presentation and routing only. The API re-decides every
 * one of these questions on its own; a helper that returns `true` grants nothing.
 * ==========================================================================*/

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  ADMIN: "مدیر سیستم",
  MANAGEMENT: "مدیریت ارشد",
  OPS_MANAGER: "مدیر عملیات",
  OPERATOR: "اپراتور",
  FINANCE: "مالی",
  SUPPORT: "پشتیبانی",
  VIEWER: "بازدیدکننده",
};

/** Roles whose home is the back-office panel rather than the operator desk. */
export const BACK_OFFICE_ROLES = [
  "ADMIN",
  "MANAGEMENT",
  "OPS_MANAGER",
  "FINANCE",
  "SUPPORT",
  "VIEWER",
] as const satisfies readonly StaffRole[];

export const OPERATOR_ROLES = ["ADMIN", "OPS_MANAGER", "OPERATOR"] as const satisfies readonly StaffRole[];

/**
 * Operators run fulfilment, never money: no FX rate edits, no pricing rules, no
 * payment status changes, no order amount edits, no refunds.
 */
export const FINANCIAL_WRITE_ROLES = ["ADMIN", "MANAGEMENT", "FINANCE"] as const satisfies readonly StaffRole[];

/** Catalog, services and suppliers are one editorial surface with one gate. */
export const CATALOG_WRITE_ROLES = ["ADMIN", "OPS_MANAGER"] as const satisfies readonly StaffRole[];

export const QUEUE_VIEW_ROLES = ["ADMIN", "MANAGEMENT", "OPS_MANAGER"] as const satisfies readonly StaffRole[];

export const AUDIT_ROLES = ["ADMIN", "MANAGEMENT"] as const satisfies readonly StaffRole[];

export function hasRole(role: StaffRole | null | undefined, allowed: readonly StaffRole[]): boolean {
  return role != null && allowed.includes(role);
}

export function canWriteFinancials(role: StaffRole | null | undefined): boolean {
  return hasRole(role, FINANCIAL_WRITE_ROLES);
}

export function landingPathForRole(role: StaffRole): string {
  return role === "OPERATOR" ? "/operator" : "/dashboard";
}
