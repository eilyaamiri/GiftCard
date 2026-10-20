"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * The submit button of a server-action form, disabled while its action runs.
 *
 * A server-action form has no client state of its own, so a second click
 * before the redirect lands posts the same reply or note twice. Nothing else
 * about the button changes.
 */
export function PendingSubmitButton({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending || undefined}>
      {children}
    </button>
  );
}
