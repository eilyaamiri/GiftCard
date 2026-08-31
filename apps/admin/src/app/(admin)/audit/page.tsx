import { ShieldAlert } from "lucide-react";
import { AUDIT_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";

export const metadata = { title: "گزارش رخدادها | پنل ادمین برات پی" };

/**
 * The API has an internal, write-only audit module (apps/api/src/modules/audit)
 * that records events like GIFT_CARD_CODE_VIEWED and FX_RATE_OVERRIDE_SET, but
 * there is no controller exposing a read endpoint (confirmed against the live
 * route table on 2026-08-31: no `Mapped {/api/admin/audit...}` line exists).
 * A page that invents rows here would look exactly like a real append-only log
 * while actually being fiction, which is worse than admitting it isn't wired
 * yet — so this renders an honest empty state instead.
 */
export default async function AuditPage() {
  await requireRole(AUDIT_ROLES);

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات و بازرسی</p>
          <h1>گزارش رخدادها</h1>
        </div>
        <p className="muted">Append-only — هیچ رکوردی ویرایش یا حذف نمی‌شود</p>
      </div>

      <div className="card panel" style={{ textAlign: "center" }}>
        <ShieldAlert size={28} style={{ color: "var(--slate)", marginBottom: 10 }} />
        <p className="empty-hint" style={{ padding: "8px 20px 0" }}>
          رخدادها در پایگاه‌داده ثبت می‌شوند، اما سرویس هنوز endpoint خواندنی برای این گزارش ارائه نمی‌دهد.
        </p>
        <p className="empty-hint" style={{ padding: "0 20px 8px" }}>
          به‌محض افزوده‌شدن یک مسیر مثل GET /api/admin/audit-log به API، این صفحه به آن متصل خواهد شد.
        </p>
      </div>
    </div>
  );
}
