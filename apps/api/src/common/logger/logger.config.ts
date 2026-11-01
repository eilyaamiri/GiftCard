import { randomUUID } from 'node:crypto';

import type { Params } from 'nestjs-pino';

/**
 * Log redaction.
 *
 * AGENTS.md rule 10: a payment token, an API secret, a gift-card code or PIN, a
 * private key or an OTP value must never reach a log sink — not in development,
 * not in an error object, not "just this once" while debugging.
 *
 * pino's `redact` runs at serialisation time, so even a stray
 * `logger.info({ order })` cannot leak these keys.
 *
 * The wildcard `*.x` matches one level of nesting; the explicit deep paths cover
 * the shapes we actually build.
 */
export const REDACT_PATHS: string[] = [
  /* --- required by the engineering contract ----------------------------- */
  'req.headers.authorization',
  '*.password',
  '*.otp',
  '*.code',
  '*.pin',
  '*.giftCardCode',
  '*.merchant_id',
  '*.secret',
  '*.token',

  /* --- transport headers and cookies ------------------------------------ */
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'req.headers["x-internal-service-token"]',
  'res.headers["set-cookie"]',

  /* --- our own field names ---------------------------------------------- */
  'password',
  'passwordHash',
  'otp',
  'otpCode',
  'code',
  'codeHash',
  'pin',
  'giftCardCode',
  'encryptedCode',
  'encryptedPin',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'tokenHash',
  'merchantId',
  'merchant_id',
  'authority',
  'Authority',
  'providerAuthority',
  'cardNumber',
  'pan',
  'cvv',
  'nationalId',
  'privateKey',
  'iban',
  'ibanEncrypted',
  'cardEncrypted',
  'GIFT_CARD_ENCRYPTION_KEY',
  'BANK_DETAILS_ENCRYPTION_KEY',
  'SETTINGS_ENCRYPTION_KEY',
  'SESSION_JWT_SECRET',
  'ZARINPAL_MERCHANT_ID',
  'passwordEncrypted',
  'privateKeyEncrypted',
  'archivePassphrase',
  'archivePassphraseEncrypted',

  /* --- nested one level under any object -------------------------------- */
  '*.passwordHash',
  '*.codeHash',
  '*.encryptedCode',
  '*.encryptedPin',
  '*.accessToken',
  '*.refreshToken',
  '*.sessionToken',
  '*.tokenHash',
  '*.merchantId',
  '*.authority',
  '*.providerAuthority',
  '*.cardNumber',
  '*.nationalId',
  '*.privateKey',
  '*.passwordEncrypted',
  '*.privateKeyEncrypted',
  '*.archivePassphrase',
  '*.archivePassphraseEncrypted',
  '*.iban',
  '*.ibanEncrypted',
  '*.cardEncrypted',

  /* --- provider payloads we persist for audit ---------------------------- */
  'requestPayload.merchant_id',
  'requestPayload.MerchantID',
  'responsePayload.authority',
  'responsePayload.Authority',
];

/** Header names that must never be echoed into a log line. */
const IGNORED_REQUEST_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-internal-service-token',
]);

/**
 * Query parameters whose value is a credential. Gateways put their session
 * token in the return URL (BazaarPay `?token=`, ZarinPal `?Authority=`), and an
 * access log line is the first place it would otherwise land.
 *
 * Matched case-insensitively with `_` and `-` ignored, as a substring, so
 * `access_token`, `X-Token` and `authorityId` are all caught.
 */
const SENSITIVE_QUERY_TERMS = [
  'token',
  'authority',
  'secret',
  'password',
  'otp',
  'pin',
  'code',
  'signature',
  'apikey',
  'merchant',
];

function isSensitiveQueryKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[_-]/gu, '');
  return SENSITIVE_QUERY_TERMS.some((term) => normalised.includes(term));
}

/**
 * The request URL with every credential-bearing query value replaced.
 *
 * Works on the raw string rather than through `URL` so a malformed URL is still
 * redacted instead of being thrown away or logged verbatim. Keys are kept so a
 * log line still shows which parameters were present.
 */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const hashStart = url.indexOf('#', queryStart);
  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1, hashStart === -1 ? undefined : hashStart);

  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/gu, ' '));
      } catch {
        /* An undecodable key is judged as written. */
      }
      return eq !== -1 && isSensitiveQueryKey(key) ? `${rawKey}=[REDACTED]` : pair;
    })
    .join('&');

  /* A fragment never reaches the server; drop it rather than reason about it. */
  return `${path}?${redacted}`;
}

/**
 * An incoming `X-Request-Id` is reused only when it looks like an id. Anything
 * else — too long, or carrying characters that could forge a log line or a
 * header — is replaced by a fresh UUID instead of being echoed back.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
}

/**
 * Build the nestjs-pino options.
 *
 * In development we pretty-print. In production we emit newline-delimited JSON
 * so a log shipper can parse it, and we never enable `query`-level SQL logging.
 */
export function buildLoggerOptions(options: {
  isProduction: boolean;
  isTest: boolean;
  level?: string;
}): Params {
  const { isProduction, isTest } = options;
  const level = options.level ?? (isProduction ? 'info' : isTest ? 'silent' : 'debug');

  return {
    pinoHttp: {
      level,
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
        remove: false,
      },
      /** Correlates every log line of one request; echoed in the error body. */
      genReqId: (req, res) => {
        const id = resolveRequestId(req.headers['x-request-id']);
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: () => ({ service: 'barat-api' }),
      autoLogging: {
        ignore: (req) => req.url === '/api/health' || req.url === '/api/health/live',
      },
      serializers: {
        req(req: { method: string; url: string; headers: Record<string, unknown>; id: unknown }) {
          const headers: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (!IGNORED_REQUEST_HEADERS.has(key.toLowerCase())) {
              headers[key] = value;
            }
          }
          return { id: req.id, method: req.method, url: redactUrl(req.url), headers };
        },
        res(res: { statusCode: number }) {
          return { statusCode: res.statusCode };
        },
        err(err: Error & { code?: string }) {
          // Message and stack only. A provider error object can carry a merchant
          // id or an authority in arbitrary fields.
          return { type: err.name, message: err.message, code: err.code, stack: err.stack };
        },
      },
      transport: isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              singleLine: false,
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          },
    },
  };
}
