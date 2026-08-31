"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, Headphones, ShoppingBag } from "lucide-react";
import type { CustomerDto } from "@barat/contracts";

function profileLabel(customer: CustomerDto): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return name || customer.maskedMobile || customer.maskedEmail || customer.customerCode;
}

/**
 * Public storefront chrome with a session-aware identity area.
 *
 * `/account` supplies its own admin-style shell, so rendering the marketing
 * header there would produce two navigation systems. Everywhere else the
 * server-resolved customer decides what is shown: a signed-in customer sees
 * their profile, never the login CTA. This is presentation only; every account
 * page and API request still performs its own server-side authorization.
 */
export function SiteChrome({
  customer,
  children,
}: Readonly<{
  customer: CustomerDto | null;
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  if (pathname.startsWith("/account")) return children;

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <Link href="/" className="logo" aria-label="برات، صفحه اصلی">
            <span className="logo-mark">ب</span>
            <span>برات</span>
          </Link>

          <nav className="nav" aria-label="منوی اصلی">
            <Link href="/gift-cards">گیفت‌کارت‌ها</Link>
            <Link href="/services">پرداخت بین‌المللی</Link>
            <Link href="/orders">پیگیری سفارش</Link>
            <Link href="/help">راهنما</Link>
          </nav>

          {customer ? (
            <Link href="/account" className="customer-profile-link" aria-label="مشاهده پنل کاربری">
              <span className="customer-profile-avatar"><CircleUserRound size={20} /></span>
              <span className="customer-profile-copy">
                <strong>{profileLabel(customer)}</strong>
                <small>پنل کاربری</small>
              </span>
            </Link>
          ) : (
            <div className="header-actions">
              <Link className="btn btn-outline" href="/login">ورود</Link>
              <Link className="btn btn-primary" href="/gift-cards">
                <ShoppingBag size={16} />
                شروع خرید
              </Link>
            </div>
          )}
        </div>
      </header>

      {children}

      <footer className="footer">
        <div className="container footer-inner">
          <div>
            <div className="logo"><span className="logo-mark">ب</span>برات</div>
            <p>ارزش جهانی، به زبان ریال.</p>
          </div>
          <div className="footer-support"><Headphones size={16} /> پشتیبانی همه‌روزه · پاسخ‌گویی سریع</div>
          <div>© ۱۴۰۵ برات</div>
        </div>
      </footer>
    </>
  );
}
