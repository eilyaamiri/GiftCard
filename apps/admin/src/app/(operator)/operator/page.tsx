import Link from "next/link";
import { Icon } from "@/components/icon-map";
import { mockOperatorTasks, TASK_TYPE_ICON, TASK_TYPE_LABEL } from "@/lib/mock-operator";

export const metadata = { title: "میز من | میزکار اپراتور برات پی" };

/**
 * Personal desk only. This page must never surface company GMV, profit, FX
 * margin, or another operator's performance — those belong on /dashboard,
 * which is gated to back-office roles.
 */
export default function OperatorDeskPage() {
  const open = mockOperatorTasks.filter((t) => t.status !== "COMPLETED");
  const waitingCustomer = open.filter((t) => t.status === "WAITING_CUSTOMER");
  const waitingSupplier = open.filter((t) => t.status === "WAITING_SUPPLIER");
  const dueSoon = open.filter((t) => t.dueInMinutes !== null && t.dueInMinutes <= 30 && !t.overdue);
  const overdue = open.filter((t) => t.overdue);
  const completedToday = mockOperatorTasks.filter((t) => t.status === "COMPLETED");
  const myOpen = open.filter((t) => t.status === "IN_PROGRESS" || t.status === "ASSIGNED");

  return (
    <div>
      <div className="operator-hero">
        <div className="welcome-card">
          <h2>صبح‌بخیر، محمد 👋</h2>
          <p>{myOpen.length.toLocaleString("fa-IR")} تسک باز روی میز شماست. یکی نیاز فوری به رسیدگی دارد.</p>
        </div>
        <div className="card desk-stat">
          <span className="desk-stat-value">{completedToday.length.toLocaleString("fa-IR")}</span>
          <span className="desk-stat-label">تکمیل‌شده امروز</span>
        </div>
      </div>

      <div className="stat-strip">
        <div className="card stat-tile"><span>باز روی میز من</span><strong>{myOpen.length.toLocaleString("fa-IR")}</strong></div>
        <div className="card stat-tile"><span>در انتظار مشتری</span><strong>{waitingCustomer.length.toLocaleString("fa-IR")}</strong></div>
        <div className="card stat-tile"><span>در انتظار تأمین‌کننده</span><strong>{waitingSupplier.length.toLocaleString("fa-IR")}</strong></div>
        <div className="card stat-tile"><span>عقب‌افتاده</span><strong className={overdue.length > 0 ? "freshness-bad" : ""}>{overdue.length.toLocaleString("fa-IR")}</strong></div>
      </div>

      <div className="task-grid">
        <TaskListCard title="نزدیک به موعد" tasks={dueSoon} emptyText="فعلاً تسک نزدیک به موعدی ندارید." />
        <TaskListCard title="عقب‌افتاده" tasks={overdue} emptyText="هیچ تسک عقب‌افتاده‌ای ندارید — عالی است." />
      </div>
    </div>
  );
}

function TaskListCard({
  title,
  tasks,
  emptyText,
}: {
  title: string;
  tasks: typeof mockOperatorTasks;
  emptyText: string;
}) {
  return (
    <div className="card task-panel">
      <div className="panel-heading">
        <h2 className="panel-title">{title}</h2>
        <span className="panel-caption">{tasks.length.toLocaleString("fa-IR")} مورد</span>
      </div>
      {tasks.length === 0 ? (
        <p className="empty-hint">{emptyText}</p>
      ) : (
        tasks.map((task) => (
          <Link href={`/operator/tasks/${task.id}`} key={task.id} className="task-row" style={{ textDecoration: "none" }}>
            <span className="task-symbol">
              <Icon name={TASK_TYPE_ICON[task.type]} size={17} />
            </span>
            <div className="task-copy">
              <strong>{TASK_TYPE_LABEL[task.type]}</strong>
              <span>{task.title}</span>
            </div>
            <span className={task.priority === "HIGH" ? "priority-high" : "priority-normal"}>
              {task.overdue ? "دیرکرد" : task.dueInMinutes !== null ? `${task.dueInMinutes.toLocaleString("fa-IR")} دقیقه` : "—"}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
