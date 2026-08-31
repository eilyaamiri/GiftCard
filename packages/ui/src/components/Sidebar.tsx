import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SidebarItem {
  readonly key: string;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  readonly href?: string;
  readonly active?: boolean;
  readonly onClick?: () => void;
}

export interface SidebarProps {
  readonly items: readonly SidebarItem[];
  readonly header?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

export function Sidebar({ items, header, footer, className }: SidebarProps) {
  return (
    <nav
      className={cn(
        "flex h-full w-64 shrink-0 flex-col gap-1 border-e border-line bg-paper p-3",
        className,
      )}
      aria-label="ناوبری اصلی"
    >
      {header ? <div className="mb-2 px-2">{header}</div> : null}
      <ul className="flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <li key={item.key}>
            <a
              href={item.href ?? "#"}
              onClick={item.onClick}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "bp-focus flex min-h-11 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors",
                item.active ? "bg-mint text-ink" : "text-slate hover:bg-soft hover:text-ink",
              )}
            >
              {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
              <span className="truncate">{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
      {footer ? <div className="mt-2 px-2">{footer}</div> : null}
    </nav>
  );
}
