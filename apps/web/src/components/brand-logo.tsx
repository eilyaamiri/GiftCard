import { BRAND } from "@/lib/brand";

type Variant = "lockup" | "full" | "symbol";

/* Intrinsic sizes of the files under public/brand/cento, so the browser
 * reserves the right box before they load. The light and dark exports differ
 * by a few pixels, so each carries its own. */
const ART: Record<Variant, { light: [string, number, number]; dark: [string, number, number] }> = {
  lockup: { light: [BRAND.assets.lockupLight, 589, 192], dark: [BRAND.assets.lockupDark, 583, 192] },
  full: { light: [BRAND.assets.logoLight, 1200, 391], dark: [BRAND.assets.logoDark, 1200, 395] },
  symbol: { light: [BRAND.assets.symbolLight, 479, 512], dark: [BRAND.assets.symbolDark, 480, 512] },
};

/**
 * The CENTO mark, as the designer drew it for each theme.
 *
 * Both files are in the markup and CSS shows the one that matches
 * `data-theme`, so the switch is instant and needs no client JavaScript.
 * `ground="dark"` is for the surfaces that are night in both themes (the
 * account rail, the auth panel), which always take the light-on-dark file.
 *
 * The images are decorative; the label belongs to whatever wraps them — the
 * home link's `aria-label`, or `label` here when the mark stands alone.
 */
export function BrandLogo({
  variant = "lockup",
  ground = "theme",
  label,
  className,
}: Readonly<{ variant?: Variant; ground?: "theme" | "dark"; label?: string; className?: string }>) {
  const { light, dark } = ART[variant];
  const classes = ["brand-logo", `brand-logo--${variant}`, ground === "dark" ? "brand-logo--on-dark" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <img className="brand-logo-light" src={light[0]} width={light[1]} height={light[2]} alt="" decoding="async" />
      <img className="brand-logo-dark" src={dark[0]} width={dark[1]} height={dark[2]} alt="" decoding="async" />
    </span>
  );
}
