"use client";

import { useState } from "react";
import { getChecklist } from "@/lib/mock-checklist";
import { ChecklistPanel } from "../checklist-panel";
import { FinalActionPanel } from "../final-action-panel";
import type { WorkspaceProps } from "./registry";

/** International service payment — pay a foreign provider on the customer's behalf and confirm. */
export function InternationalPaymentWorkspace({ task }: WorkspaceProps) {
  const [checklist] = useState(() => getChecklist(task.id));

  async function handleConfirmSend() {
    await new Promise((r) => setTimeout(r, 900));
    return true;
  }

  return (
    <div className="workspace-layout">
      <div className="workspace-main">
        <div className="card workspace-card">
          <div className="summary-head">
            <div className="product-tile" style={{ background: "linear-gradient(145deg,#0f8b7c,#1fd1a9)" }}>P</div>
            <div>
              <h2>ChatGPT Plus — یک ماهه</h2>
              <p>سرویس بین‌المللی · سفارش {task.subtitle.split("·")[0]?.trim()}</p>
            </div>
          </div>
          <div className="details-grid">
            <div><p className="detail-label">ایمیل حساب مشتری</p><p className="detail-value bp-ltr">reza.s@example.com</p></div>
            <div><p className="detail-label">پلن</p><p className="detail-value">Plus — ماهانه</p></div>
            <div><p className="detail-label">روش پرداخت اپراتور</p><p className="detail-value">کارت مجازی شرکتی</p></div>
          </div>
        </div>

        <div className="card workspace-card">
          <div className="section-label">
            <h3>ثبت پرداخت به سرویس خارجی</h3>
          </div>
          <div className="form-grid">
            <label>
              شمارهٔ پیگیری پرداخت
              <input className="bp-ltr" placeholder="مثلاً TXN-88213" />
            </label>
            <label>
              مبلغ پرداخت‌شده (USD)
              <input className="bp-ltr" defaultValue="20.00" inputMode="decimal" />
            </label>
          </div>
          <div className="save-row">
            <button type="button" className="primary-btn">ثبت پرداخت</button>
          </div>
        </div>
      </div>

      <div className="workspace-control">
        <ChecklistPanel checklist={checklist} />
        <FinalActionPanel checklist={checklist} onConfirmSend={handleConfirmSend} />
      </div>
    </div>
  );
}
