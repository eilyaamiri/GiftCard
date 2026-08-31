"use client";

import { useState } from "react";
import { formatBps, formatSignedBps } from "@/lib/format-bps";
import { InlineError } from "../../../_components/error-notice";
import { COST_VARIANCE_REASON_LABEL, type CostVarianceAssessment } from "../../../_lib/fulfillment";

/**
 * Manager approval for a supplier cost variance.
 *
 * An OPERATOR never sees the approval control, and that is only the cosmetic
 * half: the API refuses the call for any role outside ADMIN / OPS_MANAGER /
 * MANAGEMENT, and refuses it again when the approver is the same person who
 * holds the claim or recorded the cost. Approval is a second pair of eyes by
 * construction, not by convention.
 */
export function CostVariancePanel({
  variance,
  canApprove,
  onApprove,
}: {
  variance: CostVarianceAssessment;
  canApprove: boolean;
  onApprove: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleApprove() {
    setError(null);
    setSaving(true);
    try {
      await onApprove(reason.trim());
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تأیید اختلاف هزینه ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>اختلاف هزینهٔ تأمین‌کننده</h3>
        <span>{COST_VARIANCE_REASON_LABEL[variance.reason]}</span>
      </div>

      <div className="cost-panel">
        <div className="cost-item">
          <span>اختلاف ثبت‌شده</span>
          <strong className={variance.requiresApproval ? "freshness-bad" : undefined}>
            {variance.varianceBps === null ? "—" : formatSignedBps(variance.varianceBps)}
          </strong>
        </div>
        <div className="cost-item">
          <span>حد مجاز</span>
          <strong>{formatBps(variance.toleranceBps)}</strong>
        </div>
        <div className="cost-item">
          <span>وضعیت</span>
          <strong>{variance.requiresApproval ? "نیازمند تأیید مدیر" : "بدون نیاز به تأیید"}</strong>
        </div>
      </div>

      {!variance.requiresApproval ? (
        <p className="muted">اختلاف هزینه در محدودهٔ مجاز است و مانع ارسال نمی‌شود.</p>
      ) : canApprove ? (
        <>
          <p className="warning">
            تأیید شما در گزارش رخدادها ثبت می‌شود. اگر خودتان این کار را برداشته‌اید یا هزینه را ثبت کرده‌اید، سرویس
            تأیید شما را نمی‌پذیرد و باید مدیر دیگری تأیید کند.
          </p>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            دلیل تأیید (الزامی)
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="مثلاً افزایش نرخ تأمین‌کننده در زمان خرید"
            />
          </label>
          <div className="save-row">
            <button
              type="button"
              className="primary-btn"
              disabled={reason.trim().length < 3 || saving}
              onClick={() => void handleApprove()}
            >
              {saving ? "در حال ثبت…" : "تأیید اختلاف هزینه"}
            </button>
          </div>
          <InlineError message={error} />
        </>
      ) : (
        <p className="warning">
          این اختلاف از حد مجاز بیشتر است و تا تأیید مدیر عملیات یا مدیر سیستم، ارسال برای مشتری مسدود می‌ماند. شما اجازهٔ
          تأیید آن را ندارید.
        </p>
      )}
    </div>
  );
}
