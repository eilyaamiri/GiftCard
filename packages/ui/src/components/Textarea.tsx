import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full min-h-[88px] resize-y rounded-md border bg-paper px-3.5 py-3 text-[16px] leading-relaxed text-ink outline-none placeholder:text-slate/70 transition-colors",
        "focus:outline focus:outline-3 focus:outline-[rgba(33,180,176,.45)] focus:outline-offset-2",
        invalid ? "border-status-red" : "border-line",
        className,
      )}
      {...props}
    />
  );
});
