import { isDeliverableAddress } from '@barat/notifications';
import { z } from 'zod';

import { HOST_PATTERN } from './backup-transport';

/**
 * The ports an SMTP relay actually listens on. A closed list on purpose: the
 * test buttons make the API open a connection to whatever an admin types, and
 * this keeps them from being used to probe the server's own internal services
 * (Postgres on 5432, Redis on 6379, the API itself).
 */
export const SMTP_PORTS = [25, 465, 587, 2465, 2525, 2587] as const;

const optionalAddress = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === '' || isDeliverableAddress(value), 'آدرس ایمیل معتبر نیست.');

const smtpConnectionFields = {
  host: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .refine((value) => value === '' || HOST_PATTERN.test(value), 'نام سرور SMTP معتبر نیست.'),
  port: z
    .number()
    .int()
    .refine((value) => (SMTP_PORTS as readonly number[]).includes(value), 'این پورت برای SMTP مجاز نیست.'),
  security: z.enum(['SSL_TLS', 'STARTTLS']),
  username: z
    .string()
    .trim()
    .max(254)
    .refine((value) => !/[\s\p{Cc}]/u.test(value), 'نام کاربری نباید فاصله داشته باشد.'),
  /**
   * Absent or empty: keep the stored password. Anything else replaces it. The
   * stored value is never sent back, so an untouched form always submits empty.
   */
  password: z.string().max(512).optional(),
  fromAddress: optionalAddress,
  fromName: z
    .string()
    .trim()
    .max(80)
    .refine((value) => !/[\r\n]/u.test(value), 'نام فرستنده نباید چند خطی باشد.'),
  replyTo: optionalAddress,
};

export const updateSmtpSettingsSchema = z
  .object({
    isEnabled: z.boolean(),
    ...smtpConnectionFields,
    /** Remove the stored password, e.g. for a relay that needs no AUTH. */
    clearPassword: z.boolean().default(false),
  })
  .strict();
export type UpdateSmtpSettingsInput = z.infer<typeof updateSmtpSettingsSchema>;

/** The form as it stands, possibly unsaved. Tested without being stored. */
export const smtpDraftSchema = z.object(smtpConnectionFields).strict();
export type SmtpDraftInput = z.infer<typeof smtpDraftSchema>;

export const sendTestEmailSchema = z
  .object({
    ...smtpConnectionFields,
    to: z.string().trim().max(254).refine(isDeliverableAddress, 'آدرس گیرنده معتبر نیست.'),
  })
  .strict();
export type SendTestEmailInput = z.infer<typeof sendTestEmailSchema>;
