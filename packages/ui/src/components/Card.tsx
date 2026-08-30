import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly padding?: "none" | "sm" | "md" | "lg";
}

const PADDING_CLASS: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "p-0",
  sm: "p-3.5",
  md: "p-5",
  lg: "p-7",
};

export function Card({ padding = "md", className, ...props }: CardProps) {
  return <div className={cn("bp-card", PADDING_CLASS[padding], className)} {...props} />;
}

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  readonly title?: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}

/** A Card with a header row: title/description on the (reading) start, actions on the end. */
export function Panel({ title, description, actions, className, children, ...props }: PanelProps) {
  return (
    <Card className={cn("space-y-4", className)} {...props}>
      {(title || description || actions) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-base font-bold text-ink">{title}</h3> : null}
            {description ? <p className="mt-1 text-sm text-slate">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      )}
      {children}
    </Card>
  );
}
