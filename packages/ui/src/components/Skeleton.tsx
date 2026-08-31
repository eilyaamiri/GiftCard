import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-line/70", className)}
      aria-hidden="true"
      {...props}
    />
  );
}
