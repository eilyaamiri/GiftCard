/**
 * Tailwind CSS v4 uses a PostCSS plugin instead of a JS config file.
 * The design tokens live in `@barat/config/tailwind/theme.css`, imported from
 * the app's global stylesheet with `@import`.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
