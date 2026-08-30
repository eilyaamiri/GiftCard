import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly selected?: boolean;
}

/** A selectable pill button, e.g. filter chips. */
export function Chip({ selected, className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors",
        selected ? "border-teal bg-mint text-ink" : "border-line bg-paper text-slate hover:bg-soft",
        className,
      )}
      {...props}
    />
  );
}

export type PillRowProps = HTMLAttributes<HTMLDivElement>;

/** Horizontally scrollable row of chips/pills that never wraps or overflows on mobile. */
export function PillRow({ className, ...props }: PillRowProps) {
  return (
    <div
      className={cn("flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]", className)}
      {...props}
    />
  );
}
