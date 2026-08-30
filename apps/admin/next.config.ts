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

  env: {
    NEXT_PUBLIC_API_URL: process.env['API_PUBLIC_URL'] ?? 'http://localhost:4000',
  },

  typedRoutes: true,

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
