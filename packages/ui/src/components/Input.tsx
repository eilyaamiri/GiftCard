import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
  readonly startAdornment?: ReactNode;
  readonly endAdornment?: ReactNode;
  readonly ltr?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, startAdornment, endAdornment, ltr, className, dir, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-paper px-3.5 min-h-11 transition-colors",
        "focus-within:outline focus-within:outline-3 focus-within:outline-[rgba(33,180,176,.45)] focus-within:outline-offset-2",
        invalid ? "border-status-red" : "border-line",
        className,
      )}
    >
      {startAdornment ? <span className="shrink-0 text-slate">{startAdornment}</span> : null}
      <input
        ref={ref}
        dir={dir ?? (ltr ? "ltr" : undefined)}
        aria-invalid={invalid || undefined}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-[16px] leading-none text-ink outline-none placeholder:text-slate/70 h-11",
          ltr && "bp-ltr text-right",
        )}
        {...props}
      />
      {endAdornment ? <span className="shrink-0 text-slate">{endAdornment}</span> : null}
    </div>
  );
});
