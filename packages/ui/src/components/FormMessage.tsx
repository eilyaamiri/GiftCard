import type { HTMLAttributes } from "react";
import { AlertCircle, Info } from "lucide-react";
import { cn } from "../lib/cn";

export interface FormMessageProps extends HTMLAttributes<HTMLParagraphElement> {
  readonly tone?: "error" | "hint";
}

/** Inline helper/error text for a form field. */
export function FormMessage({ tone = "hint", className, children, ...props }: FormMessageProps) {
  if (!children) return null;
  const Icon = tone === "error" ? AlertCircle : Info;
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "mt-1.5 flex items-center gap-1.5 text-xs",
        tone === "error" ? "text-status-red" : "text-slate",
        className,
      )}
      {...props}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
