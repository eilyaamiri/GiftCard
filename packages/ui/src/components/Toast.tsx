"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../lib/cn";

export type ToastTone = "ok" | "info" | "danger";

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  readonly durationMs?: number;
}

interface ToastItem extends ToastOptions {
  readonly id: string;
}

interface ToastContextValue {
  readonly push: (toast: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = {
  ok: CheckCircle2,
  info: Info,
  danger: AlertTriangle,
};

const TONE_CLASS: Record<ToastTone, string> = {
  ok: "border-status-green/30 text-ok-fg",
  info: "border-info-fg/30 text-info-fg",
  danger: "border-status-red/30 text-status-red",
};

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastOptions) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) => [...current, { ...toast, id }]);
      const duration = toast.durationMs ?? 4500;
      if (duration > 0) {
        setTimeout(() => remove(id), duration);
      }
    },
    [remove],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:end-4 sm:top-4 sm:bottom-auto sm:items-end"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone ?? "info"];
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                "bp-card flex w-full max-w-sm items-start gap-2.5 border-s-4 p-3.5 sm:w-96",
                TONE_CLASS[toast.tone ?? "info"],
              )}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{toast.title}</p>
                {toast.description ? <p className="mt-0.5 text-xs text-slate">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                aria-label="بستن پیام"
                className="-m-1 shrink-0 rounded-full p-1 text-slate hover:bg-soft"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx;
}
