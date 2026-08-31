"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toPersianDigits } from "@barat/ui";
import {
  CHECKLIST_ITEM_STATUS_LABEL,
  CHECKLIST_ITEM_TYPE_LABEL,
  CHECKLIST_STATUS_LABEL,
  type ChecklistItemView,
  type ChecklistView,
} from "../../../_lib/fulfillment";

const SATISFIED = ["PASSED", "NOT_APPLICABLE"] as const;

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
  onCheck,
  onSetField,
}: {
  checklist: ChecklistView;
  canOperate: boolean;
  busyKey: string | null;
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
  onCheck,
  onSetField,
}: {
  item: ChecklistItemView;
  canOperate: boolean;
  busy: boolean;
  onCheck: (itemKey: string, checked: boolean) => void;
  onSetField: (itemKey: string, value: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const passed = isSatisfied(item);
  const editable = canOperate && item.isOperatorEditable && !busy;
  const needsValue = item.type === "REQUIRED_FIELD" && !item.hasValue;

  return (
    <div className={`check-row${passed ? "" : " pending"}`}>
      <span className="check-box" style={item.isOperatorEditable ? undefined : { opacity: 0.9 }}>
        {passed ? <Check size={13} strokeWidth={3} /> : null}
      </span>
      <div className="check-copy" style={{ display: "grid", gap: 6 }}>
        <strong>{item.labelFa}</strong>
        <span>
          {CHECKLIST_ITEM_STATUS_LABEL[item.status]}
          {item.isBlocking && !passed ? " · مسدودکنندهٔ ارسال" : ""}
          {item.note ? ` · ${item.note}` : ""}
        </span>

        {item.type === "BOOLEAN" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="secondary-btn"
              disabled={!editable || item.status === "PASSED"}
              onClick={() => onCheck(item.key, true)}
            >
              تأیید
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={!editable || item.status !== "PASSED"}
              onClick={() => onCheck(item.key, false)}
            >
              برگرداندن
            </button>
          </div>
        ) : null}

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

        {item.type === "MANAGER_APPROVAL" && !passed ? (
          <span>تأیید این مورد فقط از سوی مدیر عملیات یا مدیر سیستم و از پنل «اختلاف هزینه» انجام می‌شود.</span>
        ) : null}
      </div>
      <span className="check-type">{CHECKLIST_ITEM_TYPE_LABEL[item.type]}</span>
    </div>
  );
}
