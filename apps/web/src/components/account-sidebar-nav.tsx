"use client";

import Link from "next/link";
import {
  Gamepad2,
  Gift,
  Heart,
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  ReceiptText,
  Send,
  Settings2,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { usePathname } from "next/navigation";

/* Two groups: what the customer can buy, and everything about their own
 * account. The shop group mirrors the public header's shop links; the games,
 * Steam and Telegram entries are the site's own pages for now. */
const groups = [
  {
    label: "فروشگاه",
    links: [
      { href: "/account/shop", label: "گیفت‌کارت‌ها", icon: Gift },
      { href: "/brands", label: "همهٔ برندها", icon: LayoutGrid },
      { href: "/games", label: "شارژ مستقیم بازی", icon: Gamepad2 },
      { href: "/steam", label: "شارژ کیف پول استیم", icon: Wallet },
      { href: "/telegram", label: "استارز و پرمیوم تلگرام", icon: Send },
    ],
  },
  {
    label: "حساب کاربری",
    links: [
      { href: "/account", label: "نمای کلی", icon: LayoutDashboard },
      { href: "/account/orders", label: "سفارش‌های من", icon: ShoppingBag },
      { href: "/account/payments", label: "پرداخت‌ها", icon: ReceiptText },
      { href: "/account/favorites", label: "علاقه‌مندی‌ها", icon: Heart },
      { href: "/account/profile", label: "اطلاعات حساب", icon: Settings2 },
      { href: "/account/support", label: "پشتیبانی و تیکت‌ها", icon: LifeBuoy },
    ],
  },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/account" ? pathname === href : pathname.startsWith(`${href}/`) || pathname === href;
}

export function AccountSidebarNav({ onNavigate }: { onNavigate?: () => void }) {
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
              <Link
                className="account-menu-link"
                href={link.href}
                key={link.href}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon size={18} /> {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
