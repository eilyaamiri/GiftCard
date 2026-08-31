import 'dotenv/config';

import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * In Prisma 7 the datasource block in `schema.prisma` no longer accepts
 * `url = env(...)`. The connection string is supplied here for the CLI
 * (migrate / db push / studio) and, at runtime, through the `@prisma/adapter-pg`
 * driver adapter in `src/client.ts`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
