import Link from "next/link";
import { notFound } from "next/navigation";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { ApiClientError } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { ErrorNotice } from "../../../_components/error-notice";
import { canApproveCostVariance, fulfillment, type FulfillmentWorkspace } from "../../../_lib/fulfillment";
import { loadOrderContext } from "../../../_lib/order-context";
import { formatIrrStringAsToman } from "@/lib/format-bps";
import {
  QUEUE_KEY_LABEL,
  TERMINAL_STATUSES,
  WORK_ITEM_STATUS_LABEL,
  WORK_ITEM_TYPE_LABEL,
  isHighPriority,
  isOverdue,
  workItems,
  type WorkItemSummary,
} from "../../../_lib/work-items";
import { FulfillmentPanel } from "./fulfillment-panel";
import { TASK_GUIDANCE } from "./task-guidance";
import { TaskLifecyclePanel } from "./task-lifecycle-panel";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const item = await workItems.getById(id);
    return { title: `${item.title} | میزکار اپراتور برات پی` };
  } catch {
    return { title: "تسک | میزکار اپراتور برات پی" };
  }
}

export default async function OperatorTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireSession();

  let item: WorkItemSummary;
  try {
    item = await workItems.getById(id);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    return <ErrorNotice error={error} title="این تسک بارگذاری نشد" />;
  }

  const [order, workspaceResult] = await Promise.all([
    item.orderId ? loadOrderContext(item.orderId) : Promise.resolve(null),
    loadWorkspace(item.id),
  ]);

  const guidance = TASK_GUIDANCE[item.type];
  const isMine = item.assignedToStaffId === staff.id;
  const isClosed = TERMINAL_STATUSES.includes(item.status);

  return (
    <div>
      <p className="breadcrumb">
        <Link href="/operator/tasks">تسک‌ها</Link>
        <span>/</span>
        <span className="bp-ltr">{item.code}</span>
      </p>

      <div className="page-heading">
        <div>
          <p className="eyebrow">{WORK_ITEM_TYPE_LABEL[item.type]}</p>
          <h1 className="order-id" style={{ color: "var(--ink)" }}>
            {item.title}
          </h1>
          <p className="muted" style={{ marginBlockStart: 6 }}>
            {QUEUE_KEY_LABEL[item.queueKey]} · {WORK_ITEM_STATUS_LABEL[item.status]}
            {item.description ? ` · ${item.description}` : ""}
          </p>
        </div>
        <span className={isOverdue(item) || isHighPriority(item) ? "priority-high" : "priority-normal"}>
          {isOverdue(item) ? "دیرکرد از موعد" : isHighPriority(item) ? "اولویت بالا" : "اولویت عادی"}
        </span>
      </div>

      <div className="workspace-layout">
        <div className="workspace-main">
          <div className="card workspace-card">
            <div className="section-label">
              <h3>سفارش</h3>
              {order ? <span className="bp-ltr">{order.orderNumber}</span> : <span>بدون سفارش مرتبط</span>}
            </div>
            {order ? (
              <div className="details-grid">
                <div>
                  <p className="detail-label">عنوان</p>
                  <p className="detail-value">{order.itemTitleFa ?? "—"}</p>
                </div>
                <div>
                  <p className="detail-label">مبلغ پرداختی مشتری</p>
                  <p className="detail-value">{formatIrrStringAsToman(order.totalAmountIrr, { withSuffix: true })}</p>
                </div>
                <div>
                  <p className="detail-label">وضعیت سفارش</p>
                  <p className="detail-value bp-ltr">{order.status}</p>
                </div>
                <div>
                  <p className="detail-label">زمان پرداخت</p>
                  <p className="detail-value bp-ltr">{order.paidAt ? formatJalaliDate(order.paidAt) : "—"}</p>
                </div>
              </div>
            ) : (
              <p className="empty-hint">این کار به سفارشی متصل نیست.</p>
            )}
          </div>

          <div className="card workspace-card">
            <div className="section-label">
              <h3>دستور کار</h3>
            </div>
            <p className="muted" style={{ marginBlockStart: 0 }}>
              {guidance.headline}
            </p>
            <ol className="muted" style={{ marginBlockEnd: 0, paddingInlineStart: 18, lineHeight: 2 }}>
              {guidance.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          {workspaceResult.workspace ? (
            <FulfillmentPanel
              workItemId={item.id}
              initialWorkspace={workspaceResult.workspace}
              canOperate={isMine && !isClosed}
              canApprove={canApproveCostVariance(staff.role)}
            />
          ) : (
            <ErrorNotice error={workspaceResult.error} title="فضای کاری تحویل در دسترس نیست" />
          )}
        </div>

        <div className="workspace-control">
          <TaskLifecyclePanel item={item} isMine={isMine} />

          <div className="card workspace-card">
            <div className="section-label">
              <h3>مشخصات کار</h3>
            </div>
            <div className="kv-list">
              <div className="kv-row">
                <span>شناسه</span>
                <span className="bp-ltr">{item.code}</span>
              </div>
              <div className="kv-row">
                <span>اولویت</span>
                <span>{toPersianDigits(item.priority)}</span>
              </div>
              <div className="kv-row">
                <span>ایجاد</span>
                <span className="bp-ltr">{formatJalaliDate(item.createdAt)}</span>
              </div>
              <div className="kv-row">
                <span>تخصیص</span>
                <span className="bp-ltr">{item.assignedAt ? formatJalaliDate(item.assignedAt) : "—"}</span>
              </div>
              <div className="kv-row">
                <span>شروع</span>
                <span className="bp-ltr">{item.startedAt ? formatJalaliDate(item.startedAt) : "—"}</span>
              </div>
              <div className="kv-row">
                <span>موعد</span>
                <span className="bp-ltr">{item.dueAt ? formatJalaliDate(item.dueAt) : "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The workspace is refused with 403 when another operator holds the claim, which
 * is a legitimate state rather than a failure — the task page still has to
 * render, so the error is carried rather than thrown.
 */
async function loadWorkspace(
  workItemId: string,
): Promise<{ workspace: FulfillmentWorkspace; error: null } | { workspace: null; error: unknown }> {
  try {
    return { workspace: await fulfillment.getWorkspace(workItemId), error: null };
  } catch (error) {
    return { workspace: null, error };
  }
}
