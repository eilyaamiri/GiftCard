import { z } from 'zod';

import { INTERNAL_API_URL_RULE, parseInternalApiUrl } from './internal-api-url';

/* ============================================================================
 * Environment
 *
 * The worker validates its own environment and fails fast, exactly like the API.
 * It needs strictly less than the API does — no gateway credentials, because a
 * background job never talks to a payment gateway on a customer's behalf.
 * ==========================================================================*/

/** `KEY=` in an env file means unset, not "the empty string". */
const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    /** How many jobs one worker process handles at once. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
    /*
     * Where the delivery-retry sweep reaches the API, including the `/api`
     * prefix. Every call carries the internal token, so only internal hosts
     * are accepted (WRK-8).
     */
    INTERNAL_API_URL: z
      .string()
      .default('http://127.0.0.1:4000/api')
      .refine((value) => parseInternalApiUrl(value) !== null, INTERNAL_API_URL_RULE),
    /** The same value the API holds; it authenticates the worker's calls. */
    INTERNAL_SERVICE_TOKEN: blankAsUndefined(
      z.string().min(32, 'INTERNAL_SERVICE_TOKEN must be at least 32 characters'),
    ),
  })
  .superRefine((env, ctx) => {
    /* In production a missing token would silently switch automatic delivery
     * retries off. Refuse to start instead; only local development may run
     * without it. */
    if (
      (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') &&
      env.INTERNAL_SERVICE_TOKEN === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_SERVICE_TOKEN'],
        message: `INTERNAL_SERVICE_TOKEN is required when NODE_ENV=${env.NODE_ENV}`,
      });
    }
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Names only, never values — an env dump is a secret leak.
    throw new Error(`Invalid worker environment. Refusing to start.\n${problems}`);
  }

  return result.data;
}
