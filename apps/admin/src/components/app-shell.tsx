'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { NavSection } from '@/lib/nav';
import { Icon } from '@/components/icon-map';
import { LogoutButton } from '@/app/login/logout-button';

export interface ProfileShortcut {
  href: string;
  label: string;
  icon: string;
}

/**
 * Shared admin/operator shell: 260px navy sidebar + 74px topbar.
 * RBAC filtering here is a convenience only — the API enforces the real rule.
 */
export function AppShell({
  sections,
  title,
  staffName,
  staffRoleLabel,
  profileShortcuts,
  children,
}: {
  sections: NavSection[];
  title: string;
  staffName: string;
  staffRoleLabel: string;
  profileShortcuts: readonly ProfileShortcut[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');
  const searchableLinks = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('fa');
  const searchResults =
    normalizedQuery.length === 0
      ? []
      : searchableLinks
          .filter((item) =>
            `${item.label} ${item.href}`.toLocaleLowerCase('fa').includes(normalizedQuery),
          )
          .slice(0, 6);

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

        <nav style={{ flex: 1, overflowY: 'auto' }}>
          {sections.map((section) => (
            <div key={section.title}>
              <p className="nav-section">{section.title}</p>
              {section.items.map((item) => {
                const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-link${active ? ' active' : ''}`}
                  >
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
              <summary className="staff-profile-trigger" aria-label="باز کردن منوی پروفایل">
                <span className="avatar">{staffName.slice(0, 1)}</span>
                <span className="staff-profile-copy">
                  <strong>{staffName}</strong>
                  <small>{staffRoleLabel}</small>
                </span>
                <span className="staff-profile-chevron" aria-hidden="true">
                  ⌄
                </span>
              </summary>
              <div className="staff-profile-menu">
                <div className="staff-profile-menu-head">
                  <span className="avatar">{staffName.slice(0, 1)}</span>
                  <span>
                    <strong>{staffName}</strong>
                    <small>{staffRoleLabel}</small>
                  </span>
                </div>
                <div className="staff-profile-label">میانبرها</div>
                <nav className="staff-profile-shortcuts" aria-label="میانبرهای پروفایل">
                  {profileShortcuts.map((shortcut) => (
                    <Link key={shortcut.href} href={shortcut.href} className="staff-profile-link">
                      <Icon name={shortcut.icon} size={16} />
                      <span>{shortcut.label}</span>
                    </Link>
                  ))}
                </nav>
                <div className="staff-profile-separator" />
                <LogoutButton />
              </div>
            </details>

            <details className="topbar-notifications">
              <summary className="icon-button" aria-label="اعلان‌ها">
                <Icon name="bell" size={17} />
              </summary>
              <div className="topbar-notification-menu">
                <strong>اعلان‌ها</strong>
                <p>اعلان جدیدی برای شما ثبت نشده است.</p>
              </div>
            </details>

            <div className="panel-search">
              <label className="search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setSearchQuery('');
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="جست‌وجو در پنل…"
                  aria-label="جست‌وجو در بخش‌های پنل"
                  autoComplete="off"
                />
              </label>
              {normalizedQuery ? (
                <div
                  className="panel-search-results"
                  role="listbox"
                  aria-label="نتایج جست‌وجوی پنل"
                >
                  {searchResults.length > 0 ? (
                    searchResults.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="panel-search-result"
                        onClick={() => setSearchQuery('')}
                      >
                        <Icon name={item.icon} size={15} />
                        <span>{item.label}</span>
                      </Link>
                    ))
                  ) : (
                    <p>بخشی با این عنوان پیدا نشد.</p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
