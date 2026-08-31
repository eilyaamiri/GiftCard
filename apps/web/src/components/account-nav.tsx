"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/account", label: "نمای کلی" },
  { href: "/account/profile", label: "اطلاعات حساب" },
  { href: "/account/orders", label: "سفارش‌ها" },
  { href: "/account/payments", label: "پرداخت‌ها" },
  { href: "/account/support", label: "پشتیبانی" },
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav className="account-mobile-nav" aria-label="منوی حساب کاربری">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className={`chip ${pathname === link.href ? "active" : ""}`} aria-current={pathname === link.href ? "page" : undefined}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
