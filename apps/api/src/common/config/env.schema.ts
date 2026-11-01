import { z } from 'zod';

/**
 * Environment validation — FAIL FAST.
 *
 * The process must refuse to boot with a missing, empty or malformed variable.
 * A silent default for a secret or a money-related threshold is how a POC ends
 * up charging real customers the wrong amount.
 */

const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((value) => value === true || value === 'true' || value === '1' || value === 'yes');

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();

const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
    'Must be an http(s) URL',
  );

/** CORS allow-list entries must be origins, never URLs with a path/query. */
const publicOrigin = httpUrl.refine((value) => new URL(value).origin === value, {
  message: 'Must be an origin only (scheme + host + optional port), with no path or trailing slash',
});

const postgresUrl = z.string().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'postgresql:' || protocol === 'postgres:';
  } catch {
    return false;
  }
}, 'Must be a valid postgresql:// connection URL');

const redisUrl = z.string().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'redis:' || protocol === 'rediss:';
  } catch {
    return false;
  }
}, 'Must be a valid redis:// or rediss:// connection URL');

/**
 * In a `.env` file the natural way to say "not configured" is to leave the value
 * blank (`ZARINPAL_MERCHANT_ID=`), which arrives as an empty string rather than
 * as undefined. Treat blank as absent so an operator is never pushed into
 * inventing a placeholder merchant id just to boot with the gateway disabled.
 *
 * This does not loosen anything: the `superRefine` below still rejects a blank
 * value whenever ZARINPAL_ENABLED is true.
 */
const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );

/**
 * AES-256-GCM key: exactly 32 raw bytes, base64 encoded.
 * Generate with `openssl rand -base64 32`.
 */
const base64Key32 = z
  .string()
  .min(1, 'An AES-256-GCM key is required')
  .refine((value) => {
    try {
      const decoded = Buffer.from(value, 'base64');
      return decoded.length === 32 && decoded.toString('base64') === value;
    } catch {
      return false;
    }
  }, 'The key must be exactly 32 bytes, canonical base64 (openssl rand -base64 32)');

export const envSchema = z
  .object({
    /* ---------------------------------------------------------------- runtime */
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: port.default(4000),

    /* --------------------------------------------------------- infrastructure */
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,

    /* ------------------------------------------------------------ public URLs */
    API_PUBLIC_URL: publicOrigin,
    WEB_PUBLIC_URL: publicOrigin,
    ADMIN_PUBLIC_URL: publicOrigin,

    /* --------------------------------------------------------------- secrets */
    SESSION_JWT_SECRET: z
      .string()
      .min(32, 'SESSION_JWT_SECRET must be at least 32 characters'),
    GIFT_CARD_ENCRYPTION_KEY: base64Key32,
    /**
     * Encrypts the customer's own payout details (IBAN, card number). Optional
     * so a developer box still boots on one key; production sets its own, so a
     * gift-card key rotation never has to move bank data with it.
     */
    BANK_DETAILS_ENCRYPTION_KEY: blankAsUndefined(base64Key32),
    /**
     * Encrypts the secrets an admin enters in the panel's settings: the SMTP
     * password, the backup server's SSH private key and the backup archive
     * passphrase. Optional so an existing deployment still boots; until it is
     * set the panel refuses to store any of them, and no fallback to another
     * key exists on purpose.
     */
    SETTINGS_ENCRYPTION_KEY: blankAsUndefined(base64Key32),
    /** Persistent local storage for catalog product images. */
    PRODUCT_IMAGE_DIR: z.string().trim().min(1).default('/var/lib/baratpay/product-images'),
    /**
     * Where the host's backup timer leaves its `snapshot-*` directories, each
     * holding one completed `database.dump`. The API only reads from here; it
     * is an environment setting, not a panel one, so an admin account cannot
     * point the off-host copy at an arbitrary file on the server.
     */
    BACKUP_SOURCE_DIR: z.string().trim().min(1).default('/var/backups/baratpay'),

    /* ------------------------------------------------------------ OTP policy */
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_SECONDS: positiveInt.max(900).default(120),
    OTP_RESEND_SECONDS: positiveInt.max(900).default(60),
    OTP_MAX_ATTEMPTS: positiveInt.max(20).default(5),
    OTP_MAX_REQUESTS_PER_HOUR: positiveInt.max(100).default(10),
    /**
     * DEMO ONLY. When set, every login code issued is this exact value instead
     * of a random one, so the storefront can be exercised without an SMS
     * gateway wired up.
     *
     * It replaces only the source of randomness. The code is still hashed with
     * argon2id, still single-use, still expires, still counts failed attempts
     * and still locks out — nothing on the verify path is bypassed or weakened,
     * because there is no branch there at all. What it does destroy is the one
     * property OTP exists for: possession of the phone. Anyone who knows this
     * value can sign in as any mobile number.
     *
     * The interlock below refuses to boot if this is set in production or
     * while a live payment gateway is on, so it cannot be left behind on a
     * deployment that takes real money.
     */
    OTP_DEV_FIXED_CODE: blankAsUndefined(
      z.string().regex(/^\d+$/u, 'OTP_DEV_FIXED_CODE must contain digits only'),
    ),

    /* ---------------------------------------------------------------- ZarinPal */
    ZARINPAL_ENABLED: booleanFromEnv.default(false),
    ZARINPAL_MERCHANT_ID: blankAsUndefined(z.string().trim().min(1)),
    ZARINPAL_REQUEST_URL: blankAsUndefined(httpUrl),
    ZARINPAL_VERIFY_URL: blankAsUndefined(httpUrl),
    ZARINPAL_STARTPAY_URL: blankAsUndefined(httpUrl),
    ZARINPAL_CALLBACK_URL: blankAsUndefined(httpUrl),
    ZARINPAL_REQUEST_TIMEOUT_MS: positiveInt.max(60_000).default(10_000),
    /**
     * OPEN DECISION — must be confirmed against the real merchant contract.
     * Both units are supported and non-divisible conversions are rejected.
     */
    ZARINPAL_AMOUNT_UNIT: z.enum(['IRR', 'IRT']).default('IRR'),

    /* --------------------------------------------------------------- BazaarPay */
    /**
     * Second rial gateway. Exactly one rial gateway (ZarinPal, BazaarPay or
     * Amin) may be on; turning any of them on is a human release gate
     * (AGENTS.md section 4). `BAZAARPAY_API_TOKEN` is a secret: it is never
     * logged or echoed.
     */
    BAZAARPAY_ENABLED: booleanFromEnv.default(false),
    BAZAARPAY_API_TOKEN: blankAsUndefined(z.string().trim().min(1)),
    BAZAARPAY_DESTINATION: blankAsUndefined(z.string().trim().min(1)),
    /** Unset means the adapter's built-in production base URL. */
    BAZAARPAY_BASE_URL: blankAsUndefined(httpUrl),
    BAZAARPAY_AMOUNT_UNIT: z.enum(['IRR', 'IRT']).default('IRR'),
    BAZAARPAY_TIMEOUT_MS: positiveInt.max(60_000).default(10_000),
    /** Skips BazaarPay's own login for a signed-in customer (verified mobile only). */
    BAZAARPAY_AUTO_LOGIN: booleanFromEnv.default(false),

    /* -------------------------------------------------------------------- Amin */
    /**
     * Third rial gateway (api.aminremit.com). `AMIN_MERCHANT_ID` is its only
     * credential, so it is a secret: handed to the adapter's constructor and
     * nowhere else, never logged or quoted in an error. The adapter only exists
     * when `AMIN_ENABLED` is explicitly true, never because an id is present.
     */
    AMIN_ENABLED: booleanFromEnv.default(false),
    AMIN_MERCHANT_ID: blankAsUndefined(z.string().trim().min(1)),
    /** Unset means the adapter's built-in production base URL. */
    AMIN_BASE_URL: blankAsUndefined(httpUrl),
    AMIN_TIMEOUT_MS: positiveInt.max(60_000).default(10_000),

    /**
     * Lets a production process run on the mock gateway, which treats every
     * payment as successful. Off by default: with no live gateway configured,
     * production refuses to boot instead of silently giving goods away.
     */
    PAYMENTS_ALLOW_MOCK: booleanFromEnv.default(false),

    /* -------------------------------------------------- internal service calls */
    /**
     * Shared secret the worker presents in `x-internal-service-token` when it
     * calls the API's internal endpoints. Unset disables those endpoints; the
     * worker reads the same value together with INTERNAL_API_URL.
     */
    INTERNAL_SERVICE_TOKEN: blankAsUndefined(
      z.string().min(32, 'INTERNAL_SERVICE_TOKEN must be at least 32 characters'),
    ),

    /* ------------------------------------------------------------ FX / quotes */
    FX_STALE_THRESHOLD_SECONDS: positiveInt.max(86_400).default(900),
    /*
     * How long a quote stays payable is NOT an environment setting: it is
     * `PricingRule.quoteTtlSeconds`, edited per rule in the admin panel and
     * snapshotted onto the quote. A `QUOTE_TTL_SECONDS` used to be declared
     * here and read by nothing, so setting it on a server looked like a change
     * and silently was not one.
     */
  })
  .superRefine((env, ctx) => {
    /* ZarinPal is either fully configured or fully off — never half-configured. */
    if (env.ZARINPAL_ENABLED) {
      const required = [
        'ZARINPAL_MERCHANT_ID',
        'ZARINPAL_REQUEST_URL',
        'ZARINPAL_VERIFY_URL',
        'ZARINPAL_STARTPAY_URL',
        'ZARINPAL_CALLBACK_URL',
      ] as const;

      for (const key of required) {
        const value = env[key];
        if (!value || value.trim() === '') {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when ZARINPAL_ENABLED is true`,
          });
        }
      }
    }

    /* Resending sooner than the code lives would let an attacker farm codes. */
    if (env.OTP_RESEND_SECONDS > env.OTP_TTL_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_RESEND_SECONDS'],
        message: 'OTP_RESEND_SECONDS must not exceed OTP_TTL_SECONDS',
      });
    }

    /* BazaarPay, like ZarinPal, is fully configured or fully off. */
    if (env.BAZAARPAY_ENABLED) {
      for (const key of ['BAZAARPAY_API_TOKEN', 'BAZAARPAY_DESTINATION'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when BAZAARPAY_ENABLED is true`,
          });
        }
      }
    }

    /* Amin, like the others, is fully configured or fully off. */
    if (env.AMIN_ENABLED && !env.AMIN_MERCHANT_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['AMIN_MERCHANT_ID'],
        message: 'AMIN_MERCHANT_ID is required when AMIN_ENABLED is true',
      });
    }

    /* Which gateway a customer is sent to must never depend on a precedence
     * rule nobody wrote down. */
    const liveGateways = [
      env.ZARINPAL_ENABLED ? 'ZARINPAL_ENABLED' : null,
      env.BAZAARPAY_ENABLED ? 'BAZAARPAY_ENABLED' : null,
      env.AMIN_ENABLED ? 'AMIN_ENABLED' : null,
    ].filter((flag): flag is string => flag !== null);
    if (liveGateways.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: [liveGateways[liveGateways.length - 1] ?? 'ZARINPAL_ENABLED'],
        message: `${liveGateways.join(' and ')} are all true: exactly one rial gateway may take payments`,
      });
    }

    /* With no live gateway the API falls back to the mock, which reports every
     * payment as successful. In production that means goods for free, so it is
     * only allowed when someone has said so explicitly. */
    if (
      env.NODE_ENV === 'production' &&
      liveGateways.length === 0 &&
      !env.PAYMENTS_ALLOW_MOCK
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENTS_ALLOW_MOCK'],
        message:
          'No live payment gateway is enabled in production. Enable ZARINPAL_ENABLED, ' +
          'BAZAARPAY_ENABLED or AMIN_ENABLED, or set PAYMENTS_ALLOW_MOCK=true to run on the ' +
          'mock gateway knowingly',
      });
    }

    /* A fixed login code and a live payment gateway must never coexist. Taking
     * real money is the clearest signal that a deployment is not a demo, so it
     * is the signal this interlock uses: refusing to boot is the only failure
     * mode loud enough to stop the value being forgotten in an env file. */
    if (env.OTP_DEV_FIXED_CODE && liveGateways.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_DEV_FIXED_CODE'],
        message:
          `OTP_DEV_FIXED_CODE must not be set while ${liveGateways[0] ?? 'a gateway'} ` +
          'is true — a fixed login code lets anyone sign in as any mobile number, which is not ' +
          'survivable on a deployment that accepts payments',
      });
    }

    /* Production is never a demo, whatever the gateway flags say. */
    if (env.OTP_DEV_FIXED_CODE && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_DEV_FIXED_CODE'],
        message:
          'OTP_DEV_FIXED_CODE must not be set when NODE_ENV is production — a fixed login code ' +
          'lets anyone sign in as any mobile number',
      });
    }

    /* A code shorter or longer than OTP_LENGTH would be rejected by the login
     * form before it ever reached the API, which reads as "the fixed code does
     * not work" rather than as a misconfiguration. */
    if (env.OTP_DEV_FIXED_CODE && env.OTP_DEV_FIXED_CODE.length !== env.OTP_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_DEV_FIXED_CODE'],
        message: `OTP_DEV_FIXED_CODE must be exactly OTP_LENGTH (${env.OTP_LENGTH}) digits`,
      });
    }

    /* Production refuses the example placeholders. */
    if (env.NODE_ENV === 'production') {
      if (env.SESSION_JWT_SECRET.includes('change-me')) {
        ctx.addIssue({
          code: 'custom',
          path: ['SESSION_JWT_SECRET'],
          message: 'SESSION_JWT_SECRET still holds the example placeholder',
        });
      }
      if (Buffer.from(env.GIFT_CARD_ENCRYPTION_KEY, 'base64').every((byte) => byte === 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['GIFT_CARD_ENCRYPTION_KEY'],
          message: 'GIFT_CARD_ENCRYPTION_KEY is the all-zero example key',
        });
      }
      /* Reusing a key would let one domain's leak open the other's columns. */
      if (
        env.SETTINGS_ENCRYPTION_KEY !== undefined &&
        (env.SETTINGS_ENCRYPTION_KEY === env.GIFT_CARD_ENCRYPTION_KEY ||
          env.SETTINGS_ENCRYPTION_KEY === env.BANK_DETAILS_ENCRYPTION_KEY)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['SETTINGS_ENCRYPTION_KEY'],
          message: 'SETTINGS_ENCRYPTION_KEY must differ from the gift-card and bank-details keys',
        });
      }
    }
  });

/** The fully parsed, typed environment. */
export type AppEnv = z.infer<typeof envSchema>;

/**
 * Nest `ConfigModule.forRoot({ validate })` hook.
 *
 * Throws a single readable error listing every problem at once, so a
 * misconfigured deployment is fixed in one pass instead of five restarts.
 * The error message never echoes a value — only the variable name.
 */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration. The API will not start.\n${problems}\n` +
        'See .env.example for the full list of required variables.',
    );
  }

  return result.data;
}
