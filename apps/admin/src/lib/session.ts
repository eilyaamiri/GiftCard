import { cache } from "react";
import { redirect } from "next/navigation";
import type { StaffRole } from "@barat/contracts";
import { ApiClientError, api, hasRole, type StaffUser } from "@/lib/api";

/**
 * Server-side staff session. The identity comes from the API, never from a
 * cookie the browser could have edited — the cookie is an opaque JWT we only
 * ever hand back to the server that issued it.
 *
 * `cache` collapses the repeated /me calls a single render makes (layout guard
 * plus every page-level role check) into one request.
 */
export const getSession = cache(async (): Promise<StaffUser | null> => {
  try {
    return await api.staffMe();
  } catch (error) {
    if (error instanceof ApiClientError && (error.isUnauthenticated || error.isForbidden)) return null;
    // A network or schema failure is not "logged out"; surfacing it beats
    // bouncing an authenticated operator to the login form during an outage.
    throw error;
  }
});

export async function requireSession(): Promise<StaffUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Page-level gate for the other panels. Redirects rather than rendering an
 * error so a wrong-role deep link never paints panel chrome. The API refuses
 * the same call independently — this only decides what gets drawn.
 */
export async function requireRole(allowed: readonly StaffRole[]): Promise<StaffUser> {
  const session = await requireSession();
  if (!hasRole(session.role, allowed)) redirect("/login?reason=forbidden");
  return session;
}
