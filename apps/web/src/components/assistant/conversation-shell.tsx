"use client";

import { RotateCcw, X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * The frame every assistant surface shares: header, a scrolling log and a
 * footer for the input. The desktop widget and the phone page differ only in
 * the `variant` class, so there is one conversation UI to keep correct. The
 * modifier is `asst--*`, never `asst-widget`/`asst-page`: those name the
 * containers around the shell, and sharing them would position it twice.
 */
export function ConversationShell({
  variant,
  scrollKey,
  onReset,
  onClose,
  footer,
  children,
}: Readonly<{
  variant: "widget" | "page";
  /** Changes whenever new content arrives, so the log follows the conversation. */
  scrollKey: string;
  onReset: () => void;
  /** Closing keeps the conversation; reopening lands where it was left. */
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}>) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body !== null) body.scrollTo({ top: body.scrollHeight });
  }, [scrollKey]);

  return (
    <section className={`asst asst--${variant}`} aria-label="دستیار خرید">
      <header className="asst-head">
        <span className="asst-avatar" aria-hidden="true">ب</span>
        <h2>دستیار خرید</h2>
        <button type="button" className="asst-icon-btn" aria-label="شروع دوباره" onClick={onReset}>
          <RotateCcw size={17} aria-hidden="true" />
        </button>
        <button type="button" className="asst-icon-btn" aria-label="بستن دستیار" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="asst-body" ref={bodyRef} role="log" aria-live="polite">
        {children}
      </div>
      <div className="asst-foot">{footer}</div>
    </section>
  );
}
