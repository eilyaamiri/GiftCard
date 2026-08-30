"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { formatToman } from "@barat/ui";
import { getChecklist, markItemPassed } from "@/lib/mock-checklist";
import { ChecklistPanel } from "../checklist-panel";
import { FinalActionPanel } from "../final-action-panel";
import type { WorkspaceProps } from "./registry";

/**
 * Gift card fulfillment — desktop two columns (65% main / 35% control).
 * Main: read-only order summary, provider purchase form with cost-control
 * panel, gift card entry with masking-after-save, internal notes warning.
 * Control: backend-driven checklist + final action.
 */
export function GiftCardFulfillmentWorkspace({ task }: WorkspaceProps) {
  const [checklist, setChecklist] = useState(() => getChecklist(task.id));
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [serial, setSerial] = useState("");

  const quotedCostUsd = new Decimal("46.5");
  const maxAllowedUsd = new Decimal("47.9"); // quoted + tolerance
  const [actualCostUsd, setActualCostUsd] = useState("46.8");
  const actualCost = parseDecimal(actualCostUsd);
  const diff = actualCost.minus(quotedCostUsd);

  function handleSaveAsset() {
    if (!code.trim()) return;
    setSaved(true);
    setChecklist(markItemPassed(task.id, "c7"));
    if (pin.trim()) setChecklist(markItemPassed(task.id, "c8"));
    setChecklist(markItemPassed(task.id, "c13"));
  }

  async function handleConfirmSend(): Promise<boolean> {
    // Simulated server round-trip. Real impl posts to
    // /api/operator/work-items/:id/deliver and refetches the checklist.
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  }

  return (
    <div className="workspace-layout">
      <div className="workspace-main">
        <div className="card workspace-card">
          <div className="summary-head">
            <div className="product-tile">A</div>
            <div>
              <h2>Apple Gift Card — ۵۰ دلار</h2>
              <p>ریجن: ایالات متحده · سفارش {task.subtitle.split("·")[0]?.trim()}</p>
            </div>
            <div className="summary-value">
              <strong>{formatToman(96_500_000n)}</strong>
              <span>مبلغ پرداختی مشتری</span>
            </div>
          </div>
          <div className="details-grid">
            <div><p className="detail-label">مشتری</p><p className="detail-value">امیر حسینی</p></div>
            <div><p className="detail-label">شمارهٔ سفارش</p><p className="detail-value bp-ltr">BP-10432</p></div>
            <div><p className="detail-label">زمان پرداخت</p><p className="detail-value bp-ltr">۱۰:۰۰</p></div>
          </div>
        </div>

        <div className="card workspace-card">
          <div className="section-label">
            <h3>خرید از تأمین‌کننده</h3>
            <span>ثبت خرید واقعی نزد Tillo</span>
          </div>
          <div className="form-grid">
            <label>
              تأمین‌کننده
              <select defaultValue="tillo">
                <option value="tillo">Tillo</option>
              </select>
            </label>
            <label>
              شمارهٔ سفارش تأمین‌کننده (Provider order ref)
              <input className="bp-ltr" placeholder="مثلاً TLO-9924123" />
            </label>
            <label>
              هزینهٔ واقعی تأمین‌کننده
              <input className="bp-ltr" value={actualCostUsd} onChange={(e) => setActualCostUsd(e.target.value)} inputMode="decimal" />
            </label>
            <label>
              واحد پول
              <select defaultValue="USD">
                <option value="USD">USD</option>
              </select>
            </label>
          </div>

          <div className="cost-panel">
            <div className="cost-item"><span>هزینهٔ برآوردی (Quote)</span><strong>${quotedCostUsd.toFixed(2)}</strong></div>
            <div className="cost-item"><span>حداکثر مجاز</span><strong>${maxAllowedUsd.toFixed(2)}</strong></div>
            <div className="cost-item"><span>هزینهٔ واقعی</span><strong>${actualCost.toFixed(2)}</strong></div>
            <div className="cost-item">
              <span>اختلاف</span>
              <strong className={diff.gt(0) ? undefined : "cost-diff"}>{diff.gte(0) ? "+" : ""}${diff.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        <div className="card workspace-card">
          <div className="section-label">
            <h3>ثبت اطلاعات گیفت‌کارت</h3>
            <span>{saved ? "ذخیره‌شده" : "ذخیره‌نشده"}</span>
          </div>

          {saved ? (
            <div className="form-grid">
              <label>
                کد
                <input className="bp-ltr" value={maskValue(code)} disabled />
              </label>
              {pin ? (
                <label>
                  پین
                  <input className="bp-ltr" value={maskValue(pin)} disabled />
                </label>
              ) : null}
              <label>
                شمارهٔ سریال
                <input className="bp-ltr" value={serial} disabled />
              </label>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  کد گیفت‌کارت
                  <input className="bp-ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="کد را دقیقاً همان‌طور که از تأمین‌کننده دریافت شده وارد کنید" />
                </label>
                <label>
                  پین (در صورت نیاز)
                  <input className="bp-ltr" value={pin} onChange={(e) => setPin(e.target.value)} />
                </label>
                <label>
                  شمارهٔ سریال
                  <input className="bp-ltr" value={serial} onChange={(e) => setSerial(e.target.value)} />
                </label>
                <label>
                  تاریخ انقضا (در صورت وجود)
                  <input type="date" />
                </label>
              </div>
              <div className="save-row">
                <button type="button" className="primary-btn" onClick={handleSaveAsset} disabled={!code.trim()}>
                  ذخیرهٔ اطلاعات گیفت‌کارت
                </button>
              </div>
            </>
          )}
        </div>

        <div className="card workspace-card">
          <div className="section-label">
            <h3>یادداشت داخلی</h3>
          </div>
          <textarea placeholder="یادداشت برای تیم — مثلاً دلیل تأخیر یا نکتهٔ خاص سفارش" />
          <p className="warning">هرگز کد، پین یا اطلاعات حساس گیفت‌کارت را در این یادداشت وارد نکنید. یادداشت‌ها در گزارش رخدادها قابل مشاهده‌اند.</p>
        </div>
      </div>

      <div className="workspace-control">
        <ChecklistPanel checklist={checklist} />
        <FinalActionPanel checklist={checklist} onConfirmSend={handleConfirmSend} />
      </div>
    </div>
  );
}

function parseDecimal(value: string): Decimal {
  try {
    const parsed = new Decimal(value || "0");
    return parsed.isFinite() ? parsed : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

function maskValue(value: string): string {
  if (!value) return "—";
  if (value.length <= 4) return "•".repeat(value.length);
  return `${value.slice(0, 2)}${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-2)}`;
}
