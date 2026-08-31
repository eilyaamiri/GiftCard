"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavSection } from "@/lib/nav";
import { Icon } from "@/components/icon-map";
import { LogoutButton } from "@/app/login/logout-button";

/**
 * Shared admin/operator shell: 260px navy sidebar + 74px topbar.
 * RBAC filtering here is a convenience only — the API enforces the real rule.
 */
export function AppShell({
  sections,
  title,
  staffName,
  staffRoleLabel,
  children,
}: {
  sections: NavSection[];
  title: string;
  staffName: string;
  staffRoleLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="منوی اصلی">
        <div className="brand">
          <div className="brand-mark">ب</div>
          <div>
            <span className="brand-name">برات پی</span>
            <span className="brand-sub">پنل عملیات</span>
          </div>
        </div>

        <nav style={{ flex: 1, overflowY: "auto" }}>
          {sections.map((section) => (
            <div key={section.title}>
              <p className="nav-section">{section.title}</p>
              {section.items.map((item) => {
                const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                return (
                  <Link key={item.href} href={item.href} className={`nav-link${active ? " active" : ""}`}>
                    <span className="nav-icon">
                      <Icon name={item.icon} size={17} />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="staff-mini">
            <div className="avatar">{staffName.slice(0, 1)}</div>
            <div>
              <strong>{staffName}</strong>
              <small>{staffRoleLabel}</small>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <p className="topbar-title">{title}</p>
          <div className="topbar-actions">
            <details className="staff-profile">
              <summary className="staff-profile-trigger">
                <span className="avatar">{staffName.slice(0, 1)}</span>
                <span className="staff-profile-copy">
                  <strong>{staffName}</strong>
                  <small>{staffRoleLabel}</small>
                </span>
                <span className="staff-profile-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div className="staff-profile-menu">
                <div className="staff-profile-label">حساب کاربری</div>
                <LogoutButton />
              </div>
            </details>
            <label className="search">
              <Icon name="search" size={16} />
              <input type="search" placeholder="جست‌وجوی سفارش، مشتری، کد پیگیری…" aria-label="جست‌وجوی سراسری" />
            </label>
            <button type="button" className="icon-button" aria-label="اعلان‌ها">
              <Icon name="bell" size={17} />
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
