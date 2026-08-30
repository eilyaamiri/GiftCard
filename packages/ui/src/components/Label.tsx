import type { LabelHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  readonly required?: boolean;
}

export function Label({ required, className, children, ...props }: LabelProps) {
  return (
    <label className={cn("block text-sm font-medium text-ink mb-1.5", className)} {...props}>
      {children}
      {required ? (
        <span className="text-status-red ms-1" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}
