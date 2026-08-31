import { requireRole } from "@/lib/session";

export const metadata = { title: "استعلام‌ها | پنل ادمین برات پی" };

/**
 * There is no admin-facing quotes endpoint.
 *
 * `GET /api/quotes/:id` is the only quote-reading route in the API
 * (`apps/api/src/modules/quotes/quotes.controller.ts`, `@Public()`), and it is
 * ownership-scoped: `QuotesService.getQuote` calls `ownsQuote(quote, actor)`,
 * which only matches a request carrying the *same customer id or commerce
 * session token* the quote was created under. A staff session resolves to
 * neither, so even the id of a specific quote returns 404 — there is no route
 * a staff session can call to list, search, or open a quote at all. Building
 * a table here would mean inventing rows, which the brief rules out.
 *
 * If this screen is needed, it needs a new admin endpoint from the API team
 * (e.g. `GET /api/admin/quotes` with `@Roles(...)`, or a role carve-out in
 * `ownsQuote`) — this page cannot be wired against what exists today.
 */
export default async function QuotesPage() {
  await requireRole(["ADMIN", "MANAGEMENT", "OPS_MANAGER", "FINANCE", "SUPPORT", "VIEWER"]);

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات فروش</p>
          <h1>استعلام‌ها</h1>
        </div>
      </div>

      <div className="card panel">
        <p className="empty-hint">
          سرویس فعلی هیچ مسیر مدیریتی برای فهرست یا مشاهدهٔ استعلام‌ها ندارد. مسیر
          {" "}
          <code dir="ltr">GET /api/quotes/:id</code>
          {" "}
          فقط برای صاحب همان استعلام (مشتری یا نشست ناشناس) قابل دسترس است و برای کارکنان
          ۴۰۴ برمی‌گرداند. برای فعال‌سازی این صفحه، افزودن مسیری مدیریتی مثل
          {" "}
          <code dir="ltr">GET /api/admin/quotes</code>
          {" "}
          در بک‌اند لازم است.
        </p>
      </div>
    </div>
  );
}
