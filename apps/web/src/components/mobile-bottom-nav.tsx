"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound, Gamepad2, Headphones, Home, MessagesSquare } from "lucide-react";
import { SteamIcon } from "@/components/steam-icon";
import type { SupportChannel } from "@/lib/support-channels";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof Home | "steam";
  /** Signed-out visitors are sent to login and returned here afterwards. */
  readonly requiresAuth: boolean;
  readonly isActive: (pathname: string) => boolean;
}

/** The contact tab is a sentinel so that the bar's order lives in one place. */
const CONTACT = "contact" as const;

const ITEMS: readonly (NavItem | typeof CONTACT)[] = [
  { href: "/", label: "خانه", icon: Home, requiresAuth: false, isActive: (path) => path === "/" },
  /* Game top-ups are their own section, not a gift-card category: they credit
   * the customer's account directly, so on a phone they get a tab of their own. */
  {
    href: "/games",
    label: "شارژ بازی",
    icon: Gamepad2,
    requiresAuth: false,
    isActive: (path) => path.startsWith("/games"),
  },
  /* Steam wallet top-ups have their own page, so they get their own tab. */
  {
    href: "/steam",
    label: "استیم",
    icon: "steam",
    requiresAuth: false,
    isActive: (path) => path.startsWith("/steam"),
  },
  /* The assistant took the orders tab's place. Orders are still one tap away
   * inside it («📦 سفارش‌های من»), at /orders, and in the account panel. It needs
   * no sign-in to open: the conversation asks for one only when an order does. */
  {
    href: "/assistant",
    label: "دستیار",
    icon: MessagesSquare,
    requiresAuth: false,
    isActive: (path) => path.startsWith("/assistant"),
  },
  CONTACT,
  {
    href: "/account",
    /* Short on purpose: six equal cells leave ~52px of text on a 360px phone,
     * and «حساب کاربری» at 11px bold does not fit — it was cut to «حساب کار…». */
    label: "حساب من",
    icon: CircleUserRound,
    requiresAuth: true,
    isActive: (path) => path.startsWith("/account"),
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

          const active = item.isActive(pathname);
          const href =
            item.requiresAuth && !isSignedIn
              ? `/login?next=${encodeURIComponent(item.href)}`
              : item.href;
          return (
            <li key={item.href}>
              <Link href={href} className="bottom-nav-item" aria-current={active ? "page" : undefined}>
                {item.icon === "steam" ? <SteamIcon size={21} /> : <item.icon size={21} aria-hidden="true" />}
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
