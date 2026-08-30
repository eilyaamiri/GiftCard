"use client";

import type { WorkspaceProps } from "./registry";

/** A general support question from a customer, not tied to fulfillment blocking. */
export function SupportRequestWorkspace({ task }: WorkspaceProps) {
  return (
    <div className="two-col">
      <div className="card workspace-card">
        <div className="section-label">
          <h3>درخواست پشتیبانی</h3>
        </div>
        <p className="muted">{task.title}</p>
        <p className="muted" style={{ marginTop: 8 }}>سفارش {task.subtitle.split("·")[0]?.trim()}</p>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label>
            پاسخ به مشتری
            <textarea placeholder="پاسخ خود را بنویسید…" />
          </label>
        </div>
        <div className="save-row">
          <button type="button" className="primary-btn">ارسال پاسخ و بستن تسک</button>
        </div>
      </div>
      <div className="card workspace-card">
        <div className="section-label">
          <h3>تاریخچهٔ گفتگو</h3>
        </div>
        <p className="empty-hint">هنوز پیام قبلی در این تسک ثبت نشده است.</p>
      </div>
    </div>
  );
}
