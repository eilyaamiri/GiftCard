import { TASK_TYPE_LABEL } from "@/lib/mock-operator";
import type { OperatorTaskSummary } from "@/lib/mock-operator";
import { TASK_WORKSPACE_REGISTRY } from "./workspaces/registry";

/**
 * OperatorTaskShell renders the header shared by every task type, then looks
 * up the right workspace component from TASK_WORKSPACE_REGISTRY. Adding a
 * new WorkItemType means registering a component, not editing a switch here.
 */
export function OperatorTaskShell({ task }: { task: OperatorTaskSummary }) {
  const Workspace = TASK_WORKSPACE_REGISTRY[task.type];

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{TASK_TYPE_LABEL[task.type]}</p>
          <h1 className="order-id" style={{ color: "var(--ink)" }}>{task.title}</h1>
          <p className="muted" style={{ marginTop: 6 }}>{task.subtitle}</p>
        </div>
        <span className={task.priority === "HIGH" ? "priority-high" : "priority-normal"}>
          {task.overdue ? "دیرکرد از SLA" : task.priority === "HIGH" ? "اولویت فوری" : "اولویت عادی"}
        </span>
      </div>
      <Workspace task={task} />
    </div>
  );
}
