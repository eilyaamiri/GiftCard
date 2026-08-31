import { randomUUID } from 'node:crypto';

import type { NotificationResult, SmsMessage, SmsProvider } from '../index';
import {
  maskMobile,
  type SafeDispatchRecord,
  type SafeNotificationLogger,
} from './safe-dispatch-record';

/**
 * Transport-free SMS provider for local development and tests.
 *
 * It deliberately records only masked metadata. `body` and `templateParams` are
 * accepted for interface compatibility and immediately discarded; this remains
 * true outside production too, so an OTP can never leak into a developer log.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock-sms';
  readonly dispatches: SafeDispatchRecord[] = [];

  constructor(private readonly logger?: SafeNotificationLogger) {}

  async send(message: SmsMessage): Promise<NotificationResult> {
    const sentAt = new Date();
    const providerMessageId = `mock-sms-${randomUUID()}`;
    const record: SafeDispatchRecord = {
      channel: 'SMS',
      providerMessageId,
      recipientMasked: maskMobile(message.to),
      templateId: message.templateId ?? null,
      sentAt,
    };

    this.dispatches.push(record);
    this.logger?.info(record, 'Mock SMS accepted');

    return { success: true, providerMessageId, sentAt };
  }
}
