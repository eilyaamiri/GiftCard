"use client";

import { useState } from "react";

/**
 * None of these three tabs have a backing endpoint yet:
 *   - feature flags: no `/api/admin/flags` (or similar) route exists
 *   - staff list: no `/api/admin/staff` route exists
 *   - queue config: no `/api/admin/queues` route exists
 * A toggle that flips in the browser but writes nothing to the server is a
 * lie dressed as a setting, so every tab below says plainly that it is not
 * wired instead of simulating a working control.
 */
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
          <p className="empty-hint">API هنوز endpoint ای برای پرچم‌های ویژگی ارائه نمی‌دهد — این تب پس از افزودن آن وصل خواهد شد.</p>
        </div>
      )}

      {tab === "staff" && (
        <div className="card panel">
          <p className="empty-hint">فهرست کارکنان از سرویس در دسترس نیست؛ فقط کاربر واردشده از session واقعی قابل نمایش است.</p>
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
