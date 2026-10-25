import { randomBytes } from 'node:crypto';

import type { EmailAttachment } from '../index';

/**
 * RFC 5322 / MIME rendering for the SMTP adapter.
 *
 * Every body part is base64, so the wire stays 7-bit whatever the language of
 * the content and no server ever has to support 8BITMIME or SMTPUTF8. Header
 * values that are not plain ASCII become RFC 2047 encoded-words.
 *
 * Nothing here logs. The rendered message contains the body, which may hold a
 * login code or a gift-card secret.
 */

const CRLF = '\r\n';
const BASE64_LINE = 76;
/* 45 bytes of UTF-8 become 60 base64 characters; with `=?UTF-8?B?` and `?=`
 * that is 72, inside the 75-character limit RFC 2047 sets for one word. */
const ENCODED_WORD_BYTES = 45;

const ADDRESS_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u;
const CONTENT_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u;

/**
 * An ASCII mailbox we are willing to put in an envelope or a header.
 *
 * Deliberately narrower than RFC 5321: no quoted local parts, no IP literals,
 * no internationalised addresses. Anything with a CR, LF, `<` or `>` is out,
 * which is what keeps a recipient from smuggling in an extra SMTP command or
 * header.
 */
export function isDeliverableAddress(value: string): boolean {
  return value.length <= 254 && ADDRESS_PATTERN.test(value);
}

export class InvalidEmailMessageError extends Error {
  constructor(readonly field: string) {
    super(`E-mail ${field} is not acceptable`);
    this.name = 'InvalidEmailMessageError';
  }
}

export interface MimeMessageInput {
  readonly fromAddress: string;
  readonly fromName?: string;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly attachments?: readonly EmailAttachment[];
  /** Without angle brackets, e.g. `0b6c…@centohub.com`. */
  readonly messageId: string;
  readonly date: Date;
}

/** The full message, CRLF line endings, not yet dot-stuffed for DATA. */
export function buildMimeMessage(input: MimeMessageInput): string {
  if (!isDeliverableAddress(input.fromAddress)) throw new InvalidEmailMessageError('from');
  if (!isDeliverableAddress(input.to)) throw new InvalidEmailMessageError('to');
  if (input.replyTo !== undefined && !isDeliverableAddress(input.replyTo)) {
    throw new InvalidEmailMessageError('replyTo');
  }
  if (hasLineBreak(input.subject)) throw new InvalidEmailMessageError('subject');
  if (input.fromName !== undefined && hasLineBreak(input.fromName)) {
    throw new InvalidEmailMessageError('fromName');
  }
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/u.test(input.messageId)) {
    throw new InvalidEmailMessageError('messageId');
  }

  const headers = [
    `From: ${formatMailbox(input.fromAddress, input.fromName)}`,
    `To: ${input.to}`,
    ...(input.replyTo === undefined ? [] : [`Reply-To: ${input.replyTo}`]),
    `Subject: ${encodeHeaderText(input.subject)}`,
    `Date: ${formatDate(input.date)}`,
    `Message-ID: <${input.messageId}>`,
    'MIME-Version: 1.0',
  ];

  const body = renderBody(input);
  return [...headers, ...body.headers].join(CRLF) + CRLF + CRLF + body.content;
}

/**
 * DATA transparency (RFC 5321 4.5.2): a line that starts with a dot gets a
 * second one, and every line ending becomes CRLF.
 */
export function dotStuff(message: string): string {
  return message
    .replace(/\r?\n/gu, CRLF)
    .split(CRLF)
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join(CRLF);
}

/** A header value as-is when it is printable ASCII, otherwise encoded-words. */
export function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  return encodedWords(value).join(`${CRLF} `);
}

/* ------------------------------------------------------------------ helpers */

interface RenderedPart {
  readonly headers: readonly string[];
  readonly content: string;
}

function renderBody(input: MimeMessageInput): RenderedPart {
  const html = textPart('text/html', input.html);
  const readable =
    input.text === undefined ? html : multipart('alternative', [textPart('text/plain', input.text), html]);

  const attachments = input.attachments ?? [];
  if (attachments.length === 0) return readable;
  return multipart('mixed', [readable, ...attachments.map(attachmentPart)]);
}

function textPart(contentType: 'text/plain' | 'text/html', content: string): RenderedPart {
  return {
    headers: [`Content-Type: ${contentType}; charset=UTF-8`, 'Content-Transfer-Encoding: base64'],
    content: wrapBase64(Buffer.from(content, 'utf8')),
  };
}

function attachmentPart(attachment: EmailAttachment): RenderedPart {
  if (!CONTENT_TYPE_PATTERN.test(attachment.contentType)) {
    throw new InvalidEmailMessageError('attachment content type');
  }
  if (attachment.filename === '' || hasLineBreak(attachment.filename)) {
    throw new InvalidEmailMessageError('attachment filename');
  }
  const asciiName = /^[A-Za-z0-9 ._()-]+$/u.test(attachment.filename);
  const disposition = asciiName
    ? `attachment; filename="${attachment.filename}"`
    : `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`;
  return {
    headers: [
      `Content-Type: ${attachment.contentType}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: ${disposition}`,
    ],
    content: wrapBase64(Buffer.from(attachment.content)),
  };
}

function multipart(subtype: 'alternative' | 'mixed', parts: readonly RenderedPart[]): RenderedPart {
  /* Base64 bodies and our own headers can never contain `=_` followed by this
   * random run, so the boundary cannot collide with content. */
  const boundary = `=_barat_${randomBytes(12).toString('hex')}`;
  const sections = parts.map(
    (part) => `--${boundary}${CRLF}${part.headers.join(CRLF)}${CRLF}${CRLF}${part.content}${CRLF}`,
  );
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`],
    content: `${sections.join('')}--${boundary}--`,
  };
}

function formatMailbox(address: string, name: string | undefined): string {
  if (name === undefined || name.trim() === '') return address;
  if (/^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~.-]+$/u.test(name)) {
    return `"${name}" <${address}>`;
  }
  return `${encodedWords(name).join(' ')} <${address}>`;
}

function encodedWords(value: string): string[] {
  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, 'utf8') > ENCODED_WORD_BYTES) {
      words.push(encodedWord(chunk));
      chunk = '';
    }
    chunk += char;
  }
  if (chunk !== '' || words.length === 0) words.push(encodedWord(chunk));
  return words;
}

function encodedWord(chunk: string): string {
  return `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`;
}

function wrapBase64(content: Buffer): string {
  const encoded = content.toString('base64');
  const lines: string[] = [];
  for (let index = 0; index < encoded.length; index += BASE64_LINE) {
    lines.push(encoded.slice(index, index + BASE64_LINE));
  }
  return lines.join(CRLF);
}

function formatDate(date: Date): string {
  /* `toUTCString` is the RFC 7231 form, which is RFC 5322 apart from the
   * obsolete `GMT` zone name. */
  return date.toUTCString().replace(/GMT$/u, '+0000');
}

function hasLineBreak(value: string): boolean {
  return /[\r\n]/u.test(value);
}
