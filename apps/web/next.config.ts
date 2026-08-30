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

  /** Only NEXT_PUBLIC_* values may reach the browser. Never a secret. */
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
