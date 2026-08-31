import { STAFF_ROLE_LABELS } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { SettingsTabs } from "./settings-tabs";

export const metadata = { title: "تنظیمات | پنل ادمین برات پی" };

export default async function SettingsPage() {
  const staff = await requireRole(["ADMIN"]);

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات و بازرسی</p>
          <h1>تنظیمات</h1>
        </div>
      </div>

      <div className="card panel" style={{ marginBottom: 16 }}>
        <p className="panel-caption" style={{ marginBottom: 10 }}>حساب واردشده</p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <strong style={{ display: "block", color: "var(--ink)", fontSize: 13 }}>{staff.email}</strong>
            <span className="tag-pill" style={{ marginTop: 6 }}>{STAFF_ROLE_LABELS[staff.role]}</span>
          </div>
        </div>
      </div>

      <SettingsTabs />
    </div>
  );
}
