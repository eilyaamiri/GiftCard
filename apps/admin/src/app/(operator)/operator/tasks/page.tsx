import { TasksList } from "./tasks-list";

export const metadata = { title: "تسک‌ها | میزکار اپراتور برات پی" };

export default function OperatorTasksPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">میزکار</p>
          <h1>تسک‌های من</h1>
        </div>
      </div>
      <TasksList />
    </div>
  );
}
