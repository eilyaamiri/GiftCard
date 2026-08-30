import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TopBarProps {
  readonly title?: ReactNode;
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function TopBar({ title, leading, actions, className }: TopBarProps) {
  return (
    <header
      className={cn(
        "flex h-16 w-full items-center justify-between gap-3 border-b border-line bg-paper px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {leading}
        {title ? <h1 className="truncate text-base font-bold text-ink">{title}</h1> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
