import Link from "next/link";
import { notFound } from "next/navigation";
import { findOperatorTask } from "@/lib/mock-operator";
import { OperatorTaskShell } from "./operator-task-shell";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = findOperatorTask(id);
  return { title: task ? `${task.title} | میزکار اپراتور برات پی` : "تسک یافت نشد" };
}

export default async function OperatorTaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = findOperatorTask(id);
  if (!task) notFound();

  return (
    <div>
      <p className="breadcrumb">
        <Link href="/operator/tasks">تسک‌ها</Link>
        <span>/</span>
        <span className="bp-ltr">{task.id}</span>
      </p>
      <OperatorTaskShell task={task} />
    </div>
  );
}
