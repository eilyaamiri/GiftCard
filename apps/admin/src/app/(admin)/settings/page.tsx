import { SettingsTabs } from "./settings-tabs";

export const metadata = { title: "تنظیمات | پنل ادمین برات پی" };

export default function SettingsPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات و بازرسی</p>
          <h1>تنظیمات</h1>
        </div>
      </div>
      <SettingsTabs />
    </div>
  );
}
