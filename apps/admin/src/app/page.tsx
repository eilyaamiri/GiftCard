import { redirect } from "next/navigation";
import { landingPathForRole } from "@/lib/api";
import { getSession } from "@/lib/session";

/**
 * An unconditional redirect to /dashboard sent an OPERATOR straight into a
 * 307-to-/login?reason=forbidden bounce, since /dashboard requires a
 * back-office role. Ask the session which home the role actually has.
 */
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? landingPathForRole(session.role) : "/login");
}
