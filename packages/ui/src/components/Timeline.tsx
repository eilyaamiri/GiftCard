import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export type TimelineStepStatus = "done" | "current" | "pending";

export interface TimelineStep {
  readonly id: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly status: TimelineStepStatus;
  readonly timestamp?: ReactNode;
}

export interface TimelineProps {
  readonly steps: readonly TimelineStep[];
  readonly className?: string;
}

const DOT_CLASS: Record<TimelineStepStatus, string> = {
  done: "bg-status-green text-white",
  current: "bg-teal text-white ring-4 ring-mint",
  pending: "bg-line text-slate",
};

/** Vertical timeline with done/current/pending dots. */
export function Timeline({ steps, className }: TimelineProps) {
  return (
    <ol className={cn("relative", className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <li key={step.id} className="relative flex gap-3 pb-6 last:pb-0">
            {!isLast ? (
              <span
                className={cn(
                  "absolute top-6 bottom-0 start-[11px] w-px",
                  step.status === "done" ? "bg-status-green" : "bg-line",
                )}
                aria-hidden="true"
              />
            ) : null}
            <span
              className={cn(
                "z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                DOT_CLASS[step.status],
              )}
            >
              {step.status === "done" ? <Check className="size-3.5" aria-hidden="true" /> : null}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    step.status === "pending" ? "text-slate" : "text-ink",
                  )}
                >
                  {step.title}
                </p>
                {step.timestamp ? (
                  <span className="bp-ltr text-xs text-slate">{step.timestamp}</span>
                ) : null}
              </div>
              {step.description ? <p className="mt-0.5 text-xs text-slate">{step.description}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
