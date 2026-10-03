"use client";

import { MessagesSquare } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AssistantPanel } from "./assistant-panel";

const OPEN_KEY = "barat.assistant.open";
const DESKTOP = "(min-width: 768px)";
/** Pages where a floating chat would sit on top of the very thing the person is doing. */
const HIDDEN_ON = ["/assistant", "/login", "/otp"];

function readOpen(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    window.sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* the widget just reopens closed */
  }
}

/**
 * The desktop assistant: a launcher and a floating panel on every page.
 *
 * Phones get a full-screen page instead (`/assistant`), so below 768px this
 * renders nothing at all rather than hiding a mounted panel. The panel mounts
 * on first open and then stays mounted while minimized, and the conversation
 * lives in the session store either way, so minimizing, navigating and
 * refreshing all land the person back where they were.
 */
export function AssistantWidget() {
  const pathname = usePathname();
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const sync = () => setDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    const wasOpen = readOpen();
    setOpen(wasOpen);
    setMounted(wasOpen);
    return () => query.removeEventListener("change", sync);
  }, []);

  const change = (next: boolean) => {
    setOpen(next);
    if (next) setMounted(true);
    writeOpen(next);
  };

  if (!desktop || HIDDEN_ON.some((prefix) => pathname.startsWith(prefix))) return null;

  return (
    <div className="asst-widget" onKeyDown={(event) => (event.key === "Escape" && open ? change(false) : undefined)}>
      {mounted ? (
        <div className="asst-widget-panel" hidden={!open}>
          <AssistantPanel variant="widget" returnPath={pathname} onClose={() => change(false)} />
        </div>
      ) : null}
      {open ? null : (
        <button type="button" className="asst-launcher" aria-label="باز کردن دستیار خرید" onClick={() => change(true)}>
          <MessagesSquare size={20} aria-hidden="true" />
          <span>دستیار خرید</span>
        </button>
      )}
    </div>
  );
}
