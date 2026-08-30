import { cn } from "../lib/cn";

export interface ProgressBarProps {
  readonly value: number;
  readonly max?: number;
  readonly label?: string;
  readonly tone?: "teal" | "green" | "amber" | "red";
  readonly className?: string;
}

const TONE_CLASS = {
  teal: "bg-teal",
  green: "bg-status-green",
  amber: "bg-status-amber",
  red: "bg-status-red",
} as const;

export function ProgressBar({ value, max = 100, label, tone = "teal", className }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={className}>
      {label ? <p className="mb-1.5 text-xs font-medium text-slate">{label}</p> : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-line"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", TONE_CLASS[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
