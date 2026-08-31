import { cache } from "react";
import { redirect } from "next/navigation";
import type { CustomerDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";

/**
 * The customer session, resolved by asking the API who the forwarded cookie
 * belongs to. `cache` collapses the fan-out: a layout and three server
 * components on the same render share one /api/auth/me call.
 *
 * A transport or schema failure is rethrown rather than swallowed — pretending
 * "signed out" on a network blip would bounce a signed-in customer to /login and
 * hide a real outage.
 */
export const getSession = cache(async (): Promise<CustomerDto | null> => {
  try {
    const result = await api.me();
    return result.isAuthenticated ? result.customer : null;
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
});

/**
 * Gate a server component on a real session. The API re-checks authorisation on
 * every /api/account/* call regardless; this only decides what to render.
 */
export async function requireSession(nextPath?: string): Promise<CustomerDto> {
  const customer = await getSession();
  if (!customer) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return customer;
}

/** Display name for a customer who may not have completed their profile yet. */
export function customerDisplayName(customer: CustomerDto): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return name || customer.maskedMobile || customer.maskedEmail || customer.customerCode;
}
