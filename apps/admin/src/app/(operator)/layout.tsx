import { AppShell } from "@/components/app-shell";
import { LogoutButton } from "@/app/login/logout-button";
import { OPERATOR_NAV } from "@/lib/nav";
import { OPERATOR_ROLES, STAFF_ROLE_LABELS } from "@/lib/api";
import { requireRole } from "@/lib/session";

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireRole(OPERATOR_ROLES);

  return (
    <>
      <AppShell
        sections={OPERATOR_NAV}
        title="میزکار اپراتور"
        staffName={staff.email}
        staffRoleLabel={STAFF_ROLE_LABELS[staff.role]}
      >
        {children}
      </AppShell>
      <LogoutButton />
    </>
  );
}
