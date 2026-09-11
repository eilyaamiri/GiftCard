'use client';

import Link from 'next/link';
import { formatJalaliDate, toPersianDigits } from '@barat/ui';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavSection } from '@/lib/nav';
import { api, type StaffNotificationFeed } from '@/lib/api';
import {
  readMarkerStorageKey,
  readStoredMarker,
  unreadCount,
  writeStoredMarker,
} from '@/lib/notification-feed';
import { Icon } from '@/components/icon-map';
import { LogoutButton } from '@/app/login/logout-button';

export interface ProfileShortcut {
  href: string;
  label: string;
  icon: string;
}

const NOTIFICATION_POLL_MS = 60_000;

function notificationIcon(kind: string): string {
  if (kind === 'SUPPORT_CUSTOMER_REPLY') return 'life-buoy';
  if (kind === 'TASK_SLA_BREACHED' || kind === 'TASK_DUE_SOON') {
    return 'message-square-warning';
  }
  if (kind === 'QUEUE_TASK_WAITING') return 'list-checks';
  return 'clipboard-list';
}

/**
 * Shared admin/operator shell: 260px navy sidebar + 74px topbar.
 * RBAC filtering here is a convenience only — the API enforces the real rule.
 */
export function AppShell({
  sections,
  title,
  staffId,
  staffName,
  staffRoleLabel,
  profileShortcuts,
  children,
}: {
  sections: NavSection[];
  title: string;
  staffId: string;
  staffName: string;
  staffRoleLabel: string;
  profileShortcuts: readonly ProfileShortcut[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notificationFeed, setNotificationFeed] = useState<StaffNotificationFeed | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [notificationReadThrough, setNotificationReadThrough] = useState<string | null>(null);
  const profileRef = useRef<HTMLDetailsElement>(null);
  const notificationsRef = useRef<HTMLDetailsElement>(null);
  const notificationReadThroughRef = useRef<string | null>(null);
  const notificationRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const notificationStorageKey = readMarkerStorageKey(staffId);

  const markNotificationsRead = useCallback(
    (marker: string) => {
      notificationReadThroughRef.current = marker;
      setNotificationReadThrough(marker);
      writeStoredMarker(notificationStorageKey, marker);
    },
    [notificationStorageKey],
  );

  const refreshNotifications = useCallback(async () => {
    const requestId = ++notificationRequestRef.current;
    try {
      const nextFeed = await api.staffNotifications();
      if (!mountedRef.current || requestId !== notificationRequestRef.current) return;

      setNotificationFeed(nextFeed);
      setNotificationStatus('ready');
      /* Seed on first load, and keep the marker moving while the panel is open —
       * the operator is looking at the list as the new lines arrive. */
      if (notificationReadThroughRef.current === null || notificationsRef.current?.open) {
        markNotificationsRead(nextFeed.generatedAt);
      }
    } catch {
      if (mountedRef.current && requestId === notificationRequestRef.current) {
        setNotificationStatus('error');
      }
    }
  }, [markNotificationsRead]);

  useEffect(() => {
    mountedRef.current = true;
    const storedMarker = readStoredMarker(notificationStorageKey);
    notificationReadThroughRef.current = storedMarker;
    setNotificationReadThrough(storedMarker);
    void refreshNotifications();

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    }, NOTIFICATION_POLL_MS);
    const refreshVisibleFeed = () => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    };
    document.addEventListener('visibilitychange', refreshVisibleFeed);

    return () => {
      mountedRef.current = false;
      notificationRequestRef.current += 1;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisibleFeed);
    };
  }, [notificationStorageKey, refreshNotifications]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavOpen]);

  const unreadNotificationCount = unreadCount(
    notificationFeed?.items ?? [],
    notificationReadThrough,
  );
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
    <div className={`app-shell${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
      <button
        type="button"
        className="mobile-nav-backdrop"
        aria-label="بستن منوی اصلی"
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={() => setMobileNavOpen(false)}
      />
      <aside id="mobile-main-navigation" className="sidebar" aria-label="منوی اصلی">
        <div className="brand">
          <button
            type="button"
            className="mobile-nav-close"
            aria-label="بستن منوی اصلی"
            onClick={() => setMobileNavOpen(false)}
          >
            ×
          </button>
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
                    onClick={() => setMobileNavOpen(false)}
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
            <button
              type="button"
              className="mobile-nav-toggle"
              aria-label="باز کردن منوی اصلی"
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-main-navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <details
              className="staff-profile"
              ref={profileRef}
              onToggle={(event) => {
                if (event.currentTarget.open && notificationsRef.current) {
                  notificationsRef.current.open = false;
                }
              }}
            >
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

            <details
              className="topbar-notifications"
              ref={notificationsRef}
              onToggle={(event) => {
                if (!event.currentTarget.open) return;
                if (profileRef.current) profileRef.current.open = false;
                if (notificationFeed !== null) markNotificationsRead(notificationFeed.generatedAt);
                void refreshNotifications();
              }}
            >
              <summary
                className="icon-button"
                aria-label={
                  unreadNotificationCount > 0
                    ? `${toPersianDigits(unreadNotificationCount)} اعلان خوانده‌نشده`
                    : 'اعلان‌ها'
                }
              >
                <Icon name="bell" size={17} />
                {unreadNotificationCount > 0 ? (
                  <span className="topbar-notification-dot" aria-hidden="true" />
                ) : null}
              </summary>
              <div className="topbar-notification-menu">
                <div className="topbar-notification-head">
                  <strong>اعلان‌ها</strong>
                  {unreadNotificationCount > 0 ? (
                    <span>{toPersianDigits(unreadNotificationCount)} خوانده‌نشده</span>
                  ) : null}
                </div>
                {notificationFeed !== null && notificationFeed.items.length > 0 ? (
                  <div className="topbar-notification-list" role="list">
                    {notificationFeed.items.map((notification) => {
                      const content = (
                        <>
                          <span className="topbar-notification-kind">
                            <Icon name={notificationIcon(notification.kind)} size={14} />
                          </span>
                          <span className="topbar-notification-copy">
                            <strong>{notification.title}</strong>
                            {notification.body ? <span>{notification.body}</span> : null}
                            <time dateTime={notification.createdAt}>
                              {formatJalaliDate(notification.createdAt)}
                            </time>
                          </span>
                        </>
                      );

                      return notification.href ? (
                        <Link
                          href={notification.href}
                          className="topbar-notification-item"
                          role="listitem"
                          key={notification.id}
                          onClick={() => {
                            if (notificationsRef.current) notificationsRef.current.open = false;
                          }}
                        >
                          {content}
                        </Link>
                      ) : (
                        <div
                          className="topbar-notification-item"
                          role="listitem"
                          key={notification.id}
                        >
                          {content}
                        </div>
                      );
                    })}
                  </div>
                ) : notificationStatus === 'loading' ? (
                  <p className="topbar-notification-state" aria-live="polite">
                    در حال دریافت اعلان‌ها…
                  </p>
                ) : notificationStatus === 'error' ? (
                  <div className="topbar-notification-state" role="alert">
                    <p>دریافت اعلان‌ها ممکن نشد.</p>
                    <button type="button" onClick={() => void refreshNotifications()}>
                      تلاش دوباره
                    </button>
                  </div>
                ) : (
                  <p className="topbar-notification-state">اعلان جدیدی برای شما ثبت نشده است.</p>
                )}
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
