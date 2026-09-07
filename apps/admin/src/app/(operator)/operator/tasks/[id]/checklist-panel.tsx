"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toPersianDigits } from "@barat/ui";
import { formatDecimalString } from "@/lib/format-bps";
import {
  CHECKLIST_ITEM_STATUS_LABEL,
  CHECKLIST_ITEM_TYPE_LABEL,
  CHECKLIST_STATUS_LABEL,
  type ChecklistItemView,
  type ChecklistView,
  type RecordedSupplierCost,
} from "../../../_lib/fulfillment";
import { SUPPLIER_COST_ANCHOR } from "./cost-variance-panel";

const SATISFIED = ["PASSED", "NOT_APPLICABLE"] as const;

/** `SYSTEM_VERIFIED_KEYS.ACTUAL_COST_PRESENT` — the row that shows the spend. */
const ACTUAL_COST_KEY = "ACTUAL_COST_PRESENT";

function isSatisfied(item: ChecklistItemView): boolean {
  return (SATISFIED as readonly string[]).includes(item.status);
}

/**
 * Backend-driven checklist. Every row's status comes from the server and is
 * re-read after each mutation — this component holds no checklist state of its
 * own, so a tick that the server refused can never look accepted.
 */
export function ChecklistPanel({
  checklist,
  canOperate,
  busyKey,
  recordedCost,
  canCorrectCost,
  onCheck,
  onSetField,
}: {
  checklist: ChecklistView;
  canOperate: boolean;
  busyKey: string | null;
  recordedCost: RecordedSupplierCost | null;
  canCorrectCost: boolean;
  onCheck: (itemKey: string, checked: boolean) => void;
  onSetField: (itemKey: string, value: string) => void;
}) {
  const satisfied = checklist.items.filter(isSatisfied).length;
  const total = checklist.items.length;

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>چک‌لیست تحویل</h3>
        <span>{CHECKLIST_STATUS_LABEL[checklist.status]}</span>
      </div>

      <div className="checklist-progress">
        <span className="progress-count">
          {toPersianDigits(satisfied)} / {toPersianDigits(total)}
        </span>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${total === 0 ? 0 : (satisfied / total) * 100}%` }} />
        </div>
      </div>

      {checklist.blockedReason ? <p className="warning">{checklist.blockedReason}</p> : null}
      {checklist.isLocked ? (
        <p className="muted">این چک‌لیست پس از ارسال قفل شده است و بازگشایی آن نیاز به مدیر عملیات دارد.</p>
      ) : null}

      {checklist.items.map((item) => (
        <ChecklistRow
          key={item.id}
          item={item}
          canOperate={canOperate && !checklist.isLocked}
          busy={busyKey === item.key}
          recordedCost={item.key === ACTUAL_COST_KEY ? recordedCost : null}
          canCorrectCost={canCorrectCost && !checklist.isLocked}
          onCheck={onCheck}
          onSetField={onSetField}
        />
      ))}
    </div>
  );
}

function ChecklistRow({
  item,
  canOperate,
  busy,
  recordedCost,
  canCorrectCost,
  onCheck,
  onSetField,
}: {
  item: ChecklistItemView;
  canOperate: boolean;
  busy: boolean;
  /** Non-null only on the recorded-cost row, and only once a figure exists. */
  recordedCost: RecordedSupplierCost | null;
  canCorrectCost: boolean;
  onCheck: (itemKey: string, checked: boolean) => void;
  onSetField: (itemKey: string, value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const passed = isSatisfied(item);
  const editable = canOperate && item.isOperatorEditable && !busy;
  const manuallyConfirmed = item.verifiedByStaffId !== null;
  const nextChecked = !passed || !manuallyConfirmed;
  const needsValue = item.type === "REQUIRED_FIELD" && !item.hasValue && !passed;

  return (
    <div className={`check-row${passed ? "" : " pending"}`}>
      <button
        type="button"
        className="check-box"
        aria-label={passed && manuallyConfirmed ? `لغو تأیید ${item.labelFa}` : `تأیید ${item.labelFa}`}
        aria-pressed={passed}
        disabled={!editable}
        onClick={() => onCheck(item.key, nextChecked)}
      >
        {passed ? <Check size={13} strokeWidth={3} /> : null}
      </button>
      <div className="check-copy" style={{ display: "grid", gap: 6 }}>
        <strong>{item.labelFa}</strong>
        <span>
          {CHECKLIST_ITEM_STATUS_LABEL[item.status]}
          {item.isBlocking && !passed ? " · مسدودکنندهٔ ارسال" : ""}
          {item.note ? ` · ${item.note}` : ""}
        </span>

        {/* The recorded spend, spelled out on the row that asserts it exists.
            A tick alone cannot tell an operator that 470.00 should have been
            47.00 — the number has to be readable to be recognised as wrong. */}
        {recordedCost ? (
          <span>
            مبلغ ثبت‌شده:{" "}
            <strong className="bp-ltr">
              {formatDecimalString(recordedCost.actualSupplierCost)} {recordedCost.actualSupplierCurrency ?? ""}
            </strong>
          </span>
        ) : null}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="secondary-btn"
            disabled={!editable || (passed && manuallyConfirmed)}
            onClick={() => onCheck(item.key, nextChecked)}
          >
            {manuallyConfirmed ? "تأیید شد" : "تأیید دستی"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            disabled={!editable || item.status !== "PASSED" || item.verifiedByStaffId === null}
            onClick={() => onCheck(item.key, false)}
          >
            برگرداندن
          </button>
          {/* One correction form, in the card that also shows the variance the
              figure produced — this only walks the manager to it. */}
          {recordedCost && canCorrectCost ? (
            /* `.secondary-btn` sizes with min-height, which an inline anchor
               ignores, so this one carries the box model it needs. */
            <a
              className="secondary-btn"
              href={`#${SUPPLIER_COST_ANCHOR}`}
              style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >
              اصلاح مبلغ
            </a>
          ) : null}
        </div>

        {item.type === "REQUIRED_FIELD" && needsValue ? (
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!editable}
              placeholder="مقدار این فیلد"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="secondary-btn"
              disabled={!editable || draft.trim().length === 0}
              onClick={() => {
                onSetField(item.key, draft.trim());
                setDraft("");
              }}
            >
              ثبت
            </button>
          </div>
        ) : null}
      </div>
      <span className="check-type">{CHECKLIST_ITEM_TYPE_LABEL[item.type]}</span>
    </div>
  );
}
