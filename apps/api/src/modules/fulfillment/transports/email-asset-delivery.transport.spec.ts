import { describe, expect, it, vi } from 'vitest';
import type {
  EmailMessage,
  EmailProvider,
  NotificationResult,
} from '@barat/notifications';

import { EmailAssetDeliveryTransport } from './email-asset-delivery.transport';

function provider(
  result: Omit<NotificationResult, 'sentAt'> = {
    success: true,
    providerMessageId: 'mail-1',
  },
) {
  const send = vi.fn(async (_message: EmailMessage) => ({ ...result, sentAt: new Date() }));
  return {
    send,
    transport: new EmailAssetDeliveryTransport({ name: 'test-email', send } as EmailProvider),
  };
}

describe('EmailAssetDeliveryTransport', () => {
  it('forwards the customer-safe receipt as a payment-result attachment', async () => {
    const { send, transport } = provider();
    const content = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);

    await expect(
      transport.send({
        orderId: 'order-1',
        recipientEmail: 'buyer@example.com',
        assetType: 'URL',
        purpose: 'INTERNATIONAL_PAYMENT',
        deliveryUrl: 'https://merchant.example/receipt/1',
        attachments: [
          {
            filename: 'payment-receipt.png',
            content,
            contentType: 'image/png',
          },
        ],
      }),
    ).resolves.toEqual({ success: true, providerMessageId: 'mail-1' });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        subject: 'نتیجهٔ پرداخت شما آماده است',
        text: expect.stringContaining('تصویر رسید پرداخت به این ایمیل پیوست شده است.'),
        attachments: [
          {
            filename: 'payment-receipt.png',
            content,
            contentType: 'image/png',
          },
        ],
      }),
    );
  });

  it('keeps payment-result copy when the optional screenshot is absent', async () => {
    const { send, transport } = provider();

    await transport.send({
      orderId: 'order-1',
      recipientEmail: 'buyer@example.com',
      assetType: 'PROVIDER_DIRECT_EMAIL',
      purpose: 'INTERNATIONAL_PAYMENT',
    });

    const message = send.mock.calls[0]?.[0];
    expect(message?.subject).toBe('نتیجهٔ پرداخت شما آماده است');
    expect(message?.text).not.toContain('پیوست شده است');
    expect(message?.attachments).toBeUndefined();
  });

  it('HTML-escapes gift-card secrets before handing them to the provider', async () => {
    const { send, transport } = provider();

    await transport.send({
      orderId: 'order-1',
      recipientEmail: 'buyer@example.com',
      assetType: 'CODE',
      purpose: 'GIFT_CARD',
      code: '<script>alert("x")</script>',
    });

    const message = send.mock.calls[0]?.[0];
    expect(message?.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(message?.html).not.toContain('<script>');
  });

  it('normalizes a provider rejection without returning its message body', async () => {
    const { transport } = provider({ success: false as const, failureCode: 'MAILBOX_REJECTED' });

    await expect(
      transport.send({
        orderId: 'order-1',
        recipientEmail: 'buyer@example.com',
        assetType: 'CODE',
        purpose: 'GIFT_CARD',
        code: 'SECRET-CODE',
      }),
    ).resolves.toEqual({ success: false, failureCode: 'MAILBOX_REJECTED' });
  });
});
