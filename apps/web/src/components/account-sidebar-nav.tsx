"use client";

import Link from "next/link";
import { LayoutDashboard, LifeBuoy, ReceiptText, Settings2, ShoppingBag } from "lucide-react";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "حساب من",
    links: [
      { href: "/account", label: "نمای کلی", icon: LayoutDashboard },
      { href: "/account/orders", label: "سفارش‌های من", icon: ShoppingBag },
      { href: "/account/payments", label: "پرداخت‌ها", icon: ReceiptText },
    ],
  },
  {
    label: "پشتیبانی",
    links: [
      { href: "/account/profile", label: "اطلاعات حساب", icon: Settings2 },
      { href: "/account/support", label: "پشتیبانی و تیکت‌ها", icon: LifeBuoy },
    ],
  },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/account" ? pathname === href : pathname.startsWith(`${href}/`) || pathname === href;
}

export function AccountSidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="account-menu">
      {groups.map((group) => (
        <div className="account-menu-group" key={group.label}>
          <p>{group.label}</p>
          {group.links.map((link) => {
            const Icon = link.icon;
            const current = isCurrent(pathname, link.href);
            return (
              <Link className="account-menu-link" href={link.href} key={link.href} aria-current={current ? "page" : undefined}>
                <Icon size={18} /> {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
