"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_AUTO_MEDIA_QUERY, THEME_STORAGE_KEY, type ThemeChoice } from "@/lib/theme";

const OPTIONS = [
  { value: "auto", label: "خودکار", icon: Monitor },
  { value: "light", label: "روشن", icon: Sun },
  { value: "dark", label: "شب", icon: Moon },
] as const satisfies readonly { value: ThemeChoice; label: string; icon: typeof Monitor }[];

/**
 * The header's control and the mobile drawer's control are two mounted copies
 * of one setting. Without this they would drift: change the theme in the
 * header, open the drawer, and the drawer would still show the old choice
 * highlighted, because each copy read storage once at mount.
 */
const THEME_CHANGED = "barat:theme-choice";

/**
 * The day/night control.
 *
 * Three states shown at once rather than one button that cycles: with a cycle
 * you cannot tell "dark because I asked" from "dark because this is the phone
 * default", and those behave differently once you also open it on a desktop.
 *
 * The server always renders "خودکار" selected, because the stored choice lives
 * in `localStorage` and the server cannot see it. That is only the *pressed*
 * state — the colours themselves are already correct by then, set before paint
 * by `THEME_INIT_SCRIPT` — so the correction on mount is invisible.
 */
export function ThemeToggle({
  withLabels = false,
  className,
}: Readonly<{ withLabels?: boolean; className?: string }>) {
  const [choice, setChoice] = useState<ThemeChoice>("auto");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") setChoice(stored);
    } catch {
      /* Storage is blocked; the control still works for this page. */
    }
    setReady(true);

    const sync = (event: Event) => setChoice((event as CustomEvent<ThemeChoice>).detail);
    window.addEventListener(THEME_CHANGED, sync);
    return () => window.removeEventListener(THEME_CHANGED, sync);
  }, []);

  useEffect(() => {
    /* Before the stored choice has been read, the inline script's answer is the
     * right one — re-applying a default "auto" here would undo it. */
    if (!ready) return;
    const media = window.matchMedia(THEME_AUTO_MEDIA_QUERY);
    const apply = () => {
      document.documentElement.dataset.theme =
        choice === "auto" ? (media.matches ? "dark" : "light") : choice;
    };
    apply();
    if (choice !== "auto") return;
    /* Auto means auto: the page follows the viewport past the moment it
     * loaded — resize across 767px (rotate a tablet, resize a window) and the
     * theme follows it. */
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice, ready]);

  const pick = (next: ThemeChoice) => {
    window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_CHANGED, { detail: next }));
    try {
      if (next === "auto") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Storage is blocked; the choice holds until the page is reloaded. */
    }
  };

  return (
    <div
      className={["theme-switch", withLabels ? "theme-switch-wide" : null, className].filter(Boolean).join(" ")}
      role="group"
      aria-label="حالت نمایش"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className="theme-switch-option"
          aria-pressed={choice === value}
          aria-label={withLabels ? undefined : label}
          title={withLabels ? undefined : label}
          onClick={() => pick(value)}
        >
          <Icon size={16} aria-hidden="true" />
          {withLabels ? <span>{label}</span> : null}
        </button>
      ))}
    </div>
  );
}
