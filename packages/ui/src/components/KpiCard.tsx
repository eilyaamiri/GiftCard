import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "../lib/cn";
import { Card } from "./Card";

export interface KpiCardProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly icon?: ReactNode;
  readonly deltaPct?: number;
  readonly hint?: string;
  readonly className?: string;
}

/** A single stat/KPI tile. `value` should already be formatted (e.g. via formatToman). */
export function KpiCard({ label, value, icon, deltaPct, hint, className }: KpiCardProps) {
  const positive = typeof deltaPct === "number" && deltaPct >= 0;
  return (
    <Card padding="md" className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate">{label}</p>
        {icon ? <span className="flex size-9 items-center justify-center rounded-full bg-mint text-teal">{icon}</span> : null}
      </div>
      <p className="bp-ltr text-end text-2xl font-bold text-ink">{value}</p>
      {typeof deltaPct === "number" ? (
        <div
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            positive ? "bg-ok-bg text-ok-fg" : "bg-[#FCE9E9] text-status-red",
          )}
        >
          {positive ? (
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          ) : (
            <ArrowDownRight className="size-3.5" aria-hidden="true" />
          )}
          <span className="bp-ltr">{Math.abs(deltaPct)}%</span>
        </div>
      ) : null}
      {hint ? <p className="text-xs text-slate">{hint}</p> : null}
    </Card>
  );
}

/** Alias for callers that prefer the generic "Stat" name. */
export { KpiCard as Stat };
