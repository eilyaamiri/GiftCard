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
    <label htmlFor={id} className={cn("bp-checkbox select-none", className)}>
      <span className="bp-checkbox-control">
        <input ref={ref} id={id} type="checkbox" className="bp-checkbox-input" {...props} />
        <Check className="bp-checkbox-mark" aria-hidden="true" />
      </span>
      {label ? <span className="bp-checkbox-text">{label}</span> : null}
    </label>
  );
});
