import { AppShell } from "@/components/app-shell";
import { ADMIN_NAV } from "@/lib/nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // TODO(auth): staff identity comes from the server session once B6 (identity) ships
  // the /api/staff/me endpoint. Values below are the signed-in shape, not a real user.
  return (
    <AppShell sections={ADMIN_NAV} title="پنل ادمین" staffName="سارا احمدی" staffRoleLabel="مدیر عملیات">
      {children}
    </AppShell>
  );
}
