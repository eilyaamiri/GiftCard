import { z } from 'zod';

import { DomainErrors } from '../../common/errors/domain.exception';

/**
 * The contact routes the storefront may offer.
 *
 * Mirrors the `SupportChannelKind` enum in the Prisma schema. It is repeated
 * here rather than imported from the generated client so that the request
 * schema rejects an unknown kind before it ever reaches the database.
 */
export const supportChannelKinds = ['PHONE', 'TELEGRAM', 'WHATSAPP', 'TICKET'] as const;
export const supportChannelKindSchema = z.enum(supportChannelKinds);
export type SupportChannelKind = (typeof supportChannelKinds)[number];

export const supportChannelParamSchema = z.object({ kind: supportChannelKindSchema }).strict();
export type SupportChannelParam = z.infer<typeof supportChannelParamSchema>;

/** Persian and Arabic-Indic digits, in the order of their ASCII counterparts. */
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Fold non-ASCII digits and drop the separators people type inside numbers.
 *
 * An admin filling in a support line on a Persian keyboard produces `۰۲۱ ۹۱۰۰
 * ۱۲۳۴`; a `tel:` link built from that string does nothing on a phone.
 */
function asciiDigits(input: string): string {
  let result = '';
  for (const char of input) {
    const persian = PERSIAN_DIGITS.indexOf(char);
    if (persian >= 0) {
      result += String(persian);
      continue;
    }
    const arabic = ARABIC_DIGITS.indexOf(char);
    if (arabic >= 0) {
      result += String(arabic);
      continue;
    }
    if (/[\s\-().‌]/u.test(char)) continue;
    result += char;
  }
  return result;
}

const PHONE_RE = /^\+?\d{4,15}$/u;
const TELEGRAM_USERNAME_RE = /^[A-Za-z0-9_]{5,32}$/u;
const TELEGRAM_INVITE_RE = /^\+[A-Za-z0-9_-]{5,64}$/u;
const WHATSAPP_RE = /^\d{8,15}$/u;
const TICKET_ROUTE_RE = /^\/[A-Za-z0-9\-._~/]*$/u;

function invalid(message: string): never {
  throw DomainErrors.validation([{ path: 'value', message }]);
}

/**
 * Reduce whatever an admin pasted into the single canonical form we store.
 *
 * The panel accepts the shapes people actually have to hand — a Telegram
 * `@handle`, a copied `t.me` URL, a WhatsApp number with or without a country
 * code prefix — and this collapses them so that `supportChannelHref` has one
 * shape to build a link from. Anything it cannot recognise is rejected rather
 * than guessed: a wrong-but-plausible link sends customers to a stranger.
 *
 * An empty string is allowed through unchanged. It means "not configured yet",
 * and a channel in that state is never shown to a customer.
 */
export function normalizeSupportChannelValue(kind: SupportChannelKind, raw: string): string {
  const value = raw.trim();
  if (value === '') return '';

  switch (kind) {
    case 'PHONE': {
      const digits = asciiDigits(value);
      if (!PHONE_RE.test(digits)) {
        invalid('شمارهٔ تماس معتبر نیست. مثال: ۰۲۱۹۱۰۰۱۲۳۴');
      }
      return digits;
    }
    case 'TELEGRAM': {
      const handle = stripTelegramPrefix(value);
      if (!TELEGRAM_USERNAME_RE.test(handle) && !TELEGRAM_INVITE_RE.test(handle)) {
        invalid('شناسهٔ تلگرام معتبر نیست. مثال: @baratpay یا https://t.me/baratpay');
      }
      return `https://t.me/${handle}`;
    }
    case 'WHATSAPP': {
      const digits = asciiDigits(stripWhatsappPrefix(value)).replace(/^\+/u, '');
      if (!WHATSAPP_RE.test(digits)) {
        invalid('شمارهٔ واتساپ باید با کد کشور و بدون صفر ابتدایی باشد. مثال: ۹۸۹۱۲۱۲۳۴۵۶۷');
      }
      return digits;
    }
    case 'TICKET': {
      /* Only an internal route. An absolute URL here would turn an admin field
       * into an open redirect on every page of the storefront, and `//host` is
       * an absolute URL that merely looks relative. */
      if (value.startsWith('//') || !TICKET_ROUTE_RE.test(value)) {
        invalid('مسیر ثبت تیکت باید یک مسیر داخلی باشد. مثال: /account/support');
      }
      return value;
    }
  }
}

function stripTelegramPrefix(value: string): string {
  const withoutScheme = value.replace(/^https?:\/\//iu, '').replace(/^www\./iu, '');
  const withoutHost = withoutScheme.replace(/^(?:t\.me|telegram\.me)\//iu, '');
  return withoutHost.replace(/^@/u, '').replace(/\/+$/u, '');
}

function stripWhatsappPrefix(value: string): string {
  const withoutScheme = value.replace(/^https?:\/\//iu, '').replace(/^www\./iu, '');
  return withoutScheme.replace(/^(?:wa\.me|api\.whatsapp\.com\/send\?phone=)/iu, '').replace(/^\/+|\/+$/gu, '');
}

/**
 * The link the storefront renders, built from the stored value.
 *
 * Deriving it here rather than in the browser keeps link assembly on the server,
 * where the value has already been validated, and means the storefront never has
 * to know that WhatsApp lives at `wa.me`.
 */
export function supportChannelHref(kind: SupportChannelKind, value: string): string | null {
  if (value === '') return null;
  switch (kind) {
    case 'PHONE':
      return `tel:${value}`;
    case 'TELEGRAM':
      return value;
    case 'WHATSAPP':
      return `https://wa.me/${value}`;
    case 'TICKET':
      return value;
  }
}

/** External channels open in a new tab; an internal route must not. */
export function isExternalSupportChannel(kind: SupportChannelKind): boolean {
  return kind === 'TELEGRAM' || kind === 'WHATSAPP';
}

export const updateSupportChannelSchema = z
  .object({
    isEnabled: z.boolean(),
    title: z.string().trim().min(2, 'عنوان را وارد کنید.').max(60, 'عنوان نباید بیشتر از ۶۰ نویسه باشد.'),
    description: z.string().trim().max(160, 'توضیح نباید بیشتر از ۱۶۰ نویسه باشد.'),
    value: z.string().trim().max(200, 'مقدار نباید بیشتر از ۲۰۰ نویسه باشد.'),
    sortOrder: z.number().int().min(0).max(99),
  })
  .strict()
  .superRefine((input, ctx) => {
    /* A channel cannot be switched on with nothing to reach: the storefront
     * would render a dead row, which is exactly what the brief forbids. */
    if (input.isEnabled && input.value.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'برای فعال‌کردن این کانال باید مقدار آن را وارد کنید.',
      });
    }
  });
export type UpdateSupportChannelInput = z.infer<typeof updateSupportChannelSchema>;
