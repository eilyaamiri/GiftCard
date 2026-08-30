"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { cn } from "../lib/cn";
import { toPersianDigits } from "../lib/digits";

export interface CountdownTimerProps {
  readonly expiresAt: Date | number | string;
  readonly onExpire?: () => void;
  readonly warnAtSeconds?: number;
  readonly className?: string;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function remainingSeconds(expiresAt: Date | number | string): number {
  const target = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Math.max(0, Math.floor((target - Date.now()) / 1000));
}

/** A live countdown used for quote-snapshot TTL. Rendered LTR with Persian digits. */
export function CountdownTimer({ expiresAt, onExpire, warnAtSeconds = 30, className }: CountdownTimerProps) {
  const [seconds, setSeconds] = useState(() => remainingSeconds(expiresAt));

  useEffect(() => {
    setSeconds(remainingSeconds(expiresAt));
    const interval = setInterval(() => {
      setSeconds((prev) => {
        const next = remainingSeconds(expiresAt);
        if (prev > 0 && next === 0) onExpire?.();
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const expired = seconds <= 0;
  const warning = !expired && seconds <= warnAtSeconds;

  return (
    <span
      role="timer"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold",
        expired ? "bg-[#FCE9E9] text-status-red" : warning ? "bg-wait-bg text-wait-fg" : "bg-info-bg text-info-fg",
        className,
      )}
    >
      <Clock3 className="size-3.5" aria-hidden="true" />
      <span className="bp-ltr" dir="ltr">
        {toPersianDigits(`${pad(minutes)}:${pad(secs)}`)}
      </span>
    </span>
  );
}
