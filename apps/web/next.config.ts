import type { NextConfig } from 'next';

/**
 * Barat Pay customer storefront.
 *
 * `@barat/ui` and `@barat/contracts` ship TypeScript source rather than a build
 * artefact, so Next has to transpile them itself.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  transpilePackages: ['@barat/ui', '@barat/contracts'],

  /*
   * Only NEXT_PUBLIC_* values may reach the browser. Never a secret.
   *
   * Empty means "same origin". The customer session cookie is Secure and
   * SameSite=Lax, and the API's CORS allowlist names the production origins
   * only, so a cross-origin browser call would be rejected twice over. In
   * production nginx serves the API under /api on this very host, and the
   * rewrite below gives development the same shape.
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
          /* The payment gateway must not learn which product page the customer
           * came from when we redirect them out to pay. */
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;
