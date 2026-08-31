"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toPersianDigits } from "@barat/ui";
import type { WorkItemType } from "@barat/contracts";
import { Icon } from "@/components/icon-map";
import { InlineError, messageFor } from "../../_components/error-notice";
import {
  ACTIVE_STATUSES,
  MAX_CONCURRENT_WORK_ITEMS,
  QUEUE_KEY_LABEL,
  WORK_ITEM_STATUS_LABEL,
  WORK_ITEM_TYPE_ICON,
  WORK_ITEM_TYPE_LABEL,
  isHighPriority,
  isOverdue,
  minutesUntilDue,
  workItems,
  type WorkItemSummary,
} from "../../_lib/work-items";

type Tab = "mine" | "available" | "waiting" | "overdue" | "closed";

const TABS: { key: Tab; label: string }[] = [
  { key: "mine", label: "روی میز من" },
  { key: "available", label: "قابل برداشتن" },
  { key: "waiting", label: "در انتظار" },
  { key: "overdue", label: "عقب‌افتاده" },
  { key: "closed", label: "بسته‌شده" },
];

const WAITING_STATUSES = ["WAITING_CUSTOMER", "WAITING_SUPPLIER", "NEED_REVIEW"] as const;

export function TasksList({
  mine,
  pool,
  capacityUsed,
}: {
  mine: readonly WorkItemSummary[];
  pool: readonly WorkItemSummary[];
  capacityUsed: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("mine");
  const [typeFilter, setTypeFilter] = useState<WorkItemType | "ALL">("ALL");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const atCapacity = capacityUsed >= MAX_CONCURRENT_WORK_ITEMS;

  const visible = useMemo(() => {
    const source =
      tab === "available"
        ? pool
        : tab === "mine"
          ? mine.filter((item) => item.status === "ASSIGNED" || item.status === "IN_PROGRESS")
          : tab === "waiting"
            ? mine.filter((item) => (WAITING_STATUSES as readonly string[]).includes(item.status))
            : tab === "overdue"
              ? mine.filter((item) => isOverdue(item))
              : mine.filter((item) => !ACTIVE_STATUSES.includes(item.status));

    return typeFilter === "ALL" ? source : source.filter((item) => item.type === typeFilter);
  }, [tab, typeFilter, mine, pool]);

  async function handleClaim(id: string) {
    setClaimError(null);
    setClaimingId(id);
    try {
      await workItems.claim(id);
      // The server owns the outcome of a claim race, so the list is re-read
      // rather than optimistically mutated.
      startTransition(() => router.refresh());
    } catch (error) {
      setClaimError(messageFor(error));
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div>
      <div className="tab-strip">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`tab-btn${tab === entry.key ? " active" : ""}`}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <select
          className="filter"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as WorkItemType | "ALL")}
          aria-label="فیلتر نوع تسک"
          style={{ minHeight: 38, border: "1px solid var(--line)" }}
        >
          <option value="ALL">همهٔ انواع تسک</option>
          {(Object.keys(WORK_ITEM_TYPE_LABEL) as WorkItemType[]).map((type) => (
            <option key={type} value={type}>
              {WORK_ITEM_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </div>

      {tab === "available" && atCapacity ? (
        <p className="warning" style={{ marginBlockEnd: 12 }}>
          به سقف {toPersianDigits(MAX_CONCURRENT_WORK_ITEMS)} کار هم‌زمان رسیده‌اید. ابتدا یکی از کارهای باز را ببندید.
        </p>
      ) : null}

      <InlineError message={claimError} />

      <div className="card list-card">
        {visible.length === 0 ? (
          <p className="empty-hint">موردی با این فیلترها یافت نشد.</p>
        ) : (
          visible.map((item) => {
            const minutes = minutesUntilDue(item);
            const overdue = isOverdue(item);
            const claimable = tab === "available" && item.status === "UNASSIGNED";

            return (
              <div key={item.id} className="task-row">
                <span className="task-symbol">
                  <Icon name={WORK_ITEM_TYPE_ICON[item.type]} size={17} />
                </span>
                <div className="task-copy">
                  <strong>
                    <Link href={`/operator/tasks/${item.id}`} style={{ color: "inherit" }}>
                      {WORK_ITEM_TYPE_LABEL[item.type]} — {item.title}
                    </Link>
                  </strong>
                  <span>
                    <span className="bp-ltr">{item.code}</span> · {QUEUE_KEY_LABEL[item.queueKey]} ·{" "}
                    {WORK_ITEM_STATUS_LABEL[item.status]}
                    {isHighPriority(item) ? " · اولویت بالا" : ""}
                  </span>
                </div>
                {claimable ? (
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={atCapacity || claimingId === item.id || isPending}
                    onClick={() => void handleClaim(item.id)}
                  >
                    {claimingId === item.id ? "در حال برداشتن…" : "برداشتن"}
                  </button>
                ) : (
                  <span className={overdue ? "priority-high" : "priority-normal"}>
                    {overdue ? "دیرکرد" : minutes !== null ? `${toPersianDigits(minutes)} دقیقه` : "—"}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
