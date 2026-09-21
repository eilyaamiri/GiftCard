"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface NavDropdownItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: ReactNode;
}

/**
 * A header menu that opens a list of links.
 *
 * Closes on an outside pointerdown or Escape, and on picking an item — the
 * usual expectations for `aria-haspopup="menu"`. There is no full-screen
 * overlay: unlike `ContactSheet`, this is a small anchored popover, so it never
 * needs the drawer treatment the phone nav uses.
 */
export function NavDropdown({
  label,
  items,
  emptyLabel,
}: Readonly<{ label: string; items: readonly NavDropdownItem[]; emptyLabel: string }>) {
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
        <ul className="nav-dropdown-menu" role="menu">
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
                  {item.label}
                </Link>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
