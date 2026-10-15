import type { NotificationResult, SmsMessage, SmsProvider } from '../index';

export const DEFAULT_IPPANEL_BASE_URL = 'https://edge.ippanel.com/v1';
export const DEFAULT_IPPANEL_TIMEOUT_MS = 10_000;

/**
 * The key the domain hands the code over under, in `SmsMessage.templateParams`.
 *
 * This is our own side of the contract and is fixed. It is deliberately not the
 * same setting as `patternCodeParam`, which names the variable inside the
 * vendor's template: the two live in different namespaces and a merchant can
 * call their template variable whatever they like.
 */
const DOMAIN_CODE_PARAM = 'code';

export interface IppanelSmsProviderConfig {
  /** The merchant API key, sent as the `Authorization` header. A secret: never logged, never in an error. */
  readonly apiKey: string;
  /** The pattern (template) code created in the IPPanel panel for the OTP message. */
  readonly patternCode: string;
  /** Sender line, E.164-shaped per the vendor docs (e.g. `+983000505`). */
  readonly fromNumber: string;
  /**
   * The variable name inside the vendor's template that carries the code.
   *
   * Case-sensitive and merchant-chosen: a template written `%CODE%` needs
   * `CODE` here. Unrelated to the key the domain uses internally.
   */
  readonly patternCodeParam?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export interface IppanelHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Injectable so tests can never accidentally reach the real gateway. */
export interface IppanelHttpClient {
  postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<IppanelHttpResponse>;
}

export class FetchIppanelHttpClient implements IppanelHttpClient {
  async postJson(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<IppanelHttpResponse> {
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }
}

/**
 * IPPanel (ippanel.com) pattern-send adapter for `AUTH_OTP`.
 *
 * One vendor endpoint, `POST /api/send` with `sending_type: "pattern"`: it takes
 * exactly one recipient and the pattern's variables, which is exactly the OTP
 * shape (one phone, one `code` variable) and needs no monitoring review per the
 * vendor docs — unlike a free-text SMS, which does.
 *
 * `message.body` is never sent: the pattern template is what actually renders
 * the text on the vendor's side, so only `message.templateParams` (the code)
 * goes over the wire, inside the `params` object the docs document.
 */
export class IppanelSmsProvider implements SmsProvider {
  readonly name = 'ippanel';

  private readonly apiKey: string;
  private readonly patternCode: string;
  private readonly fromNumber: string;
  private readonly patternCodeParam: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    config: IppanelSmsProviderConfig,
    private readonly httpClient: IppanelHttpClient = new FetchIppanelHttpClient(),
  ) {
    if (config.apiKey.trim() === '' || /\s/u.test(config.apiKey)) {
      throw new Error('IPPanel is enabled but its API key is missing or malformed');
    }
    if (!/^[A-Za-z0-9._-]{1,128}$/u.test(config.patternCode)) {
      throw new Error('IPPanel is enabled but its pattern code is invalid');
    }
    if (!/^\+\d{8,15}$/u.test(config.fromNumber)) {
      throw new Error('IPPanel is enabled but its sender number is not a valid E.164 number');
    }
    const patternCodeParam = config.patternCodeParam ?? 'code';
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(patternCodeParam)) {
      throw new Error('IPPanel is enabled but its pattern code-parameter name is invalid');
    }
    const timeoutMs = config.timeoutMs ?? DEFAULT_IPPANEL_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new Error('IPPanel request timeout must be an integer from 1 to 60000 milliseconds');
    }

    this.apiKey = config.apiKey;
    this.patternCode = config.patternCode;
    this.fromNumber = config.fromNumber;
    this.patternCodeParam = patternCodeParam;
    this.baseUrl = validateHttpsUrl(config.baseUrl ?? DEFAULT_IPPANEL_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = timeoutMs;
  }

  async send(message: SmsMessage): Promise<NotificationResult> {
    const code = message.templateParams?.[DOMAIN_CODE_PARAM];
    if (code === undefined || code === '') {
      /* Nothing to deliver: a pattern send with no variable value would still
       * reach the vendor, so this is refused before any network call. */
      return {
        success: false,
        failureCode: 'MISSING_TEMPLATE_PARAM',
        failureMessage: 'OTP code missing from template params',
        sentAt: new Date(),
      };
    }

    const recipient = toE164(message.to);
    if (recipient === null) {
      return {
        success: false,
        failureCode: 'INVALID_RECIPIENT',
        failureMessage: 'Recipient is not a valid E.164 number',
        sentAt: new Date(),
      };
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.httpClient.postJson(
        `${this.baseUrl}/api/send`,
        {
          sending_type: 'pattern',
          from_number: this.fromNumber,
          code: this.patternCode,
          recipients: [recipient],
          params: { [this.patternCodeParam]: code },
        },
        {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: this.apiKey,
        },
        controller.signal,
      );

      const sentAt = new Date();
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        /* An unparseable body is handled below via response.ok / status. */
      }

      if (!response.ok) {
        return {
          success: false,
          failureCode: `HTTP_${response.status}`,
          /* The vendor's own reason is useful operationally, but it is their
           * text about our request: if it quotes the code back, that must not
           * travel on into a log (AGENTS.md rule 10). */
          failureMessage: redact(readMessage(payload), code) ?? 'IPPanel rejected the request',
          sentAt,
        };
      }

      const messageId = readFirstOutboxId(payload);
      return {
        success: true,
        ...(messageId === null ? {} : { providerMessageId: messageId }),
        sentAt,
      };
    } catch {
      return {
        success: false,
        failureCode: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        failureMessage: timedOut ? 'IPPanel request timed out' : 'IPPanel request failed',
        sentAt: new Date(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateHttpsUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error();
    return url.toString();
  } catch {
    throw new Error('IPPanel base URL is invalid');
  }
}

/** Accepts `+98...` as-is and converts a bare `09...` mobile to `+98...`. */
function toE164(value: string): string | null {
  if (/^\+\d{8,15}$/u.test(value)) return value;
  if (/^0\d{10}$/u.test(value)) return `+98${value.slice(1)}`;
  return null;
}

/** Drops a vendor message that quotes the code rather than trying to scrub it. */
function redact(message: string | null, code: string): string | null {
  if (message === null) return null;
  return message.includes(code) ? 'IPPanel rejected the request' : message;
}

function readMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const meta = (payload as Record<string, unknown>)['meta'];
  if (typeof meta !== 'object' || meta === null) return null;
  const message = (meta as Record<string, unknown>)['message'];
  return typeof message === 'string' && message.length > 0 ? message : null;
}

function readFirstOutboxId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const data = (payload as Record<string, unknown>)['data'];
  if (typeof data !== 'object' || data === null) return null;
  const ids = (data as Record<string, unknown>)['message_outbox_ids'];
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const first = ids[0];
  return typeof first === 'number' || typeof first === 'string' ? String(first) : null;
}
