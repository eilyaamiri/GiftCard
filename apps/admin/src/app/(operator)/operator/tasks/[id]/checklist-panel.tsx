"use client";

import { Check } from "lucide-react";
import type { ChecklistView } from "@/lib/mock-checklist";

const TYPE_LABEL: Record<string, string> = {
  SYSTEM_VERIFIED: "سیستم",
  BOOLEAN: "اپراتور",
  REQUIRED_FIELD: "فیلد الزامی",
  MANAGER_APPROVAL: "تأیید مدیر",
};

/**
 * Backend-driven checklist. Every row's status comes from `checklist`, which
 * must be refetched from the server after each mutation elsewhere on the
 * page — this component never invents or persists checklist state itself.
 */
export function ChecklistPanel({ checklist }: { checklist: ChecklistView }) {
  const relevant = checklist.items.filter((i) => i.status !== "NOT_APPLICABLE");

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>چک‌لیست تحویل</h3>
      </div>

      <div className="checklist-progress">
        <span className="progress-count">{checklist.passed.toLocaleString("fa-IR")} / {checklist.total.toLocaleString("fa-IR")}</span>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${(checklist.passed / checklist.total) * 100}%` }} />
        </div>
      </div>

      {relevant.map((item) => {
        const isSystem = item.type === "SYSTEM_VERIFIED";
        const passed = item.status === "PASSED";
        return (
          <div key={item.id} className={`check-row${passed ? "" : " pending"}`}>
            <span className="check-box" style={isSystem ? { opacity: 0.9 } : undefined}>
              {passed ? <Check size={13} strokeWidth={3} /> : null}
            </span>
            <div className="check-copy">
              <strong>{item.label}</strong>
              {!passed && item.blockingReason ? <span>{item.blockingReason}</span> : null}
            </div>
            <span className="check-type">{TYPE_LABEL[item.type]}</span>
          </div>
        );
      })}
    </div>
  );
}
