"use client";

import type { WorkspaceProps } from "./registry";

/** The supplier response could not be classified automatically — needs manual review. */
export function UnknownOutcomeWorkspace({ task }: WorkspaceProps) {
  return (
    <div className="two-col">
      <div className="card workspace-card">
        <div className="section-label">
          <h3>نتیجهٔ نامشخص از تأمین‌کننده</h3>
        </div>
        <p className="muted">{task.title}</p>
        <p className="warning" style={{ marginTop: 12 }}>سیستم نتوانست پاسخ تأمین‌کننده را به‌طور خودکار طبقه‌بندی کند. لطفاً پاسخ خام را بررسی و یکی از گزینه‌های زیر را انتخاب کنید.</p>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button type="button" className="primary-btn">علامت‌گذاری به‌عنوان موفق</button>
          <button type="button" className="secondary-btn">علامت‌گذاری به‌عنوان ناموفق</button>
        </div>
      </div>
      <div className="card workspace-card">
        <div className="section-label">
          <h3>پاسخ خام تأمین‌کننده</h3>
        </div>
        <pre className="bp-ltr" style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--slate)", margin: 0 }}>
{`{ "status": "PARTIAL", "reference": "RLD-771002", "message": "awaiting confirmation" }`}
        </pre>
      </div>
    </div>
  );
}
