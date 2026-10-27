import { randomUUID } from 'node:crypto';
import { connect as netConnect } from 'node:net';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls';

import type { EmailMessage, EmailProvider, NotificationResult } from '../index';
import {
  buildMimeMessage,
  dotStuff,
  InvalidEmailMessageError,
  isDeliverableAddress,
} from './smtp-message';

export const DEFAULT_SMTP_TIMEOUT_MS = 15_000;
const MAX_REPLY_BYTES = 64 * 1024;

export type SmtpSecurityMode = 'SSL_TLS' | 'STARTTLS';

export interface SmtpEmailProviderConfig {
  readonly host: string;
  readonly port: number;
  /**
   * Both modes are encrypted before any credential or message is sent. There
   * is deliberately no plaintext mode: the body of a login e-mail is the code.
   */
  readonly security: SmtpSecurityMode;
  /** Empty or absent means the relay is used without AUTH. */
  readonly username?: string;
  /** A secret: never logged, never in an error or a result. */
  readonly password?: string;
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly timeoutMs?: number;
  /**
   * Extra trust anchors, for a relay with a private CA (and for tests). The
   * server certificate is always verified; this cannot switch that off.
   */
  readonly ca?: ConnectionOptions['ca'];
}

/** Closed set of reasons, safe to log, store and show to an admin. */
export type SmtpFailureCode =
  | 'CONNECT_FAILED'
  | 'TLS_FAILED'
  | 'STARTTLS_UNSUPPORTED'
  | 'AUTH_UNSUPPORTED'
  | 'AUTH_FAILED'
  | 'SENDER_REJECTED'
  | 'RECIPIENT_REJECTED'
  | 'MESSAGE_REJECTED'
  | 'INVALID_MESSAGE'
  | 'TIMEOUT'
  | 'CONNECTION_LOST'
  | 'PROTOCOL_ERROR';

const FAILURE_MESSAGES: Record<SmtpFailureCode, string> = {
  CONNECT_FAILED: 'Could not connect to the SMTP server',
  TLS_FAILED: 'TLS negotiation with the SMTP server failed',
  STARTTLS_UNSUPPORTED: 'The SMTP server does not offer STARTTLS on this port',
  AUTH_UNSUPPORTED: 'The SMTP server offers neither AUTH PLAIN nor AUTH LOGIN',
  AUTH_FAILED: 'The SMTP server rejected the username or password',
  SENDER_REJECTED: 'The SMTP server rejected the sender address',
  RECIPIENT_REJECTED: 'The SMTP server rejected the recipient address',
  MESSAGE_REJECTED: 'The SMTP server rejected the message',
  INVALID_MESSAGE: 'The message has an invalid address or header',
  TIMEOUT: 'The SMTP server did not answer in time',
  CONNECTION_LOST: 'The SMTP server closed the connection',
  PROTOCOL_ERROR: 'The SMTP server sent an unexpected reply',
};

/* Socket errors that mean "never reached a server", as opposed to a TLS
 * problem with the server we did reach. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
]);

export class SmtpError extends Error {
  constructor(
    readonly code: SmtpFailureCode,
    /** The server's 3-digit reply code, when the failure was a reply. */
    readonly replyCode?: number,
    /** A constant from Node's TLS stack, e.g. `CERT_HAS_EXPIRED`. Never free text. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'SmtpError';
  }

  /** Normalised, admin-readable. Never the server's own text, never content. */
  describe(): string {
    const parts = [FAILURE_MESSAGES[this.code]];
    if (this.replyCode !== undefined) parts.push(`(SMTP ${this.replyCode})`);
    if (this.detail !== undefined) parts.push(`(${this.detail})`);
    return parts.join(' ');
  }
}

/** Outcome of a connection test. */
export interface SmtpVerifyResult {
  readonly success: boolean;
  readonly failureCode?: SmtpFailureCode;
  readonly failureMessage?: string;
  /** Whether the session authenticated, i.e. a username was configured. */
  readonly authenticated: boolean;
  readonly durationMs: number;
}

/**
 * SMTP submission adapter, written against Node's own `net`/`tls`.
 *
 * One connection per message: login codes are rare and a pooled connection
 * would hold an authenticated session open between them for nothing.
 *
 * The password and the message body only ever travel inside the encrypted
 * session. No method logs; every failure is reduced to a `SmtpFailureCode`
 * plus the server's numeric reply code, never the server's free text, which
 * can quote an address back.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';

  private readonly config: Required<Pick<SmtpEmailProviderConfig, 'timeoutMs'>> &
    SmtpEmailProviderConfig;

  constructor(
    config: SmtpEmailProviderConfig,
    private readonly sockets: SmtpSocketFactory = new TcpSmtpSocketFactory(),
  ) {
    if (!/^[A-Za-z0-9.-]{1,253}$/u.test(config.host)) {
      throw new Error('SMTP host is not a valid host name');
    }
    if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65_535) {
      throw new Error('SMTP port must be an integer from 1 to 65535');
    }
    if (!isDeliverableAddress(config.fromAddress)) {
      throw new Error('SMTP sender address is not valid');
    }
    if (config.replyTo !== undefined && !isDeliverableAddress(config.replyTo)) {
      throw new Error('SMTP reply-to address is not valid');
    }
    if ((config.username ?? '') !== '' && (config.password ?? '') === '') {
      throw new Error('SMTP password is required when a username is set');
    }
    const timeoutMs = config.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
      throw new Error('SMTP timeout must be an integer from 1 to 120000 milliseconds');
    }
    this.config = { ...config, timeoutMs };
  }

  async send(message: EmailMessage): Promise<NotificationResult> {
    const messageId = `${randomUUID()}@${domainOf(this.config.fromAddress)}`;
    const replyTo = message.replyTo ?? this.config.replyTo;
    let rendered: string;
    try {
      rendered = buildMimeMessage({
        fromAddress: this.config.fromAddress,
        ...(this.config.fromName === undefined ? {} : { fromName: this.config.fromName }),
        to: message.to,
        ...(replyTo === undefined ? {} : { replyTo }),
        subject: message.subject,
        html: message.html,
        ...(message.text === undefined ? {} : { text: message.text }),
        ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
        messageId,
        date: new Date(),
      });
    } catch (error) {
      if (error instanceof InvalidEmailMessageError) {
        return failure(new SmtpError('INVALID_MESSAGE'));
      }
      throw error;
    }

    try {
      await this.session(async (session) => {
        await session.expect(`MAIL FROM:<${this.config.fromAddress}>`, [250], 'SENDER_REJECTED');
        await session.expect(`RCPT TO:<${message.to}>`, [250, 251], 'RECIPIENT_REJECTED');
        await session.expect('DATA', [354], 'MESSAGE_REJECTED');
        await session.expect(`${dotStuff(rendered)}\r\n.`, [250], 'MESSAGE_REJECTED');
      });
      return { success: true, providerMessageId: messageId, sentAt: new Date() };
    } catch (error) {
      return failure(asSmtpError(error));
    }
  }

  /** Connect, negotiate TLS, authenticate and quit — without sending anything. */
  async verify(): Promise<SmtpVerifyResult> {
    const started = Date.now();
    const authenticated = (this.config.username ?? '') !== '';
    try {
      await this.session(async () => undefined);
      return { success: true, authenticated, durationMs: Date.now() - started };
    } catch (error) {
      const smtpError = asSmtpError(error);
      return {
        success: false,
        failureCode: smtpError.code,
        failureMessage: smtpError.describe(),
        authenticated,
        durationMs: Date.now() - started,
      };
    }
  }

  /* ---------------------------------------------------------------- session */

  private async session(work: (session: SmtpSession) => Promise<void>): Promise<void> {
    const socket = await this.sockets.connect(this.config.host, this.config.port, this.config.timeoutMs);
    const session = new SmtpSession(socket, this.config.timeoutMs);
    try {
      if (this.config.security === 'SSL_TLS') {
        await session.upgradeToTls(this.config);
      }
      await session.read([220], 'CONNECT_FAILED');
      let capabilities = await session.ehlo(domainOf(this.config.fromAddress));

      if (this.config.security === 'STARTTLS') {
        if (!capabilities.has('STARTTLS')) throw new SmtpError('STARTTLS_UNSUPPORTED');
        await session.expect('STARTTLS', [220], 'STARTTLS_UNSUPPORTED');
        await session.upgradeToTls(this.config);
        capabilities = await session.ehlo(domainOf(this.config.fromAddress));
      }

      const username = this.config.username ?? '';
      if (username !== '') {
        await session.authenticate(capabilities, username, this.config.password ?? '');
      }

      await work(session);
      await session.quit();
    } finally {
      session.destroy();
    }
  }
}

/* ======================================================================== */

interface SmtpReply {
  readonly code: number;
  readonly lines: readonly string[];
}

interface PendingRead {
  readonly resolve: (reply: SmtpReply) => void;
  readonly reject: (error: SmtpError) => void;
}

/**
 * Opens the TCP connection. TLS is always layered on top by the session, so a
 * test can hand in one end of an in-memory stream pair instead of a port.
 */
export interface SmtpSocketFactory {
  connect(host: string, port: number, timeoutMs: number): Promise<Duplex>;
}

export class TcpSmtpSocketFactory implements SmtpSocketFactory {
  connect(host: string, port: number, timeoutMs: number): Promise<Duplex> {
    return new Promise((resolve, reject) => {
      const socket = netConnect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new SmtpError('TIMEOUT'));
      }, timeoutMs);
      const onError = (error: Error): void => {
        clearTimeout(timer);
        socket.destroy();
        reject(socketError(error, 'connecting'));
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeListener('error', onError);
        resolve(socket);
      });
    });
  }
}

/**
 * One SMTP conversation: a reply parser over a stream that is swapped for a
 * TLS one before anything secret is said (implicit TLS or STARTTLS).
 */
class SmtpSession {
  private socket: Duplex;
  private buffer = '';
  private currentLines: string[] = [];
  private readonly replies: SmtpReply[] = [];
  private pending: PendingRead | null = null;
  private failure: SmtpError | null = null;
  private timer: NodeJS.Timeout | null = null;
  /* Paused-mode reads ('readable' + read()) rather than 'data': a stream left in
   * flowing mode cannot be handed to tls.connect afterwards — the TLS layer
   * never sees the server's handshake and STARTTLS hangs. */
  private readonly onReadable = (): void => {
    let chunk: unknown = this.socket.read();
    while (chunk !== null) {
      this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'latin1'));
      if (this.failure !== null) return;
      chunk = this.socket.read();
    }
  };
  private readonly onError = (error: Error): void => this.fail(socketError(error, 'established'));
  private readonly onClose = (): void => this.fail(new SmtpError('CONNECTION_LOST'));

  constructor(
    socket: Duplex,
    private readonly timeoutMs: number,
  ) {
    this.socket = socket;
    this.attach();
  }

  /** Send one command line and require one of `accepted` as the reply code. */
  async expect(
    line: string,
    accepted: readonly number[],
    rejection: SmtpFailureCode,
  ): Promise<SmtpReply> {
    this.write(line);
    return this.read(accepted, rejection);
  }

  async read(accepted: readonly number[], rejection: SmtpFailureCode): Promise<SmtpReply> {
    const reply = await this.nextReply();
    if (!accepted.includes(reply.code)) throw new SmtpError(rejection, reply.code);
    return reply;
  }

  async ehlo(clientName: string): Promise<Set<string>> {
    const reply = await this.expect(`EHLO ${clientName}`, [250], 'PROTOCOL_ERROR');
    const capabilities = new Set<string>();
    for (const line of reply.lines.slice(1)) {
      const [keyword, ...rest] = line.trim().toUpperCase().split(/\s+/u);
      if (keyword === undefined || keyword === '') continue;
      capabilities.add(keyword);
      if (keyword === 'AUTH') {
        for (const mechanism of rest) capabilities.add(`AUTH=${mechanism}`);
      }
    }
    return capabilities;
  }

  async authenticate(capabilities: Set<string>, username: string, password: string): Promise<void> {
    if (capabilities.has('AUTH=PLAIN')) {
      const token = Buffer.from(`\u0000${username}\u0000${password}`, 'utf8').toString('base64');
      await this.expect(`AUTH PLAIN ${token}`, [235], 'AUTH_FAILED');
      return;
    }
    if (capabilities.has('AUTH=LOGIN')) {
      await this.expect('AUTH LOGIN', [334], 'AUTH_FAILED');
      await this.expect(Buffer.from(username, 'utf8').toString('base64'), [334], 'AUTH_FAILED');
      await this.expect(Buffer.from(password, 'utf8').toString('base64'), [235], 'AUTH_FAILED');
      return;
    }
    throw new SmtpError('AUTH_UNSUPPORTED');
  }

  upgradeToTls(config: SmtpEmailProviderConfig & { timeoutMs: number }): Promise<void> {
    this.detach();
    const plain = this.socket;
    return new Promise((resolve, reject) => {
      const secure = tlsConnect({
        socket: plain,
        servername: config.host,
        minVersion: 'TLSv1.2',
        ...(config.ca === undefined ? {} : { ca: config.ca }),
      });
      const timer = setTimeout(() => {
        secure.destroy();
        reject(new SmtpError('TIMEOUT'));
      }, this.timeoutMs);
      const onError = (error: Error): void => {
        clearTimeout(timer);
        secure.destroy();
        reject(socketError(error, 'handshake'));
      };
      secure.once('error', onError);
      secure.once('secureConnect', () => {
        clearTimeout(timer);
        secure.removeListener('error', onError);
        this.socket = secure;
        /* Anything the server sent in the clear after its 220 is discarded,
         * never read as a reply inside the encrypted session: that is how a
         * man in the middle injects commands across a STARTTLS upgrade. */
        this.buffer = '';
        this.currentLines = [];
        this.replies.length = 0;
        this.attach();
        resolve();
      });
    });
  }

  async quit(): Promise<void> {
    try {
      await this.expect('QUIT', [221], 'PROTOCOL_ERROR');
    } catch {
      /* The message is already accepted; a server that hangs up instead of
       * saying goodbye changes nothing. */
    }
  }

  destroy(): void {
    this.clearTimer();
    this.detach();
    this.socket.destroy();
  }

  /* ------------------------------------------------------------- internals */

  private write(line: string): void {
    if (this.failure !== null) throw this.failure;
    this.socket.write(`${line}\r\n`);
  }

  private nextReply(): Promise<SmtpReply> {
    const ready = this.replies.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    if (this.failure !== null) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.timer = setTimeout(() => this.fail(new SmtpError('TIMEOUT')), this.timeoutMs);
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer += chunk.toString('latin1');
    if (this.buffer.length > MAX_REPLY_BYTES) {
      this.fail(new SmtpError('PROTOCOL_ERROR'));
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/u, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.consumeLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private consumeLine(line: string): void {
    const match = /^(\d{3})([ -]?)(.*)$/u.exec(line);
    if (match === null) {
      this.fail(new SmtpError('PROTOCOL_ERROR'));
      return;
    }
    this.currentLines.push(match[3] ?? '');
    if (match[2] === '-') return;

    const reply: SmtpReply = { code: Number(match[1]), lines: this.currentLines };
    this.currentLines = [];
    if (this.pending !== null) {
      const { resolve } = this.pending;
      this.pending = null;
      this.clearTimer();
      resolve(reply);
    } else {
      this.replies.push(reply);
    }
  }

  private fail(error: SmtpError): void {
    if (this.failure !== null) return;
    this.failure = error;
    this.clearTimer();
    if (this.pending !== null) {
      const { reject } = this.pending;
      this.pending = null;
      reject(error);
    }
    this.socket.destroy();
  }

  private attach(): void {
    this.socket.on('readable', this.onReadable);
    this.socket.on('error', this.onError);
    this.socket.on('close', this.onClose);
  }

  private detach(): void {
    this.socket.removeListener('readable', this.onReadable);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('close', this.onClose);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/**
 * `connecting`: opening the TCP connection. `handshake`: negotiating TLS.
 * `established`: anything after that.
 */
function socketError(error: Error, phase: 'connecting' | 'handshake' | 'established'): SmtpError {
  const raw = (error as NodeJS.ErrnoException).code;
  /* Node's own constants only, e.g. ECONNREFUSED or CERT_HAS_EXPIRED. */
  const code = raw !== undefined && /^[A-Z0-9_]{3,64}$/u.test(raw) ? raw : undefined;
  if (phase === 'established') return new SmtpError('CONNECTION_LOST', undefined, code);
  if (phase === 'connecting' || (code !== undefined && NETWORK_ERROR_CODES.has(code))) {
    return new SmtpError('CONNECT_FAILED', undefined, code);
  }
  /* Anything else during the handshake is the TLS layer: an expired,
   * self-signed or wrong-host certificate, or no common protocol version. */
  return new SmtpError('TLS_FAILED', undefined, code);
}

function asSmtpError(error: unknown): SmtpError {
  return error instanceof SmtpError ? error : new SmtpError('PROTOCOL_ERROR');
}

function failure(error: SmtpError): NotificationResult {
  return {
    success: false,
    failureCode: `SMTP_${error.code}`,
    failureMessage: error.describe(),
    sentAt: new Date(),
  };
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1);
}
