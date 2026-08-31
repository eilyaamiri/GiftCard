import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import { Icon } from "@/components/icon-map";
import { requireSession } from "@/lib/session";
import { ErrorNotice } from "../_components/error-notice";
import {
  ACTIVE_STATUSES,
  MAX_CONCURRENT_WORK_ITEMS,
  QUEUE_KEY_LABEL,
  WORK_ITEM_STATUS_LABEL,
  WORK_ITEM_TYPE_ICON,
  WORK_ITEM_TYPE_LABEL,
  isOverdue,
  minutesUntilDue,
  workItems,
  type WorkItemSummary,
} from "../_lib/work-items";

export const metadata = { title: "میز من | میزکار اپراتور برات پی" };

/**
 * Personal desk only. This page must never surface company GMV, profit, FX
 * margin, or another operator's performance — those belong on /dashboard,
 * which is gated to back-office roles.
 */
export default async function OperatorDeskPage() {
  const staff = await requireSession();

  let mine: { items: WorkItemSummary[]; capacityUsed: number };
  let pool: WorkItemSummary[];
  try {
    [mine, pool] = await Promise.all([workItems.mine(), workItems.list({ status: "UNASSIGNED" })]);
  } catch (error) {
    return <ErrorNotice error={error} title="صف کاری در دسترس نیست" />;
  }

  const active = mine.items.filter((item) => ACTIVE_STATUSES.includes(item.status));
  const inHand = active.filter((item) => item.status === "ASSIGNED" || item.status === "IN_PROGRESS");
  const waitingCustomer = active.filter((item) => item.status === "WAITING_CUSTOMER");
  const waitingSupplier = active.filter((item) => item.status === "WAITING_SUPPLIER");
  const overdue = active.filter((item) => isOverdue(item));
  const dueSoon = active.filter((item) => {
    const minutes = minutesUntilDue(item);
    return minutes !== null && minutes >= 0 && minutes <= 30;
  });
  const completedByMe = mine.items.filter((item) => item.status === "COMPLETED");
  const remainingCapacity = Math.max(0, MAX_CONCURRENT_WORK_ITEMS - mine.capacityUsed);

  return (
    <div>
      <div className="operator-hero">
        <div className="welcome-card">
          <h2>{staff.email}</h2>
          <p>
            {toPersianDigits(inHand.length)} کار روی میز شماست و {toPersianDigits(remainingCapacity)} ظرفیت خالی دارید.
            {pool.length > 0 ? ` ${toPersianDigits(pool.length)} کار بدون تخصیص در صف منتظر است.` : " صف بدون تخصیص خالی است."}
          </p>
        </div>
        <div className="card desk-stat">
          <span className="desk-stat-value">{toPersianDigits(completedByMe.length)}</span>
          <span className="desk-stat-label">تکمیل‌شده توسط شما</span>
        </div>
      </div>

      <div className="stat-strip">
        <div className="card stat-tile">
          <span>باز روی میز من</span>
          <strong>{toPersianDigits(inHand.length)}</strong>
        </div>
        <div className="card stat-tile">
          <span>در انتظار مشتری</span>
          <strong>{toPersianDigits(waitingCustomer.length)}</strong>
        </div>
        <div className="card stat-tile">
          <span>در انتظار تأمین‌کننده</span>
          <strong>{toPersianDigits(waitingSupplier.length)}</strong>
        </div>
        <div className="card stat-tile">
          <span>عقب‌افتاده</span>
          <strong className={overdue.length > 0 ? "freshness-bad" : ""}>{toPersianDigits(overdue.length)}</strong>
        </div>
      </div>

      <div className="task-grid">
        <TaskListCard
          title="نزدیک به موعد"
          items={dueSoon}
          emptyText="فعلاً کاری نزدیک به موعد ندارید."
        />
        <TaskListCard
          title="عقب‌افتاده"
          items={overdue}
          emptyText="هیچ کار عقب‌افتاده‌ای ندارید — عالی است."
        />
      </div>

      <div className="card task-panel" style={{ marginBlockStart: 16 }}>
        <div className="panel-heading">
          <h2 className="panel-title">کارهای باز شما</h2>
          <Link href="/operator/tasks" className="panel-caption">
            همهٔ کارها
          </Link>
        </div>
        {active.length === 0 ? (
          <p className="empty-hint">هیچ کاری روی میز شما نیست. از صفحهٔ کارها یک مورد بردارید.</p>
        ) : (
          active.map((item) => <TaskRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

function TaskListCard({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: readonly WorkItemSummary[];
  emptyText: string;
}) {
  return (
    <div className="card task-panel">
      <div className="panel-heading">
        <h2 className="panel-title">{title}</h2>
        <span className="panel-caption">{toPersianDigits(items.length)} مورد</span>
      </div>
      {items.length === 0 ? (
        <p className="empty-hint">{emptyText}</p>
      ) : (
        items.map((item) => <TaskRow key={item.id} item={item} />)
      )}
    </div>
  );
}

function TaskRow({ item }: { item: WorkItemSummary }) {
  const minutes = minutesUntilDue(item);
  const overdue = isOverdue(item);

  return (
    <Link href={`/operator/tasks/${item.id}`} className="task-row" style={{ textDecoration: "none" }}>
      <span className="task-symbol">
        <Icon name={WORK_ITEM_TYPE_ICON[item.type]} size={17} />
      </span>
      <div className="task-copy">
        <strong>{WORK_ITEM_TYPE_LABEL[item.type]}</strong>
        <span>
          {item.title} · {QUEUE_KEY_LABEL[item.queueKey]} · {WORK_ITEM_STATUS_LABEL[item.status]}
        </span>
      </div>
      <span className={overdue ? "priority-high" : "priority-normal"}>
        {overdue ? "دیرکرد" : minutes !== null ? `${toPersianDigits(minutes)} دقیقه` : "—"}
      </span>
    </Link>
  );
}
