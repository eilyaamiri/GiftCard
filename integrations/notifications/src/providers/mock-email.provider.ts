import { randomUUID } from 'node:crypto';

import type { EmailMessage, EmailProvider, NotificationResult } from '../index';
import {
  maskEmail,
  type SafeDispatchRecord,
  type SafeNotificationLogger,
} from './safe-dispatch-record';

/**
 * Transport-free e-mail provider for local development and tests.
 * Message subject/body/template parameters/attachments are never retained.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock-email';
  readonly dispatches: SafeDispatchRecord[] = [];

  constructor(private readonly logger?: SafeNotificationLogger) {}

  async send(message: EmailMessage): Promise<NotificationResult> {
    const sentAt = new Date();
    const providerMessageId = `mock-email-${randomUUID()}`;
    const record: SafeDispatchRecord = {
      channel: 'EMAIL',
      providerMessageId,
      recipientMasked: maskEmail(message.to),
      templateId: message.templateId ?? null,
      sentAt,
    };

    this.dispatches.push(record);
    this.logger?.info(record, 'Mock e-mail accepted');

    return { success: true, providerMessageId, sentAt };
  }
}
