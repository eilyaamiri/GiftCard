import { BaratDomainException } from '../../common/errors/domain.exception';
import { open, seal } from '../../common/crypto/aead-envelope';

/**
 * One AAD per secret, so an envelope copied from one column into another fails
 * authentication instead of decrypting into a plausible value.
 */
export const SETTINGS_SECRET_AAD = {
  smtpPassword: 'barat/settings/smtp-password/v1',
  backupPrivateKey: 'barat/settings/backup-ssh-private-key/v1',
  backupArchivePassphrase: 'barat/settings/backup-archive-passphrase/v1',
} as const;

export type SettingsSecretKind = keyof typeof SETTINGS_SECRET_AAD;

/**
 * Seals and opens the secrets typed into the admin settings, under
 * SETTINGS_ENCRYPTION_KEY.
 *
 * When the key is not configured nothing can be stored or read, and the panel
 * says so. There is no fallback to another key on purpose: a fallback is how a
 * low-value secret (an SMTP password) ends up sharing a key with gift-card codes.
 */
export class SettingsSecretBox {
  constructor(private readonly key: Buffer | null) {}

  get isAvailable(): boolean {
    return this.key !== null;
  }

  seal(kind: SettingsSecretKind, plaintext: string): string {
    return seal(plaintext, this.requireKey(), SETTINGS_SECRET_AAD[kind]);
  }

  open(kind: SettingsSecretKind, envelope: string): string {
    return open(envelope, this.requireKey(), SETTINGS_SECRET_AAD[kind]);
  }

  private requireKey(): Buffer {
    if (this.key === null) {
      throw new BaratDomainException({
        code: 'CONFLICT',
        status: 409,
        safeMessage:
          'کلید رمزنگاری تنظیمات (SETTINGS_ENCRYPTION_KEY) روی سرور تنظیم نشده است؛ ' +
          'تا آن تنظیم نشود هیچ رمز یا کلیدی ذخیره نمی‌شود.',
        internalDetail: 'SETTINGS_ENCRYPTION_KEY is not configured',
      });
    }
    return this.key;
  }
}
