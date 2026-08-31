import { requireSession } from "@/lib/session";

/**
 * The real gate for /account.
 *
 * middleware.ts only proves a cookie is present; this asks the API who that
 * cookie belongs to, and every /api/account/* call underneath re-decides
 * ownership on its own. A forged cookie never gets past here.
 */
export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireSession();
  return children;
}
