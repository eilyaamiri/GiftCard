import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly label?: ReactNode;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, className, id, ...props },
  ref,
) {
  return (
    <label htmlFor={id} className={cn("inline-flex min-h-11 items-center gap-2.5 select-none", className)}>
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <input
          ref={ref}
          id={id}
          type="radio"
          className={cn(
            "peer size-5 cursor-pointer appearance-none rounded-full border border-line bg-paper transition-colors",
            "checked:border-[6px] checked:border-teal",
            "focus-visible:outline focus-visible:outline-3 focus-visible:outline-[rgba(33,180,176,.45)] focus-visible:outline-offset-2",
          )}
          {...props}
        />
      </span>
      {label ? <span className="text-sm text-ink">{label}</span> : null}
    </label>
  );
});
