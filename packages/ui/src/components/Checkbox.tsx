import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className, id, ...props },
  ref,
) {
  return (
    <label
      htmlFor={id}
      className={cn("inline-flex min-h-11 items-center gap-2.5 select-none", className)}
    >
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="peer absolute inset-0 size-5 cursor-pointer appearance-none rounded-[6px] border border-line bg-paper transition-colors checked:border-teal checked:bg-teal focus-visible:outline focus-visible:outline-3 focus-visible:outline-[rgba(33,180,176,.45)] focus-visible:outline-offset-2"
          {...props}
        />
        <Check
          className="pointer-events-none relative size-3.5 text-white opacity-0 peer-checked:opacity-100"
          aria-hidden="true"
        />
      </span>
      {label ? <span className="text-sm text-ink">{label}</span> : null}
    </label>
  );
});
