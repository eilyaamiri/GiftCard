import { ErrorNotice } from "../../_components/error-notice";
import { MAX_CONCURRENT_WORK_ITEMS, workItems, type WorkItemSummary } from "../../_lib/work-items";
import { TasksList } from "./tasks-list";

export const metadata = { title: "تسک‌ها | میزکار اپراتور برات پی" };

export default async function OperatorTasksPage() {
  let mine: { items: WorkItemSummary[]; capacityUsed: number };
  let pool: WorkItemSummary[];
  try {
    [mine, pool] = await Promise.all([workItems.mine(), workItems.list({ status: "UNASSIGNED" })]);
  } catch (error) {
    return <ErrorNotice error={error} title="صف کاری در دسترس نیست" />;
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">میزکار</p>
          <h1>تسک‌ها</h1>
        </div>
        <p className="muted">
          ظرفیت هم‌زمان: {mine.capacityUsed.toLocaleString("fa-IR")} از {MAX_CONCURRENT_WORK_ITEMS.toLocaleString("fa-IR")}
        </p>
      </div>
      <TasksList mine={mine.items} pool={pool} capacityUsed={mine.capacityUsed} />
    </div>
  );
}
