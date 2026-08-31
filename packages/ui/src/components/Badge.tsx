import type { HTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, Info } from "lucide-react";
import { cn } from "../lib/cn";

export type BadgeTone = "ok" | "wait" | "info" | "danger" | "neutral";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  ok: "bg-ok-bg text-ok-fg",
  wait: "bg-wait-bg text-wait-fg",
  info: "bg-info-bg text-info-fg",
  danger: "bg-[#FCE9E9] text-status-red",
  neutral: "bg-soft text-slate",
};

const TONE_ICON: Record<BadgeTone, typeof CheckCircle2> = {
  ok: CheckCircle2,
  wait: Clock3,
  info: Info,
  danger: AlertTriangle,
  neutral: CircleDashed,
};

/** Status badge: always icon + text, never colour alone. */
export function Badge({ tone = "neutral", className, children, ...props }: BadgeProps) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

export type { BadgeTone as StatusPillTone };

export type StatusPillProps = BadgeProps;

/** Alias of Badge, sized for use as a leading status indicator in tables/timelines. */
export function StatusPill(props: StatusPillProps) {
  return <Badge {...props} />;
}
