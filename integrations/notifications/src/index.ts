/**
 * @barat/notifications — provider-neutral SMS and e-mail contracts.
 *
 * Message bodies can contain one-time passwords or fulfillment secrets. Provider
 * implementations must pass those values to the transport without ever logging
 * or persisting them.
 */

/** Outcome of one send attempt. */
export interface NotificationResult {
  readonly success: boolean;
  /** Provider-side message id, safe for delivery reconciliation. */
  readonly providerMessageId?: string;
  readonly failureCode?: string;
  /** Normalised message; never a raw provider response or message content. */
  readonly failureMessage?: string;
  readonly sentAt: Date;
}

/* ========================================================================== SMS */

export interface SmsMessage {
  /** Canonical Iranian mobile, `+989xxxxxxxxx`. */
  readonly to: string;
  /** May contain an OTP or another secret. Never log or persist it. */
  readonly body: string;
  readonly templateId?: string;
  /** May contain an OTP. Never log or persist this object. */
  readonly templateParams?: Readonly<Record<string, string>>;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<NotificationResult>;
}

/* ======================================================================== E-mail */

export interface EmailAttachment {
  readonly filename: string;
  readonly content: Uint8Array;
  readonly contentType: string;
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** May contain an OTP or gift-card secret. Never log or persist it. */
  readonly html: string;
  readonly text?: string;
  readonly templateId?: string;
  readonly templateParams?: Readonly<Record<string, string>>;
  readonly attachments?: readonly EmailAttachment[];
  readonly replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<NotificationResult>;
}

export class NotificationProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NotificationProviderError';
  }
}

/** Dependency-injection tokens used by applications. */
export const SMS_PROVIDER = 'BARAT_SMS_PROVIDER';
export const EMAIL_PROVIDER = 'BARAT_EMAIL_PROVIDER';

export * from './providers/mock-email.provider';
export * from './providers/mock-sms.provider';
export * from './providers/safe-dispatch-record';
