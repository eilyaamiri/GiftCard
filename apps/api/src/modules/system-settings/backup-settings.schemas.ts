import { z } from 'zod';

import { MIN_ARCHIVE_PASSPHRASE_LENGTH } from './backup-archive';
import { parseDailyTime } from './backup-schedule';
import { HOST_PATTERN, isSafeRemoteDirectory, USERNAME_PATTERN } from './backup-transport';

const host = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((value) => value === '' || HOST_PATTERN.test(value), 'نام یا IP سرور پشتیبان معتبر نیست.');
const port = z.number().int().min(1).max(65_535);
const username = z
  .string()
  .trim()
  .max(32)
  .refine((value) => value === '' || USERNAME_PATTERN.test(value), 'نام کاربری SSH معتبر نیست.');
const remoteDirectory = z
  .string()
  .trim()
  .max(200)
  .refine(
    (value) => value === '' || isSafeRemoteDirectory(value),
    'مسیر فقط می‌تواند حروف انگلیسی، عدد، نقطه، خط تیره، زیرخط و / داشته باشد.',
  );
/** Raw lines as pasted or as returned by the scan; parsed and re-checked by the service. */
const hostKeys = z.string().max(8_000);

export const updateBackupSettingsSchema = z
  .object({
    isEnabled: z.boolean(),
    host,
    port,
    username,
    remoteDirectory,
    hostKeys,
    dailyAt: z.string().refine((value) => parseDailyTime(value) !== null, 'ساعت باید به شکل HH:MM باشد.'),
    retentionCount: z.number().int().min(1).max(365),
    /** Absent or empty keeps the stored passphrase. Never returned. */
    archivePassphrase: z
      .string()
      .max(256)
      .refine(
        (value) => value === '' || value.length >= MIN_ARCHIVE_PASSPHRASE_LENGTH,
        `رمز نسخه‌های پشتیبان باید دست‌کم ${MIN_ARCHIVE_PASSPHRASE_LENGTH} نویسه باشد.`,
      )
      .optional(),
    /** An unencrypted OpenSSH private key pasted instead of generating one. Never returned. */
    privateKey: z.string().max(16_000).optional(),
  })
  .strict();
export type UpdateBackupSettingsInput = z.infer<typeof updateBackupSettingsSchema>;

export const scanHostKeysSchema = z.object({ host, port }).strict();
export type ScanHostKeysInput = z.infer<typeof scanHostKeysSchema>;

/** The connection part of the form, tested with the stored private key. */
export const backupConnectionDraftSchema = z
  .object({ host, port, username, remoteDirectory, hostKeys })
  .strict();
export type BackupConnectionDraftInput = z.infer<typeof backupConnectionDraftSchema>;
