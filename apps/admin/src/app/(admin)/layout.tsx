import { AppShell } from "@/components/app-shell";
import { ADMIN_NAV } from "@/lib/nav";
import { BACK_OFFICE_ROLES, STAFF_ROLE_LABELS, hasRole } from "@/lib/api";
import { requireRole } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireRole(BACK_OFFICE_ROLES);

  // Trimming the sidebar keeps operators from staring at links they cannot use.
  // Each page still asks the server again, and so does every request behind it.
  const sections = ADMIN_NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => hasRole(staff.role, item.roles)),
  })).filter((section) => section.items.length > 0);

  const visibleHrefs = new Set(sections.flatMap((section) => section.items.map((item) => item.href)));
  const profileShortcuts = [
    { href: "/dashboard", label: "داشبورد", icon: "layout-dashboard" },
    { href: "/customers", label: "نمای ۳۶۰ مشتری", icon: "user-cog" },
    { href: "/work-queue", label: "صف کارها", icon: "list-checks" },
    { href: "/settings", label: "تنظیمات", icon: "settings" },
  ].filter((shortcut) => visibleHrefs.has(shortcut.href)).slice(0, 3);

  return (
    <>
      <AppShell
        sections={sections}
        title="پنل ادمین"
        staffName={staff.email}
        staffRoleLabel={STAFF_ROLE_LABELS[staff.role]}
        profileShortcuts={profileShortcuts}
      >
        {children}
      </AppShell>
    </>
  );
}
