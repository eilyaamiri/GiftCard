"use client";

import type { WorkspaceProps } from "./registry";

/** Waiting on a supplier's response to a purchase or fulfillment request. */
export function SupplierFollowupWorkspace({ task }: WorkspaceProps) {
  return (
    <div className="two-col">
      <div className="card workspace-card">
        <div className="section-label">
          <h3>پیگیری تأمین‌کننده</h3>
        </div>
        <p className="muted">{task.title}</p>
        <div className="kv-list" style={{ marginTop: 16 }}>
          <div className="kv-row"><span>تأمین‌کننده</span><span>Tillo</span></div>
          <div className="kv-row"><span>شمارهٔ خرید</span><span className="bp-ltr">TLO-9924001</span></div>
          <div className="kv-row"><span>آخرین تلاش تماس</span><span className="bp-ltr">۴۰ دقیقه پیش</span></div>
        </div>
        <div className="save-row" style={{ marginTop: 16 }}>
          <button type="button" className="secondary-btn" style={{ marginLeft: 10 }}>ثبت تلاش جدید پیگیری</button>
          <button type="button" className="primary-btn">ارجاع به سرپرست تأمین</button>
        </div>
      </div>
      <div className="card workspace-card">
        <div className="section-label">
          <h3>یادداشت پیگیری</h3>
        </div>
        <textarea placeholder="خلاصهٔ آخرین مکالمه با تأمین‌کننده" />
      </div>
    </div>
  );
}
