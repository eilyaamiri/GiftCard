import { STAFF_ROLE_LABELS, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { SettingsTabs } from "./settings-tabs";
import {
  settingsFeatureFlagListSchema,
  settingsQueueListSchema,
  settingsStaffListSchema,
  type SettingsFeatureFlag,
  type SettingsQueue,
  type SettingsStaff,
} from "./settings-schema";

export const metadata = { title: "تنظیمات | پنل ادمین برات پی" };

export default async function SettingsPage() {
  const staffUser = await requireRole(["ADMIN"]);

  let flags: readonly SettingsFeatureFlag[] = [];
  let staff: readonly SettingsStaff[] = [];
  let queues: readonly SettingsQueue[] = [];
  let loadError: string | null = null;

  try {
    const [flagResponse, staffResponse, queueResponse] = await Promise.all([
      api.get("/api/admin/settings/feature-flags", settingsFeatureFlagListSchema),
      api.get("/api/admin/settings/staff", settingsStaffListSchema),
      api.get("/api/admin/settings/queues", settingsQueueListSchema),
    ]);
    flags = flagResponse.items;
    staff = staffResponse.items;
    queues = queueResponse.items;
  } catch {
    loadError = "خواندن تنظیمات از سرویس ممکن نشد. صفحه را دوباره بارگذاری کنید.";
  }

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
            <strong style={{ display: "block", color: "var(--ink)", fontSize: 13 }}>{staffUser.email}</strong>
            <span className="tag-pill" style={{ marginTop: 6 }}>{STAFF_ROLE_LABELS[staffUser.role]}</span>
          </div>
        </div>
      </div>

      <SettingsTabs
        flags={flags}
        staff={staff}
        queues={queues}
        currentStaffId={staffUser.id}
        loadError={loadError}
      />
    </div>
  );
}
