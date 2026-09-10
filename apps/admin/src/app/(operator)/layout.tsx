import { AppShell } from "@/components/app-shell";
import { navFor } from "@/lib/nav";
import { BACK_OFFICE_ROLES, OPERATOR_ROLES, STAFF_ROLE_LABELS, hasRole } from "@/lib/api";
import { requireRole } from "@/lib/session";

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireRole(OPERATOR_ROLES);

  /* A manager reaching a task from the back office keeps their own sidebar. The
   * task page is deliberately the same one an operator sees — what changes with
   * the role is which controls it draws, not which product it looks like. */
  const backOffice = hasRole(staff.role, BACK_OFFICE_ROLES);
  const { sections, title } = navFor(staff.role);

  return (
    <>
      <AppShell
        sections={sections}
        title={title}
        staffId={staff.id}
        staffName={staff.email}
        staffRoleLabel={STAFF_ROLE_LABELS[staff.role]}
        profileShortcuts={
          backOffice
            ? [
                { href: "/dashboard", label: "داشبورد", icon: "layout-dashboard" },
                { href: "/operator/tasks", label: "تسک‌ها", icon: "clipboard-list" },
                { href: "/work-queue", label: "صف کارها", icon: "list-checks" },
              ]
            : [
                { href: "/operator", label: "میز من", icon: "layout-dashboard" },
                { href: "/operator/tasks", label: "تسک‌های من", icon: "list-checks" },
                { href: "/operator/support", label: "تیکت‌های پشتیبانی", icon: "life-buoy" },
                { href: "/operator/performance", label: "عملکرد من", icon: "line-chart" },
              ]
        }
      >
        {children}
      </AppShell>
    </>
  );
}
