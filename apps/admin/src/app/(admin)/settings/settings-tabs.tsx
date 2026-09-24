"use client";

import { useState } from "react";
import { FaqPanel } from "./faq-panel";
import { FeatureFlagsPanel } from "./feature-flags-panel";
import { QueuesPanel } from "./queues-panel";
import { StaffPanel } from "./staff-panel";
import { SupportChannelsPanel } from "./support-channels-panel";
import type {
  SettingsFaq,
  SettingsFeatureFlag,
  SettingsQueue,
  SettingsStaff,
  SettingsSupportChannel,
} from "./settings-schema";

type Tab = "flags" | "staff" | "queues" | "support" | "faq";

/**
 * Each tab writes through `/api/admin/settings/*`, which re-checks the ADMIN
 * role on every call. What the browser holds is a copy of the last server
 * response, so a control that appears to succeed has actually been persisted.
 */
export function SettingsTabs({
  flags,
  staff,
  queues,
  supportChannels,
  faqs,
  currentStaffId,
  loadError,
}: {
  flags: readonly SettingsFeatureFlag[];
  staff: readonly SettingsStaff[];
  queues: readonly SettingsQueue[];
  supportChannels: readonly SettingsSupportChannel[];
  faqs: readonly SettingsFaq[];
  currentStaffId: string;
  loadError: string | null;
}) {
  const [tab, setTab] = useState<Tab>("flags");

  if (loadError !== null) {
    return (
      <div className="card panel">
        <p className="empty-hint">{loadError}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="tab-strip" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "flags"}
          className={`tab-btn${tab === "flags" ? " active" : ""}`}
          onClick={() => setTab("flags")}
        >
          پرچم‌های ویژگی
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "staff"}
          className={`tab-btn${tab === "staff" ? " active" : ""}`}
          onClick={() => setTab("staff")}
        >
          کارکنان
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "queues"}
          className={`tab-btn${tab === "queues" ? " active" : ""}`}
          onClick={() => setTab("queues")}
        >
          صف‌ها
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "support"}
          className={`tab-btn${tab === "support" ? " active" : ""}`}
          onClick={() => setTab("support")}
        >
          تنظیمات پشتیبانی
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "faq"}
          className={`tab-btn${tab === "faq" ? " active" : ""}`}
          onClick={() => setTab("faq")}
        >
          سؤال‌های متداول
        </button>
      </div>

      <div className="card panel">
        {tab === "flags" ? <FeatureFlagsPanel initialFlags={flags} /> : null}
        {tab === "staff" ? <StaffPanel initialStaff={staff} currentStaffId={currentStaffId} /> : null}
        {tab === "queues" ? <QueuesPanel initialQueues={queues} staff={staff} /> : null}
        {tab === "support" ? <SupportChannelsPanel initialChannels={supportChannels} /> : null}
        {tab === "faq" ? <FaqPanel initialFaqs={faqs} /> : null}
      </div>
    </div>
  );
}
