import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import type { QueueKey } from "@barat/contracts";
import { QUEUE_VIEW_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { ErrorNotice } from "../../(operator)/_components/error-notice";
import {
  ACTIVE_STATUSES,
  QUEUE_KEY_LABEL,
  WORK_ITEM_STATUS_LABEL,
  isOverdue,
  workItems,
  type WorkItemSummary,
} from "../../(operator)/_lib/work-items";

export const metadata = { title: "صف کارها | پنل ادمین برات پی" };

interface QueueRow {
  readonly key: QueueKey;
  readonly open: number;
  readonly unassigned: number;
  readonly inProgress: number;
  readonly overdue: number;
}

export default async function WorkQueuePage() {
  await requireRole(QUEUE_VIEW_ROLES);

  let items: WorkItemSummary[];
  try {
    items = await workItems.list({ take: 200 });
  } catch (error) {
    return <ErrorNotice error={error} title="صف کارها بارگذاری نشد" />;
  }

  const open = items.filter(
    (item) => item.status === "UNASSIGNED" || ACTIVE_STATUSES.includes(item.status),
  );

  const byQueue = new Map<QueueKey, QueueRow>();
  for (const item of open) {
    const row = byQueue.get(item.queueKey) ?? {
      key: item.queueKey,
      open: 0,
      unassigned: 0,
      inProgress: 0,
      overdue: 0,
    };
    byQueue.set(item.queueKey, {
      key: row.key,
      open: row.open + 1,
      unassigned: row.unassigned + (item.status === "UNASSIGNED" ? 1 : 0),
      inProgress: row.inProgress + (item.status === "IN_PROGRESS" ? 1 : 0),
      overdue: row.overdue + (isOverdue(item) ? 1 : 0),
    });
  }

  const queues = [...byQueue.values()].sort((a, b) => b.open - a.open);
  const totals = queues.reduce(
    (acc, queue) => ({
      open: acc.open + queue.open,
      unassigned: acc.unassigned + queue.unassigned,
      overdue: acc.overdue + queue.overdue,
    }),
    { open: 0, unassigned: 0, overdue: 0 },
  );

  const unassigned = open.filter((item) => item.status === "UNASSIGNED");

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات و بازرسی</p>
          <h1>صف کارها</h1>
        </div>
        <p className="muted">دید مدیریتی روی همهٔ صف‌ها — کار فردی در میزکار اپراتور انجام می‌شود</p>
      </div>

      <div className="stat-strip">
        <div className="card stat-tile">
          <span>کل کارهای باز</span>
          <strong>{toPersianDigits(totals.open)}</strong>
        </div>
        <div className="card stat-tile">
          <span>بدون تخصیص</span>
          <strong>{toPersianDigits(totals.unassigned)}</strong>
        </div>
        <div className="card stat-tile">
          <span>عقب‌افتاده از موعد</span>
          <strong className={totals.overdue > 0 ? "freshness-bad" : ""}>{toPersianDigits(totals.overdue)}</strong>
        </div>
        <div className="card stat-tile">
          <span>صف‌های دارای کار باز</span>
          <strong>{toPersianDigits(queues.length)}</strong>
        </div>
      </div>

      <div className="card list-card">
        <div className="panel-heading">
          <h2 className="panel-title">صف‌ها</h2>
          <span className="panel-caption">فقط کارهای باز شمرده می‌شوند</span>
        </div>
        {queues.length === 0 ? (
          <p className="empty-hint">هیچ کار بازی در هیچ صفی وجود ندارد.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>صف</th>
                  <th>کل باز</th>
                  <th>بدون تخصیص</th>
                  <th>در حال انجام</th>
                  <th>عقب‌افتاده</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((queue) => (
                  <tr key={queue.key}>
                    <td>{QUEUE_KEY_LABEL[queue.key]}</td>
                    <td>{toPersianDigits(queue.open)}</td>
                    <td>{toPersianDigits(queue.unassigned)}</td>
                    <td>{toPersianDigits(queue.inProgress)}</td>
                    <td>
                      {queue.overdue > 0 ? (
                        <span className="badge badge-danger">{toPersianDigits(queue.overdue)} عقب‌افتاده</span>
                      ) : (
                        <span className="muted">{toPersianDigits(0)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card list-card" style={{ marginBlockStart: 16 }}>
        <div className="panel-heading">
          <h2 className="panel-title">کارهای بدون تخصیص</h2>
          <span className="panel-caption">{toPersianDigits(unassigned.length)} مورد</span>
        </div>
        {unassigned.length === 0 ? (
          <p className="empty-hint">هیچ کاری بدون تخصیص نمانده است.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>شناسه</th>
                  <th>عنوان</th>
                  <th>صف</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.slice(0, 25).map((item) => (
                  <tr key={item.id}>
                    <td className="bp-ltr">
                      <Link href={`/operator/tasks/${item.id}`}>{item.code}</Link>
                    </td>
                    <td>{item.title}</td>
                    <td>{QUEUE_KEY_LABEL[item.queueKey]}</td>
                    <td>{WORK_ITEM_STATUS_LABEL[item.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
