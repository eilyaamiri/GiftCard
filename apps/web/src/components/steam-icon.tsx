/**
 * The Steam glyph, drawn from the supplied black mark as a mask so it takes the
 * surrounding text colour — the same icon on paper, on the night ground and in
 * an active nav tab, with no per-theme asset.
 */
export function SteamIcon({ size = 18 }: Readonly<{ size?: number }>) {
  return <span className="steam-glyph" style={{ width: size, height: size }} aria-hidden="true" />;
}
