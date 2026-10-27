import type { PrismaClient } from '@barat/database';
import {
  MockEmailProvider,
  SmtpEmailProvider,
  type EmailMessage,
  type EmailProvider,
  type NotificationResult,
  type SmtpEmailProviderConfig,
  type SmtpVerifyResult,
} from '@barat/notifications';

import type { SettingsSecretBox } from './settings-secrets';

export const SYSTEM_SETTINGS_DATABASE = Symbol('SYSTEM_SETTINGS_DATABASE');
export const SETTINGS_SECRET_BOX = Symbol('SETTINGS_SECRET_BOX');
export const SMTP_TRANSPORT_FACTORY = Symbol('SMTP_TRANSPORT_FACTORY');

export type SystemSettingsDatabase = Pick<PrismaClient, 'smtpSettings' | 'backupSettings' | 'backupRun'>;

export const SMTP_SETTINGS_ID = 'default';

/** What the settings code needs from an SMTP client; the real one is `SmtpEmailProvider`. */
export interface SmtpTransport {
  send(message: EmailMessage): Promise<NotificationResult>;
  verify(): Promise<SmtpVerifyResult>;
}

/** Throws on a configuration the client refuses (bad host, missing password, …). */
export type SmtpTransportFactory = (config: SmtpEmailProviderConfig) => SmtpTransport;

export const createSmtpTransport: SmtpTransportFactory = (config) => new SmtpEmailProvider(config);

export interface SmtpConnectionFields {
  readonly host: string;
  readonly port: number;
  readonly security: 'SSL_TLS' | 'STARTTLS';
  readonly username: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly replyTo: string | null;
}

export function smtpTransportConfig(
  fields: SmtpConnectionFields,
  password: string | null,
): SmtpEmailProviderConfig {
  return {
    host: fields.host,
    port: fields.port,
    security: fields.security,
    ...(fields.username === '' ? {} : { username: fields.username }),
    ...(password === null ? {} : { password }),
    fromAddress: fields.fromAddress,
    ...(fields.fromName === '' ? {} : { fromName: fields.fromName }),
    ...(fields.replyTo === null || fields.replyTo === '' ? {} : { replyTo: fields.replyTo }),
  };
}

/**
 * The application's one `EMAIL_PROVIDER`.
 *
 * Reads the SMTP row on every send rather than at boot, so a change saved in
 * the panel applies to the very next login code without a restart; the lookup
 * is one primary-key read on a message that already costs a network round trip.
 *
 * While SMTP is switched off the previous behaviour is kept exactly: the mock
 * transport, which accepts and discards. Once it is switched on there is no
 * silent fallback — a broken configuration is reported as a failed send, so
 * OTP and delivery code see it and say so.
 */
export class ConfiguredEmailProvider implements EmailProvider {
  private lastUsed: string;

  constructor(
    private readonly database: Pick<PrismaClient, 'smtpSettings'>,
    private readonly secrets: SettingsSecretBox,
    private readonly createTransport: SmtpTransportFactory = createSmtpTransport,
    private readonly fallback: EmailProvider = new MockEmailProvider(),
  ) {
    this.lastUsed = fallback.name;
  }

  /** The transport the most recent send went through, for log lines. */
  get name(): string {
    return this.lastUsed;
  }

  async send(message: EmailMessage): Promise<NotificationResult> {
    const row = await this.database.smtpSettings.findUnique({ where: { id: SMTP_SETTINGS_ID } });
    if (row === null || !row.isEnabled) {
      this.lastUsed = this.fallback.name;
      return this.fallback.send(message);
    }

    this.lastUsed = 'smtp';
    let transport: SmtpTransport;
    try {
      const password =
        row.passwordEncrypted === null ? null : this.secrets.open('smtpPassword', row.passwordEncrypted);
      transport = this.createTransport(smtpTransportConfig(row, password));
    } catch {
      /* Missing settings key, a sealed password that no longer opens, or a row
       * the client refuses. Nothing from the error is passed on: it may come
       * from the decryption layer. */
      return {
        success: false,
        failureCode: 'SMTP_NOT_CONFIGURED',
        failureMessage: 'SMTP settings are incomplete or cannot be decrypted',
        sentAt: new Date(),
      };
    }
    return transport.send(message);
  }
}
