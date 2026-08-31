/**
 * Barat Pay design tokens, programmatic form.
 *
 * The CSS in `theme.css` is the source of truth for Tailwind utilities. This module
 * exists for the places where a raw value is genuinely needed — chart series colours,
 * canvas rendering, e-mail templates, PDF export.
 *
 * Keep the two files in sync. Both are Foundation-owned.
 */

export const colors = Object.freeze({
  brand: Object.freeze({
    navy: '#0B1D33',
    navy2: '#102A46',
    ink: '#13243A',
    teal: '#21B4B0',
    teal2: '#46D0CB',
    slate: '#6B7C93',
  }),
  surface: Object.freeze({
    paper: '#FFFFFF',
    soft: '#F6F8FA',
    mint: '#DFF7F5',
    line: '#DCE4EA',
    line2: '#E6EBF0',
  }),
  status: Object.freeze({
    green: '#18A66A',
    red: '#D94A4A',
    amber: '#D98B19',
    purple: '#7157D9',
    okBg: '#E7F7F0',
    okFg: '#12835D',
    waitBg: '#FFF5DC',
    waitFg: '#9D6B00',
    infoBg: '#EAF4FF',
    infoFg: '#2B69A0',
  }),
});

export const radius = Object.freeze({
  sm: 8,
  md: 12,
  lg: 18,
  xl: 22,
  '2xl': 28,
  full: 999,
});

export const shadows = Object.freeze({
  card: '0 8px 24px rgba(11,29,51,.08)',
  modal: '0 30px 90px rgba(0,0,0,.25)',
});

export const focusRing = Object.freeze({
  outline: '3px solid rgba(33,180,176,.25)',
  offset: 2,
});

/** Prototype breakpoints, in pixels. */
export const breakpoints = Object.freeze({
  sm: 560,
  md: 900,
  lg: 1440,
});

export const containers = Object.freeze({
  marketing: 1440,
  admin: 1600,
});

export const fontFamily = Object.freeze({
  sans: "var(--font-vazirmatn), 'Vazirmatn', system-ui, sans-serif",
  num: "var(--font-vazirmatn-fd), 'Vazirmatn FD', 'Vazirmatn', system-ui, sans-serif",
});

const tokens = Object.freeze({
  colors,
  radius,
  shadows,
  focusRing,
  breakpoints,
  containers,
  fontFamily,
});

export default tokens;
