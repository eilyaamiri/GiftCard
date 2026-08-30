"use client";

import { useState } from "react";

const featureFlags = [
  { key: "auto_fx_requote", label: "Requote خودکار در نوسان FX", desc: "اگر نرخ بیش از آستانه حرکت کند، Quote جدید صادر شود", enabled: true },
  { key: "manual_fx_override_alert", label: "هشدار override فعال روی صفحهٔ استعلام", desc: "به مشتری/اپراتور نمایش داده شود که نرخ override فعال است", enabled: true },
  { key: "supplier_direct_email_notice", label: "نمایش پیام «کد در اختیار اپراتور نیست»", desc: "برای تأمین‌کنندگانی مثل Reloadly/Runa که مستقیماً ایمیل می‌زنند", enabled: false },
];

const staffUsers = [
  { name: "سارا احمدی", role: "ADMIN", email: "sara@baratpay.example" },
  { name: "نیلوفر کریمی", role: "OPS_MANAGER", email: "niloofar@baratpay.example" },
  { name: "محمد رضایی", role: "OPERATOR", email: "mohammad@baratpay.example" },
  { name: "کیان مرادی", role: "FINANCE", email: "kian@baratpay.example" },
];

export function SettingsTabs() {
  const [tab, setTab] = useState<"flags" | "staff" | "queues">("flags");

  return (
    <div>
      <div className="tab-strip">
        <button type="button" className={`tab-btn${tab === "flags" ? " active" : ""}`} onClick={() => setTab("flags")}>پرچم‌های ویژگی</button>
        <button type="button" className={`tab-btn${tab === "staff" ? " active" : ""}`} onClick={() => setTab("staff")}>کارکنان</button>
        <button type="button" className={`tab-btn${tab === "queues" ? " active" : ""}`} onClick={() => setTab("queues")}>صف‌ها</button>
      </div>

      {tab === "flags" && (
        <div className="card panel">
          {featureFlags.map((flag) => (
            <div className="toggle-row" key={flag.key}>
              <div>
                <strong>{flag.label}</strong>
                <span>{flag.desc}</span>
              </div>
              <label className="switch">
                <input type="checkbox" defaultChecked={flag.enabled} />
                <span className="slider" />
              </label>
            </div>
          ))}
        </div>
      )}

      {tab === "staff" && (
        <div className="card list-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>نام</th>
                  <th>نقش</th>
                  <th>ایمیل</th>
                </tr>
              </thead>
              <tbody>
                {staffUsers.map((user) => (
                  <tr key={user.email}>
                    <td>{user.name}</td>
                    <td><span className="tag-pill bp-ltr">{user.role}</span></td>
                    <td className="bp-ltr">{user.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "queues" && (
        <div className="card panel">
          <p className="empty-hint">پیکربندی صف‌ها به لیست ماژول workitems متصل می‌شود — به‌زودی از طریق API</p>
        </div>
      )}
    </div>
  );
}
