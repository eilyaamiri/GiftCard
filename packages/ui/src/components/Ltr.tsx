import type { ElementType, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface LtrProps {
  readonly as?: ElementType;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Forces LTR direction with bidi isolation for money, order numbers,
 * reference codes, gift-card codes and OTPs embedded inside RTL text.
 */
export function Ltr({ as: Component = "span", children, className }: LtrProps) {
  return (
    <Component className={cn("bp-ltr", className)} dir="ltr">
      {children}
    </Component>
  );
}
