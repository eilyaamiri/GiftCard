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
  'SESSION_JWT_SECRET',
  'ZARINPAL_MERCHANT_ID',

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
const IGNORED_REQUEST_HEADERS = new Set(['authorization', 'cookie', 'x-api-key']);

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
        const existing = req.headers['x-request-id'];
        const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
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
          return { id: req.id, method: req.method, url: req.url, headers };
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
