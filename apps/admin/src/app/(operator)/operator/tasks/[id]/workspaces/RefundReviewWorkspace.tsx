"use client";

import { formatToman } from "@barat/ui";
import type { WorkspaceProps } from "./registry";

/** Review a refund request — never a workspace that offers "buy a new code" for a failed delivery. */
export function RefundReviewWorkspace({ task }: WorkspaceProps) {
  return (
    <div className="two-col">
      <div className="card workspace-card">
        <div className="section-label">
          <h3>بررسی درخواست بازگشت‌وجه</h3>
        </div>
        <p className="muted">{task.title}</p>
        <div className="kv-list" style={{ marginTop: 16 }}>
          <div className="kv-row"><span>مبلغ سفارش</span><span>{formatToman(58_100_000n)}</span></div>
          <div className="kv-row"><span>دلیل درخواست</span><span>کد گیفت‌کارت ارسال نشد</span></div>
          <div className="kv-row"><span>وضعیت تحویل</span><span>ارسال ناموفق بود</span></div>
        </div>
        <div className="save-row" style={{ marginTop: 16 }}>
          <button type="button" className="secondary-btn" style={{ marginLeft: 10 }}>رد درخواست</button>
          <button type="button" className="primary-btn">تأیید بازگشت کامل وجه</button>
        </div>
      </div>
      <div className="card workspace-card">
        <div className="section-label">
          <h3>یادداشت بررسی</h3>
        </div>
        <textarea placeholder="دلیل تصمیم را برای گزارش رخدادها ثبت کنید" />
      </div>
    </div>
  );
}
