import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface DonutSegment {
  readonly value: number;
  readonly color: string;
  readonly label?: string;
}

export interface DonutProps {
  readonly segments: readonly DonutSegment[];
  readonly size?: number;
  readonly thickness?: number;
  readonly center?: ReactNode;
  readonly className?: string;
}

/** A pure CSS conic-gradient donut chart. No canvas/SVG dependency. */
export function Donut({ segments, size = 160, thickness = 18, center, className }: DonutProps) {
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.value), 0) || 1;
  let cursor = 0;
  const stops: string[] = [];
  for (const seg of segments) {
    const start = (cursor / total) * 360;
    cursor += Math.max(0, seg.value);
    const end = (cursor / total) * 360;
    stops.push(`${seg.color} ${start}deg ${end}deg`);
  }
  const gradient = stops.length > 0 ? `conic-gradient(${stops.join(", ")})` : "conic-gradient(#DCE4EA 0deg 360deg)";

  return (
    <div
      role="img"
      aria-label={segments.map((s) => `${s.label ?? ""}: ${s.value}`).join(", ")}
      className={cn("relative inline-grid place-items-center rounded-full", className)}
      style={{ width: size, height: size, background: gradient }}
    >
      <div
        className="grid place-items-center rounded-full bg-paper"
        style={{ width: size - thickness * 2, height: size - thickness * 2 }}
      >
        {center}
      </div>
    </div>
  );
}
