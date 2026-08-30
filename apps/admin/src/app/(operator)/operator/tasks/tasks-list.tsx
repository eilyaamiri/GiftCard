"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { WorkItemType } from "@barat/contracts";
import { Icon } from "@/components/icon-map";
import { mockOperatorTasks, TASK_TYPE_ICON, TASK_TYPE_LABEL } from "@/lib/mock-operator";

type Tab = "open" | "waiting" | "overdue" | "completed";

const TABS: { key: Tab; label: string }[] = [
  { key: "open", label: "باز" },
  { key: "waiting", label: "در انتظار" },
  { key: "overdue", label: "عقب‌افتاده" },
  { key: "completed", label: "تکمیل‌شده" },
];

export function TasksList() {
  const [tab, setTab] = useState<Tab>("open");
  const [typeFilter, setTypeFilter] = useState<WorkItemType | "ALL">("ALL");
  const [priorityFilter, setPriorityFilter] = useState<"ALL" | "HIGH" | "NORMAL">("ALL");

  const filtered = useMemo(() => {
    return mockOperatorTasks.filter((task) => {
      if (tab === "open" && !(task.status === "ASSIGNED" || task.status === "IN_PROGRESS" || task.status === "UNASSIGNED")) return false;
      if (tab === "waiting" && !(task.status === "WAITING_CUSTOMER" || task.status === "WAITING_SUPPLIER" || task.status === "NEED_REVIEW")) return false;
      if (tab === "overdue" && !task.overdue) return false;
      if (tab === "completed" && task.status !== "COMPLETED") return false;
      if (typeFilter !== "ALL" && task.type !== typeFilter) return false;
      if (priorityFilter !== "ALL" && task.priority !== priorityFilter) return false;
      return true;
    });
  }, [tab, typeFilter, priorityFilter]);

  return (
    <div>
      <div className="tab-strip">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`tab-btn${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <select className="filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as WorkItemType | "ALL")} style={{ minHeight: 38, border: "1px solid var(--line)" }}>
          <option value="ALL">همهٔ انواع تسک</option>
          {(Object.keys(TASK_TYPE_LABEL) as WorkItemType[]).map((type) => (
            <option key={type} value={type}>{TASK_TYPE_LABEL[type]}</option>
          ))}
        </select>
        <select className="filter" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as "ALL" | "HIGH" | "NORMAL")} style={{ minHeight: 38, border: "1px solid var(--line)" }}>
          <option value="ALL">همهٔ اولویت‌ها</option>
          <option value="HIGH">فوری</option>
          <option value="NORMAL">عادی</option>
        </select>
      </div>

      <div className="card list-card">
        {filtered.length === 0 ? (
          <p className="empty-hint">تسکی با این فیلترها یافت نشد.</p>
        ) : (
          filtered.map((task) => (
            <Link href={`/operator/tasks/${task.id}`} key={task.id} className="task-row" style={{ textDecoration: "none" }}>
              <span className="task-symbol">
                <Icon name={TASK_TYPE_ICON[task.type]} size={17} />
              </span>
              <div className="task-copy">
                <strong>
                  {TASK_TYPE_LABEL[task.type]} — {task.title}
                </strong>
                <span>{task.subtitle} · {task.queueLabel}</span>
              </div>
              <span className={task.priority === "HIGH" ? "priority-high" : "priority-normal"}>
                {task.overdue ? "دیرکرد" : task.dueInMinutes !== null ? `${task.dueInMinutes.toLocaleString("fa-IR")} دقیقه` : "—"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
