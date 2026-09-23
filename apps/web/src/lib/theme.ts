/**
 * Light/dark theming for the storefront.
 *
 * The chosen theme is written to `data-theme` on `<html>`; every colour in
 * `globals.css` is a token that reads off it. Three choices are offered rather
 * than two, because "خودکار" is not the same as either: it follows the
 * operating system and keeps following it, which is what someone who schedules
 * night mode on their phone expects.
 *
 * Only an explicit choice is stored. Storing "auto" as a value would make a
 * later change to the default invisible to everyone who had ever opened the
 * control, so auto is represented by the absence of a key.
 */
export const THEME_STORAGE_KEY = "barat-theme";

export type ThemeChoice = "auto" | "light" | "dark";

/**
 * Runs before first paint, inline in `<head>`, so a customer who picked dark
 * never sees a white page flash first. It is deliberately tiny and defensive:
 * `localStorage` throws outright in some privacy modes, and a theme is not
 * worth taking the document down for.
 */
export const THEME_INIT_SCRIPT = `try{var c=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.dataset.theme=c==="light"||c==="dark"?c:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}`;
