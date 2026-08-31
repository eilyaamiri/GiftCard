import { toPersianDigits } from "@barat/ui";
import type { WorkItemSummary } from "@/app/(operator)/_lib/work-items";
import {
  QUEUE_KEY_LABEL,
  WORK_ITEM_STATUS_LABEL,
  WORK_ITEM_TYPE_LABEL,
  isOverdue,
} from "@/app/(operator)/_lib/work-items";
import { calculateSlaMetrics } from "@/lib/sla-metrics";

function minutesBetween(start: string, end: string): number {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}

function durationLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${number(minutes)} دقیقه`;
  const remainder = minutes % 60;
  return remainder === 0
    ? `${number(Math.floor(minutes / 60))} ساعت`
    : `${number(Math.floor(minutes / 60))} ساعت و ${number(remainder)} دقیقه`;
}

function number(value: number): string {
  return toPersianDigits(value.toLocaleString("en-US"));
}

export function SlaPerformanceReport({
  items,
  personal = false,
  embedded = false,
}: Readonly<{
  items: readonly WorkItemSummary[];
  personal?: boolean;
  embedded?: boolean;
}>) {
  const now = Date.now();
  const metrics = calculateSlaMetrics(items, now);
  const sorted = [...items].sort((a, b) => {
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    return aDue - bDue;
  });

  const content = (
    <>
      {!embedded ? (
        <div className="page-heading">
          <div>
            <p className="eyebrow">SLA · OPERATIONS QUALITY</p>
            <h1>{personal ? "عملکرد من و SLA" : "SLA و کیفیت عملیات"}</h1>
            <p className="muted">
              {personal
                ? "زمان انتظار، زمان انجام و وضعیت تعهدات کاری شما."
                : "نمای واقعی تعهدات زمانی، صف‌های معوق و بهره‌وری عملیات."}
            </p>
          </div>
          <p className="muted">پنجرهٔ هشدار نزدیک SLA: ۳۰ دقیقه</p>
        </div>
      ) : null}

      <div className="kpi-grid">
        <Metric label={personal ? "کارهای من" : "کل کارها"} value={number(metrics.total)} foot={`${number(metrics.open)} مورد باز`} />
        <Metric label="معوق باز" value={number(metrics.overdueOpen)} foot={`${number(metrics.nearSla)} مورد نزدیک SLA`} danger={metrics.overdueOpen > 0} />
        <Metric label="SLA محقق‌شده" value={metrics.slaMetPercent === null ? "—" : `${number(metrics.slaMetPercent)}٪`} foot={`${number(metrics.evaluated)} کار خاتمه‌یافتهٔ دارای deadline`} />
        <Metric label="میانگین زمان انجام" value={durationLabel(metrics.averageCompletionMinutes)} foot="از ایجاد تا تکمیل موفق" />
        <Metric label="میانگین انتظار صف" value={durationLabel(metrics.averageQueueWaitMinutes)} foot="از ایجاد تا تخصیص" />
        <Metric label="میانگین شروع کار" value={durationLabel(metrics.averageTimeToStartMinutes)} foot="از ایجاد تا شروع اپراتور" />
        <Metric label={personal ? "تکمیل امروز" : "تکمیل‌شده"} value={number(personal ? metrics.completedToday : metrics.completed)} foot={`${number(metrics.inProgress)} مورد در حال انجام`} />
        <Metric label="نقض SLA" value={number(metrics.breached)} foot="شامل breach ثبت‌شده و deadline ازدست‌رفته" danger={metrics.breached > 0} />
      </div>

      <div className="dashboard-grid">
        <section className="card panel">
          <div className="section-label">
            <h2>کارها و وضعیت SLA</h2>
            <span>حداکثر ۵۰ مورد با نزدیک‌ترین deadline</span>
          </div>
          {items.length === 0 ? (
            <div className="empty-hint">هنوز داده‌ای برای گزارش SLA ثبت نشده است.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>کد کار</th><th>صف / نوع</th>{personal ? null : <th>اپراتور</th>}<th>وضعیت</th><th>Deadline</th><th>زمان سپری‌شده</th></tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 50).map((item) => {
                    const overdue = isOverdue(item, now);
                    const recordedBreach = item.slaBreachedAt != null;
                    const elapsed = minutesBetween(item.createdAt, item.completedAt ?? new Date(now).toISOString());
                    return (
                      <tr key={item.id}>
                        <td><strong className="order-id">{item.code}</strong></td>
                        <td>{QUEUE_KEY_LABEL[item.queueKey]}<span className="table-subline">{WORK_ITEM_TYPE_LABEL[item.type]}</span></td>
                        {personal ? null : <td>{item.assignedToStaffName ?? item.assignedToStaffId ?? "تخصیص‌نیافته"}</td>}
                        <td><span className={`status-pill ${overdue || recordedBreach ? "status-danger" : item.completedAt ? "status-success" : "status-warning"}`}>{WORK_ITEM_STATUS_LABEL[item.status]}</span></td>
                        <td>{item.dueAt ? new Date(item.dueAt).toLocaleString("fa-IR") : "بدون deadline"}</td>
                        <td>{durationLabel(elapsed)}{overdue || recordedBreach ? " · نقض SLA" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="dashboard-side">
          <Breakdown title="توزیع وضعیت" rows={metrics.byStatus.map((row) => ({ ...row, label: WORK_ITEM_STATUS_LABEL[row.key as keyof typeof WORK_ITEM_STATUS_LABEL] ?? row.key }))} total={metrics.total} />
          <Breakdown title="صف‌های عملیات" rows={metrics.byQueue.map((row) => ({ ...row, label: QUEUE_KEY_LABEL[row.key as keyof typeof QUEUE_KEY_LABEL] ?? row.key }))} total={metrics.total} />
          <Breakdown title="انواع عملیات" rows={metrics.byType.map((row) => ({ ...row, label: WORK_ITEM_TYPE_LABEL[row.key as keyof typeof WORK_ITEM_TYPE_LABEL] ?? row.key }))} total={metrics.total} />
        </div>
      </div>

      {!personal && metrics.byOperator.length > 0 ? (
        <section className="card panel report-section">
          <div className="section-label"><h2>عملکرد اپراتورها</h2><span>فقط کارهای تخصیص‌یافته</span></div>
          <div className="table-wrap"><table><thead><tr><th>اپراتور</th><th>تخصیص‌یافته</th><th>تکمیل‌شده</th><th>نقض SLA</th><th>میانگین زمان تکمیل</th></tr></thead><tbody>{metrics.byOperator.map((row) => <tr key={row.key}><td>{row.label}</td><td>{number(row.count)}</td><td>{number(row.completed)}</td><td>{number(row.breached)}</td><td>{durationLabel(row.averageCompletionMinutes)}</td></tr>)}</tbody></table></div>
        </section>
      ) : null}
    </>
  );

  return embedded ? content : <main className="page-shell">{content}</main>;
}

function Metric({ label, value, foot, danger = false }: { label: string; value: string; foot: string; danger?: boolean }) {
  return <div className="card kpi" style={{ ["--accent" as string]: danger ? "#d94a4a" : "#21b4b0", ["--tint" as string]: danger ? "#fdeceb" : "#dff7f5" }}><div className="kpi-top"><span>{label}</span></div><p className="kpi-value">{value}</p><p className={`kpi-trend ${danger ? "trend-down" : "trend-neutral"}`}>{foot}</p></div>;
}

function Breakdown({ title, rows, total }: { title: string; rows: readonly { key: string; label: string; count: number; breached: number }[]; total: number }) {
  return <section className="card panel"><div className="section-label"><h2>{title}</h2></div>{rows.length === 0 ? <p className="empty-hint">داده‌ای ثبت نشده است.</p> : <div className="mix-list">{rows.map((row) => <div className="mix-row" key={row.key}><span>{row.label}</span><strong>{number(row.count)}{row.breached > 0 ? ` · ${number(row.breached)} نقض` : ""}</strong><div className="mix-bar"><span style={{ width: `${Math.max(4, (row.count / Math.max(total, 1)) * 100)}%` }} /></div></div>)}</div>}</section>;
}
