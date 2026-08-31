import type { NextConfig } from 'next';

/**
 * Barat Pay admin panel and operator workspace.
 *
 * This app displays gift-card codes, customer data and financial reports. It is
 * never indexed, never framed, and every permission it appears to grant is
 * re-checked on the server — a hidden button is a convenience, not a control.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  transpilePackages: ['@barat/ui', '@barat/contracts'],

  /*
   * Empty means "same origin". The staff session cookie is SameSite=Strict, so a
   * browser call to a different site would never carry it — in production nginx
   * serves the API under /api on this very host, and the rewrite below gives
   * development the same shape instead of a cross-origin request that CORS and
   * the cookie policy would both reject.
   */
  env: {
    NEXT_PUBLIC_API_URL: process.env['API_PUBLIC_URL'] ?? '',
  },

  typedRoutes: true,

  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    const target = process.env['API_INTERNAL_URL'] ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          /* A screen showing a gift-card code must not leak its URL anywhere. */
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;
