import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export interface ErrorStateProps {
  readonly title?: string;
  readonly description?: string;
  readonly action?: ReactNode;
}

export function ErrorState({
  title = "خطایی رخ داد",
  description = "لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.",
  action,
}: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[#FCE9E9] text-status-red">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-slate">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
