"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

const MAX_MENU_COLUMNS = 3;
const ITEMS_PER_COLUMN = 8;

/**
 * Fewer items should never sit in a panel sized for a much longer list — the
 * column count scales with the actual item count instead of staying fixed
 * at 3, so the grid (and the panel around it) shrinks on its own as the
 * catalog's brand/category counts change.
 */
function menuColumnCount(itemCount: number): number {
  return Math.min(MAX_MENU_COLUMNS, Math.max(1, Math.ceil(itemCount / ITEMS_PER_COLUMN)));
}

export interface NavDropdownItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: ReactNode;
}

export interface NavDropdownTrending {
  readonly heading: string;
  readonly items: readonly NavDropdownItem[];
}

/**
 * A header menu that opens a panel of links.
 *
 * Closes on an outside pointerdown or Escape, and on picking an item — the
 * usual expectations for `aria-haspopup="menu"`. There is no full-screen
 * overlay: unlike `ContactSheet`, this is a small anchored popover, so it never
 * needs the drawer treatment the phone nav uses.
 *
 * `trending` is an optional highlighted column (an operator-curated shortlist,
 * e.g. popular brands) rendered beside the main grid. `role="menu"` sits on
 * the outer panel rather than either list, so the two lists read as one menu
 * to assistive tech and to `getByRole("menu")` in tests.
 */
export function NavDropdown({
  label,
  items,
  emptyLabel,
  trending,
}: Readonly<{
  label: string;
  items: readonly NavDropdownItem[];
  emptyLabel: string;
  trending?: NavDropdownTrending;
}>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="nav-dropdown" ref={rootRef}>
      <button
        type="button"
        className="nav-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="nav-dropdown-panel" role="menu">
          {trending && trending.items.length > 0 ? (
            <div className="nav-dropdown-trending">
              <div className="nav-dropdown-trending-heading">{trending.heading}</div>
              <ul className="nav-dropdown-trending-list">
                {trending.items.map((item) => (
                  <li key={item.key} role="none">
                    <Link
                      href={item.href}
                      role="menuitem"
                      className="nav-dropdown-trending-item"
                      onClick={() => setOpen(false)}
                    >
                      {item.icon}
                      <span className="nav-dropdown-item-label">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul
            className="nav-dropdown-menu"
            style={{ "--nav-dropdown-cols": menuColumnCount(items.length) } as CSSProperties}
          >
            {items.length === 0 ? (
              <li className="nav-dropdown-empty">{emptyLabel}</li>
            ) : (
              items.map((item) => (
                <li key={item.key} role="none">
                  <Link
                    href={item.href}
                    role="menuitem"
                    className="nav-dropdown-item"
                    onClick={() => setOpen(false)}
                  >
                    {item.icon}
                    <span className="nav-dropdown-item-label">{item.label}</span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
