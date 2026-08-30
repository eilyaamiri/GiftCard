import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, options, placeholder, className, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        "relative flex items-center rounded-md border bg-paper transition-colors",
        "focus-within:outline focus-within:outline-3 focus-within:outline-[rgba(33,180,176,.45)] focus-within:outline-offset-2",
        invalid ? "border-status-red" : "border-line",
        className,
      )}
    >
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className="min-h-11 w-full appearance-none bg-transparent px-3.5 pe-9 text-[16px] text-ink outline-none"
        {...props}
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 size-4 text-slate" aria-hidden="true" />
    </div>
  );
});
