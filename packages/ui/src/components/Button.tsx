import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "outline" | "teal" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "text-white bg-[linear-gradient(135deg,#0B1D33_0%,#12375c_55%,#21B4B0_100%)] focus-visible:outline-3 focus-visible:outline-[rgba(33,180,176,.45)] shadow-card",
  outline: "bg-transparent text-ink border border-line hover:bg-soft",
  teal: "text-white bg-teal hover:bg-teal-2",
  ghost: "bg-transparent text-ink hover:bg-soft",
  danger: "text-white bg-status-red hover:brightness-105",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-11 px-4 text-sm rounded-md",
  md: "h-12 px-5 text-[15px] rounded-md",
  lg: "h-[52px] px-6 text-base rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, fullWidth = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "bp-btn bp-focus select-none",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
});
