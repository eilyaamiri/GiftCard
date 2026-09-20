"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { LifeBuoy, MessageCircle, Phone, Send, X } from "lucide-react";
import type { SupportChannel } from "@/lib/support-channels";

const ICONS = {
  PHONE: Phone,
  TELEGRAM: Send,
  WHATSAPP: MessageCircle,
  TICKET: LifeBuoy,
} as const;

/**
 * The ways to reach support, as a bottom sheet.
 *
 * A native `<dialog>` rather than a hand-built overlay: `showModal()` gives the
 * focus trap, the inert background and the Escape key without re-implementing
 * any of them, and `onClose` fires whichever way it was dismissed, so the
 * button that opened it always ends up back in sync.
 *
 * Every link comes from the API with its `href` already built. Nothing here
 * turns a phone number or a username into a URL.
 */
export function ContactSheet({
  open,
  channels,
  isSignedIn,
  onClose,
}: Readonly<{
  open: boolean;
  channels: readonly SupportChannel[];
  isSignedIn: boolean;
  onClose: () => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="contact-sheet"
      aria-labelledby="contact-sheet-title"
      onClose={onClose}
      onClick={(event) => {
        /* The dialog element fills the viewport and the panel sits inside it, so
         * a click that lands on the dialog itself is a click on the backdrop. */
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="contact-sheet-panel">
        <span className="contact-sheet-grip" aria-hidden="true" />
        <div className="contact-sheet-head">
          <h2 id="contact-sheet-title">تماس با ما</h2>
          <button autoFocus type="button" className="contact-sheet-close" aria-label="بستن" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {channels.length === 0 ? (
          <p className="contact-sheet-empty">در حال حاضر راه ارتباطی فعالی ثبت نشده است.</p>
        ) : (
          <ul className="contact-sheet-list">
            {channels.map((channel) => {
              const Icon = ICONS[channel.kind];
              return (
                <li key={channel.kind}>
                  <ContactLink channel={channel} isSignedIn={isSignedIn} onNavigate={onClose}>
                    <span className="contact-sheet-icon" aria-hidden="true"><Icon size={20} /></span>
                    <span className="contact-sheet-copy">
                      <strong>{channel.title}</strong>
                      {channel.description ? <small>{channel.description}</small> : null}
                    </span>
                  </ContactLink>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </dialog>
  );
}

/**
 * One row, routed by what the channel is.
 *
 * An internal route stays inside the app and goes through the router; a
 * `tel:` link and an outbound chat link do not, so they are plain anchors.
 * Anything that leaves the site opens detached from this page — `noopener`
 * denies the opened tab a handle on `window.opener`.
 */
function ContactLink({
  channel,
  isSignedIn,
  onNavigate,
  children,
}: Readonly<{
  channel: SupportChannel;
  isSignedIn: boolean;
  onNavigate: () => void;
  children: React.ReactNode;
}>) {
  if (channel.isExternal) {
    return (
      <a className="contact-sheet-item" href={channel.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
        {children}
      </a>
    );
  }

  if (channel.requiresAuth) {
    /* Signed out, the ticket form would bounce to login and lose where the
     * customer was going, so the detour is built into the link itself. */
    const href = isSignedIn ? channel.href : `/login?next=${encodeURIComponent(channel.href)}`;
    return <Link className="contact-sheet-item" href={href} onClick={onNavigate}>{children}</Link>;
  }

  return (
    <a className="contact-sheet-item" href={channel.href} onClick={onNavigate}>
      {children}
    </a>
  );
}
