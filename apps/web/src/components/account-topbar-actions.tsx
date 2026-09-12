'use client';

import Link from 'next/link';
import { formatJalaliDate, toPersianDigits } from '@barat/ui';
import {
  Bell,
  CircleAlert,
  CircleCheckBig,
  CreditCard,
  ChevronDown,
  LayoutDashboard,
  LifeBuoy,
  MessageCircle,
  ReceiptText,
  RotateCcw,
  Search,
  Settings2,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountMobileDrawer } from '@/components/account-mobile-drawer';
import { LogoutButton } from '@/app/account/logout-button';
import { api, type AccountNotificationFeed } from '@/lib/api';
import {
  readMarkerStorageKey,
  readStoredMarker,
  unreadCount,
  writeStoredMarker,
} from '@/lib/notification-feed';

interface AccountShortcut {
  href: string;
  label: string;
  icon: LucideIcon;
}

const SHORTCUTS: readonly AccountShortcut[] = [
  { href: '/account', label: 'نمای کلی حساب', icon: LayoutDashboard },
  { href: '/account/profile', label: 'اطلاعات حساب', icon: Settings2 },
  { href: '/account/orders', label: 'سفارش‌های من', icon: ShoppingBag },
  { href: '/account/payments', label: 'پرداخت‌ها', icon: ReceiptText },
  { href: '/account/support', label: 'پشتیبانی و تیکت‌ها', icon: LifeBuoy },
];

const NOTIFICATION_POLL_MS = 60_000;

function notificationIcon(kind: string): LucideIcon {
  if (kind === 'SUPPORT_REPLY') return MessageCircle;
  if (kind.startsWith('REFUND_')) return RotateCcw;
  if (kind === 'ORDER_DELIVERED') return CircleCheckBig;
  if (kind === 'ORDER_PAID') return CreditCard;
  if (kind === 'ORDER_CANCELLED' || kind === 'ORDER_FAILED') return CircleAlert;
  return ShoppingBag;
}

export function AccountTopbarActions({
  name,
  customerCode,
  initial,
}: Readonly<{
  name: string;
  customerCode: string;
  initial: string;
}>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [notificationFeed, setNotificationFeed] = useState<AccountNotificationFeed | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [notificationReadThrough, setNotificationReadThrough] = useState<string | null>(null);
  const profileRef = useRef<HTMLDetailsElement>(null);
  const notificationsRef = useRef<HTMLDetailsElement>(null);
  const notificationReadThroughRef = useRef<string | null>(null);
  const notificationRequestRef = useRef(0);
  const mountedRef = useRef(false);
  const notificationStorageKey = readMarkerStorageKey(customerCode);

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
      const nextFeed = await api.accountNotifications();
      if (!mountedRef.current || requestId !== notificationRequestRef.current) return;

      setNotificationFeed(nextFeed);
      setNotificationStatus('ready');
      /* Seed on first load, and keep the marker moving while the panel is open —
       * the customer is looking at the list as the new lines arrive. */
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

  const unreadNotificationCount = unreadCount(
    notificationFeed?.items ?? [],
    notificationReadThrough,
  );
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('fa');
  const searchResults =
    normalizedQuery.length === 0
      ? []
      : SHORTCUTS.filter((item) => item.label.toLocaleLowerCase('fa').includes(normalizedQuery));

  function closeProfileMenu() {
    if (profileRef.current) profileRef.current.open = false;
  }

  return (
    <div className="account-topbar-actions">
      <details
        className="account-profile"
        ref={profileRef}
        onToggle={(event) => {
          if (event.currentTarget.open && notificationsRef.current) {
            notificationsRef.current.open = false;
          }
        }}
      >
        <summary className="account-profile-trigger" aria-label="باز کردن منوی پروفایل">
          <span className="account-avatar">{initial}</span>
          <span className="account-profile-copy">
            <strong>{name}</strong>
            <small>{customerCode}</small>
          </span>
          <ChevronDown className="account-profile-chevron" size={15} aria-hidden="true" />
        </summary>
        <div className="account-profile-menu">
          <div className="account-profile-menu-head">
            <span className="account-avatar">{initial}</span>
            <span>
              <strong>{name}</strong>
              <small>{customerCode}</small>
            </span>
          </div>
          <span className="account-profile-label">میانبرهای حساب</span>
          <nav className="account-profile-shortcuts" aria-label="میانبرهای حساب کاربری">
            {SHORTCUTS.map((shortcut) => {
              const ShortcutIcon = shortcut.icon;
              return (
                <Link
                  href={shortcut.href}
                  className="account-profile-link"
                  key={shortcut.href}
                  onClick={closeProfileMenu}
                >
                  <ShortcutIcon size={16} />
                  <span>{shortcut.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="account-profile-separator" />
          <LogoutButton />
        </div>
      </details>

      <details
        className="account-notifications"
        ref={notificationsRef}
        onToggle={(event) => {
          if (!event.currentTarget.open) return;
          if (profileRef.current) profileRef.current.open = false;
          if (notificationFeed !== null) markNotificationsRead(notificationFeed.generatedAt);
          void refreshNotifications();
        }}
      >
        <summary
          className="account-icon-button"
          aria-label={
            unreadNotificationCount > 0
              ? `${toPersianDigits(unreadNotificationCount)} اعلان خوانده‌نشده`
              : 'اعلان‌ها'
          }
        >
          <Bell size={18} aria-hidden="true" />
          {unreadNotificationCount > 0 ? (
            <span className="account-notification-dot" aria-hidden="true" />
          ) : null}
        </summary>
        <div className="account-notification-menu">
          <div className="account-notification-head">
            <strong>اعلان‌ها</strong>
            {unreadNotificationCount > 0 ? (
              <span>{toPersianDigits(unreadNotificationCount)} خوانده‌نشده</span>
            ) : null}
          </div>
          {notificationFeed !== null && notificationFeed.items.length > 0 ? (
            <div className="account-notification-list" role="list">
              {notificationFeed.items.map((notification) => {
                const NotificationIcon = notificationIcon(notification.kind);
                const content = (
                  <>
                    <span className="account-notification-kind">
                      <NotificationIcon size={15} aria-hidden="true" />
                    </span>
                    <span className="account-notification-copy">
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
                    className="account-notification-item"
                    role="listitem"
                    key={notification.id}
                    onClick={() => {
                      if (notificationsRef.current) notificationsRef.current.open = false;
                    }}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="account-notification-item" role="listitem" key={notification.id}>
                    {content}
                  </div>
                );
              })}
            </div>
          ) : notificationStatus === 'loading' ? (
            <p className="account-notification-state" aria-live="polite">
              در حال دریافت اعلان‌ها…
            </p>
          ) : notificationStatus === 'error' ? (
            <div className="account-notification-state" role="alert">
              <p>دریافت اعلان‌ها ممکن نشد.</p>
              <button type="button" onClick={() => void refreshNotifications()}>
                تلاش دوباره
              </button>
            </div>
          ) : (
            <p className="account-notification-state">اعلان جدیدی برای حساب شما ثبت نشده است.</p>
          )}
        </div>
      </details>

      <div className="account-panel-search">
        <label className="account-search-field">
          <Search size={17} aria-hidden="true" />
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
            aria-label="جست‌وجو در بخش‌های پنل کاربری"
            autoComplete="off"
          />
        </label>
        {normalizedQuery ? (
          <div className="account-search-results" role="listbox" aria-label="نتایج جست‌وجوی پنل">
            {searchResults.length > 0 ? (
              searchResults.map((item) => {
                const ResultIcon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="account-search-result"
                    onClick={() => setSearchQuery('')}
                  >
                    <ResultIcon size={16} />
                    <span>{item.label}</span>
                  </Link>
                );
              })
            ) : (
              <p>بخشی با این عنوان پیدا نشد.</p>
            )}
          </div>
        ) : null}
      </div>

      <AccountMobileDrawer name={name} initial={initial} />
    </div>
  );
}
