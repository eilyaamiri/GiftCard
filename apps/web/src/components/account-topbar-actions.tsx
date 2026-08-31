'use client';

import Link from 'next/link';
import {
  Bell,
  ChevronDown,
  LayoutDashboard,
  LifeBuoy,
  ReceiptText,
  Search,
  Settings2,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { LogoutButton } from '@/app/account/logout-button';

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
  const profileRef = useRef<HTMLDetailsElement>(null);
  const notificationsRef = useRef<HTMLDetailsElement>(null);
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
          if (event.currentTarget.open && profileRef.current) {
            profileRef.current.open = false;
          }
        }}
      >
        <summary className="account-icon-button" aria-label="اعلان‌ها">
          <Bell size={18} aria-hidden="true" />
        </summary>
        <div className="account-notification-menu">
          <strong>اعلان‌ها</strong>
          <p>اعلان جدیدی برای حساب شما ثبت نشده است.</p>
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
    </div>
  );
}
