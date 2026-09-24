import { STAFF_ROLE_LABELS, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { SettingsTabs } from "./settings-tabs";
import {
  settingsFaqListSchema,
  settingsFeatureFlagListSchema,
  settingsQueueListSchema,
  settingsStaffListSchema,
  settingsSupportChannelListSchema,
  type SettingsFaq,
  type SettingsFeatureFlag,
  type SettingsQueue,
  type SettingsStaff,
  type SettingsSupportChannel,
} from "./settings-schema";

export const metadata = { title: "تنظیمات | پنل ادمین برات پی" };

export default async function SettingsPage() {
  const staffUser = await requireRole(["ADMIN"]);

  let flags: readonly SettingsFeatureFlag[] = [];
  let staff: readonly SettingsStaff[] = [];
  let queues: readonly SettingsQueue[] = [];
  let supportChannels: readonly SettingsSupportChannel[] = [];
  let faqs: readonly SettingsFaq[] = [];
  let loadError: string | null = null;

  try {
    const [flagResponse, staffResponse, queueResponse, supportResponse, faqResponse] = await Promise.all([
      api.get("/api/admin/settings/feature-flags", settingsFeatureFlagListSchema),
      api.get("/api/admin/settings/staff", settingsStaffListSchema),
      api.get("/api/admin/settings/queues", settingsQueueListSchema),
      api.get("/api/admin/settings/support-channels", settingsSupportChannelListSchema),
      api.get("/api/admin/settings/faqs", settingsFaqListSchema),
    ]);
    flags = flagResponse.items;
    staff = staffResponse.items;
    queues = queueResponse.items;
    supportChannels = supportResponse.items;
    faqs = faqResponse.items;
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
        supportChannels={supportChannels}
        faqs={faqs}
        currentStaffId={staffUser.id}
        loadError={loadError}
      />
    </div>
  );
}
