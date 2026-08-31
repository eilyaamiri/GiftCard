export interface SafeNotificationLogger {
  info(record: Readonly<object>, message: string): void;
}

/** Metadata that is safe to retain for a mock delivery attempt. */
export interface SafeDispatchRecord {
  readonly channel: 'SMS' | 'EMAIL';
  readonly providerMessageId: string;
  readonly recipientMasked: string;
  readonly templateId: string | null;
  readonly sentAt: Date;
}

export function maskMobile(value: string): string {
  if (value.length < 7) {
    return '***';
  }
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function maskEmail(value: string): string {
  const separator = value.lastIndexOf('@');
  if (separator <= 0) {
    return '***';
  }

  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}
