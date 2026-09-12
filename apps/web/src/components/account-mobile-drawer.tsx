'use client';

import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { AccountSidebarNav } from '@/components/account-sidebar-nav';

export function AccountMobileDrawer({
  name,
  initial,
}: Readonly<{
  name: string;
  initial: string;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => {
      if (mediaQuery.matches) dialogRef.current?.close();
    };

    mediaQuery.addEventListener('change', closeOnDesktop);
    return () => mediaQuery.removeEventListener('change', closeOnDesktop);
  }, []);

  function closeDrawer() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        className="account-mobile-drawer-trigger"
        aria-label="باز کردن منوی پنل"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Menu size={21} aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        className="account-mobile-drawer"
        aria-label="منوی پنل کاربری"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
      >
        <div className="account-mobile-drawer-panel">
          <div className="account-mobile-drawer-head">
            <Link href="/" className="account-brand" aria-label="برات، صفحه اصلی" onClick={closeDrawer}>
              <span className="logo-mark">ب</span>
              <span><strong>برات</strong><small>پنل کاربری</small></span>
            </Link>
            <button autoFocus type="button" className="account-mobile-drawer-close" aria-label="بستن منو" onClick={closeDrawer}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <AccountSidebarNav onNavigate={closeDrawer} />
          <div className="account-sidebar-footer">
            <div className="account-sidebar-user">
              <span className="account-avatar">{initial}</span>
              <span><strong>{name}</strong><small>حساب فعال</small></span>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
