"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Marks the dismiss button so it can stay in the tab cycle without taking the opening focus. */
const CLOSE_ATTRIBUTE = "data-modal-close";

export function Modal({ open, onClose, title, description, children, footer, className }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  /**
   * Callers pass an inline arrow for `onClose`, so its identity changes on every
   * render. Reading it through a ref keeps the effect below keyed on `open`
   * alone — while `onClose` was a dependency, typing a single character
   * re-rendered the caller, re-ran the effect and threw focus onto the close
   * button, which made every text field in a dialog impossible to fill in.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusable = node?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    // Land on the first real control instead of the close button: a dialog is
    // opened to act in, not to dismiss.
    const candidates = focusable ? Array.from(focusable) : [];
    const entry = candidates.find((item) => !item.hasAttribute(CLOSE_ATTRIBUTE)) ?? candidates[0];
    (entry ?? node)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = node?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!items || items.length === 0) return;
      const first = items.item(0);
      const last = items.item(items.length - 1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      lastFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(11,29,51,.45)] p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "bp-modal-title" : undefined}
        aria-describedby={description ? "bp-modal-desc" : undefined}
        tabIndex={-1}
        className={cn(
          "bp-card w-full max-w-lg rounded-b-none p-5 outline-none sm:rounded-b-[18px]",
          "bp-modal-scroll",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 id="bp-modal-title" className="text-lg font-bold text-ink">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p id="bp-modal-desc" className="mt-1 text-sm text-slate">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            data-modal-close
            className="bp-focus -m-2 flex size-11 shrink-0 items-center justify-center rounded-full text-slate hover:bg-soft"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {children}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
