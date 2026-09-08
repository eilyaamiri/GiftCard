import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailMessage, type EmailProvider } from '@barat/notifications';

import type {
  AssetDeliveryMessage,
  AssetDeliveryResult,
  AssetDeliveryTransport,
} from '../fulfillment.types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function emailCopy(message: AssetDeliveryMessage): Pick<EmailMessage, 'subject' | 'html' | 'text'> {
  const isPaymentResult = message.purpose === 'INTERNATIONAL_PAYMENT';
  const heading = isPaymentResult ? 'نتیجهٔ پرداخت شما آماده است' : 'سفارش شما آماده است';
  const textParts = [heading];
  const htmlParts = [
    '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.9;color:#18212f">',
    `<h2>${heading}</h2>`,
  ];

  if (message.code !== undefined) {
    textParts.push(`کد: ${message.code}`);
    htmlParts.push(`<p>کد: <strong dir="ltr">${escapeHtml(message.code)}</strong></p>`);
  }
  if (message.pin !== undefined) {
    textParts.push(`پین: ${message.pin}`);
    htmlParts.push(`<p>پین: <strong dir="ltr">${escapeHtml(message.pin)}</strong></p>`);
  }
  if (message.deliveryUrl !== undefined) {
    textParts.push(`لینک نتیجه: ${message.deliveryUrl}`);
    const url = escapeHtml(message.deliveryUrl);
    htmlParts.push(`<p><a href="${url}" dir="ltr">مشاهدهٔ نتیجه</a></p>`);
  }
  if ((message.attachments?.length ?? 0) > 0) {
    textParts.push('تصویر رسید پرداخت به این ایمیل پیوست شده است.');
    htmlParts.push('<p>تصویر رسید پرداخت به این ایمیل پیوست شده است.</p>');
  }

  htmlParts.push('<p>برات‌پی</p>', '</div>');
  return {
    subject: heading,
    html: htmlParts.join(''),
    text: textParts.join('\n'),
  };
}

/**
 * Fulfillment's provider-neutral delivery port backed by the shared e-mail port.
 *
 * The adapter constructs the message in memory and forwards it once. It never
 * logs or retains the code, PIN, redemption URL, or receipt bytes.
 */
@Injectable()
export class EmailAssetDeliveryTransport implements AssetDeliveryTransport {
  readonly name = 'email';

  constructor(@Inject(EMAIL_PROVIDER) private readonly email: EmailProvider) {}

  async send(message: AssetDeliveryMessage): Promise<AssetDeliveryResult> {
    const copy = emailCopy(message);
    const result = await this.email.send({
      to: message.recipientEmail,
      ...copy,
      ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
    });

    if (!result.success) {
      return { success: false, failureCode: result.failureCode ?? 'EMAIL_REJECTED' };
    }
    return {
      success: true,
      ...(result.providerMessageId === undefined
        ? {}
        : { providerMessageId: result.providerMessageId }),
    };
  }
}
