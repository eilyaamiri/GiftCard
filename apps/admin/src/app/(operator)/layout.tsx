import { AppShell } from "@/components/app-shell";
import { OPERATOR_NAV } from "@/lib/nav";

export default function OperatorLayout({ children }: { children: React.ReactNode }) {
  // TODO(auth): staff identity comes from the server session once B6 (identity) ships.
  return (
    <AppShell sections={OPERATOR_NAV} title="میزکار اپراتور" staffName="محمد رضایی" staffRoleLabel="اپراتور تحویل">
      {children}
    </AppShell>
  );
}
