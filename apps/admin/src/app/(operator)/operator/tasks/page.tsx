import { BACK_OFFICE_ROLES, hasRole } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { ErrorNotice } from "../../_components/error-notice";
import { MAX_CONCURRENT_WORK_ITEMS, workItems, type WorkItemSummary } from "../../_lib/work-items";
import { TasksList } from "./tasks-list";

export const metadata = { title: "تسک‌ها | برات پی" };

export default async function OperatorTasksPage() {
  const staff = await requireSession();

  /* An operator's queue is their own desk plus what they may pick up. A manager
   * holds no desk — every task they need is on someone else's — so they get the
   * whole active board instead, which is the only way to reach a task that has
   * already been claimed. */
  const supervising = hasRole(staff.role, BACK_OFFICE_ROLES);

  let mine: { items: WorkItemSummary[]; capacityUsed: number };
  let pool: WorkItemSummary[];
  let board: WorkItemSummary[];
  try {
    [mine, pool, board] = await Promise.all([
      workItems.mine(),
      workItems.list({ status: "UNASSIGNED" }),
      supervising ? workItems.list({ take: 200 }) : Promise.resolve([]),
    ]);
  } catch (error) {
    return <ErrorNotice error={error} title="صف کاری در دسترس نیست" />;
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{supervising ? "عملیات و بازرسی" : "میزکار"}</p>
          <h1>تسک‌ها</h1>
        </div>
        {supervising ? (
          <p className="muted">هر تسک را می‌توانید باز کنید؛ اقدام‌های مدیریتی داخل خود تسک در دسترس است.</p>
        ) : (
          <p className="muted">
            ظرفیت هم‌زمان: {mine.capacityUsed.toLocaleString("fa-IR")} از{" "}
            {MAX_CONCURRENT_WORK_ITEMS.toLocaleString("fa-IR")}
          </p>
        )}
      </div>
      <TasksList
        mine={mine.items}
        pool={pool}
        board={board}
        supervising={supervising}
        capacityUsed={mine.capacityUsed}
      />
    </div>
  );
}
