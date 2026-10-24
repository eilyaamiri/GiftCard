import { describe, expect, it } from 'vitest';

import {
  buildMimeMessage,
  dotStuff,
  encodeHeaderText,
  InvalidEmailMessageError,
  isDeliverableAddress,
} from './smtp-message';

function decodeEncodedWords(header: string): string {
  return header
    .split(/\r\n /u)
    .map((word) => {
      const match = /^=\?UTF-8\?B\?(.*)\?=$/u.exec(word);
      return match === null ? word : Buffer.from(match[1] ?? '', 'base64').toString('utf8');
    })
    .join('');
}

const BASE = {
  fromAddress: 'no-reply@centohub.com',
  fromName: 'Cento',
  to: 'customer@example.com',
  subject: 'Your code',
  html: '<p>1234</p>',
  messageId: 'abc-123@centohub.com',
  date: new Date('2026-10-21T08:30:00Z'),
};

describe('encodeHeaderText', () => {
  it('leaves printable ASCII alone', () => {
    expect(encodeHeaderText('Order BP-2026-000129')).toBe('Order BP-2026-000129');
  });

  it('encodes Persian as UTF-8 encoded-words that fit the 75-character limit', () => {
    const subject = 'سفارش شما با موفقیت ثبت شد و کد کارت هدیه آماده‌ی تحویل است';
    const encoded = encodeHeaderText(subject);

    for (const word of encoded.split('\r\n ')) {
      expect(word.length).toBeLessThanOrEqual(75);
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/u);
    }
    expect(decodeEncodedWords(encoded)).toBe(subject);
  });

  it('never splits a multi-byte character across two words', () => {
    const subject = '🎁'.repeat(30);
    expect(decodeEncodedWords(encodeHeaderText(subject))).toBe(subject);
  });
});

describe('buildMimeMessage', () => {
  it('renders a single base64 HTML part when there is no text alternative', () => {
    const message = buildMimeMessage(BASE);

    expect(message).toContain('From: "Cento" <no-reply@centohub.com>\r\n');
    expect(message).toContain('Date: Wed, 21 Oct 2026 08:30:00 +0000\r\n');
    expect(message).toContain('Message-ID: <abc-123@centohub.com>\r\n');
    expect(message).toContain('Content-Type: text/html; charset=UTF-8\r\n');
    expect(message).toContain(Buffer.from('<p>1234</p>').toString('base64'));
    expect(message).not.toContain('<p>1234</p>');
  });

  it('wraps text and HTML in multipart/alternative, and that in multipart/mixed with attachments', () => {
    const message = buildMimeMessage({
      ...BASE,
      text: '1234',
      attachments: [{ filename: 'رسید.pdf', content: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' }],
    });

    expect(message).toMatch(/Content-Type: multipart\/mixed; boundary="=_barat_[0-9a-f]{24}"/u);
    expect(message).toMatch(/Content-Type: multipart\/alternative; boundary="=_barat_[0-9a-f]{24}"/u);
    expect(message).toContain("filename*=UTF-8''%D8%B1%D8%B3%DB%8C%D8%AF.pdf");
  });

  it('keeps every body line within 76 characters', () => {
    const message = buildMimeMessage({ ...BASE, html: 'x'.repeat(5_000) });
    const body = message.split('\r\n\r\n')[1] ?? '';
    for (const line of body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  });

  it.each([
    ['subject', { subject: 'hi\r\nBcc: x@example.com' }],
    ['fromName', { fromName: 'Cento\nBcc: x@example.com' }],
    ['to', { to: 'x@example.com\r\nBcc: y@example.com' }],
    ['replyTo', { replyTo: 'not an address' }],
  ])('refuses a line break or bad address in %s', (field, override) => {
    expect(() => buildMimeMessage({ ...BASE, ...override })).toThrow(InvalidEmailMessageError);
    expect(() => buildMimeMessage({ ...BASE, ...override })).toThrow(field);
  });
});

describe('dotStuff', () => {
  it('doubles a leading dot and normalises line endings to CRLF', () => {
    expect(dotStuff('a\n.b\r\n..c\r\n.')).toBe('a\r\n..b\r\n...c\r\n..');
  });
});

describe('isDeliverableAddress', () => {
  it.each(['a@example.com', 'first.last+tag@sub.example.co'])('accepts %s', (address) => {
    expect(isDeliverableAddress(address)).toBe(true);
  });

  it.each(['plain', 'a@b', 'a@example.com>', '<a@example.com', 'a b@example.com', 'علی@example.com'])(
    'rejects %s',
    (address) => {
      expect(isDeliverableAddress(address)).toBe(false);
    },
  );
});
