"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, Headphones, Home, ReceiptText } from "lucide-react";
import type { SupportChannel } from "@/lib/support-channels";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof Home;
  /** Signed-out visitors are sent to login and returned here afterwards. */
  readonly requiresAuth: boolean;
  readonly isActive: (pathname: string) => boolean;
}

/** The contact tab is a sentinel so that the bar's order lives in one place. */
const CONTACT = "contact" as const;

const ITEMS: readonly (NavItem | typeof CONTACT)[] = [
  { href: "/", label: "خانه", icon: Home, requiresAuth: false, isActive: (path) => path === "/" },
  {
    href: "/orders",
    label: "سفارش‌ها",
    icon: ReceiptText,
    requiresAuth: true,
    /* The two order surfaces — public tracking and the panel list — are one tab
     * as far as a customer is concerned, so both light it up. */
    isActive: (path) => path.startsWith("/orders") || path.startsWith("/account/orders"),
  },
  CONTACT,
  {
    href: "/account",
    label: "حساب کاربری",
    icon: CircleUserRound,
    requiresAuth: true,
    isActive: (path) => path.startsWith("/account") && !path.startsWith("/account/orders"),
  },
];

/**
 * The phone-sized navigation bar, fixed to the bottom of every page.
 *
 * Hidden from 768px up by CSS, where the header's own nav takes over — this
 * renders on the server either way, so there is no flash of a bar that then
 * disappears and no layout that depends on measuring the viewport in JS.
 *
 * Contact is a button rather than a link: it opens a sheet in place instead of
 * navigating, which keeps whatever the customer was reading on screen behind it.
 * The sheet itself belongs to the chrome, because the header opens the same one
 * on wider screens and two dialogs holding two ideas of "open" is one too many.
 */
export function MobileBottomNav({
  isSignedIn,
  channels,
  contactOpen,
  onOpenContact,
}: Readonly<{
  isSignedIn: boolean;
  channels: readonly SupportChannel[];
  contactOpen: boolean;
  onOpenContact: () => void;
}>) {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="منوی موبایل">
      <ul>
        {ITEMS.map((item) => {
          if (item === CONTACT) {
            /* No configured channel means no tab: the brief is explicit that a
             * dead contact option must never be on screen. */
            if (channels.length === 0) return null;
            return (
              <li key={CONTACT}>
                <button
                  type="button"
                  className="bottom-nav-item"
                  aria-haspopup="dialog"
                  aria-expanded={contactOpen}
                  onClick={onOpenContact}
                >
                  <Headphones size={21} aria-hidden="true" />
                  <span>تماس با ما</span>
                </button>
              </li>
            );
          }

          const Icon = item.icon;
          const active = item.isActive(pathname);
          const href =
            item.requiresAuth && !isSignedIn
              ? `/login?next=${encodeURIComponent(item.href)}`
              : item.href;
          return (
            <li key={item.href}>
              <Link href={href} className="bottom-nav-item" aria-current={active ? "page" : undefined}>
                <Icon size={21} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
