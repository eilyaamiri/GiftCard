"use client";

import type { WorkspaceProps } from "./registry";

/** Waiting on the customer for a missing/incorrect field — e.g. a wrong email. */
export function CustomerInformationWorkspace({ task }: WorkspaceProps) {
  return (
    <div className="two-col">
      <div className="card workspace-card">
        <div className="section-label">
          <h3>اطلاعات مفقود</h3>
        </div>
        <p className="muted">{task.title}</p>
        <p className="muted" style={{ marginTop: 8 }}>سفارش {task.subtitle.split("·")[0]?.trim()} در انتظار دریافت آدرس ایمیل صحیح از مشتری است.</p>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label>
            پیام درخواستی به مشتری
            <textarea defaultValue="سلام، لطفاً آدرس ایمیل صحیح حساب خود را برای ما ارسال کنید تا سفارش شما تکمیل شود." />
          </label>
        </div>
        <div className="save-row">
          <button type="button" className="primary-btn">ارسال درخواست به مشتری</button>
        </div>
      </div>
      <div className="card workspace-card">
        <div className="section-label">
          <h3>وضعیت</h3>
        </div>
        <p className="muted">در انتظار پاسخ مشتری — این تسک تا دریافت اطلاعات صحیح مسدود می‌ماند.</p>
      </div>
    </div>
  );
}
