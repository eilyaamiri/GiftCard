import type { EmailMessage, NotificationResult, SmtpEmailProviderConfig } from '@barat/notifications';
import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { SettingsSecretBox } from './settings-secrets';
import { sendTestEmailSchema, smtpDraftSchema, updateSmtpSettingsSchema } from './smtp-settings.schemas';
import { SmtpSettingsService } from './smtp-settings.service';
import { ConfiguredEmailProvider, type SmtpTransport, type SystemSettingsDatabase } from './smtp-transport';

const ACTOR = {
  staff: { staffId: 'staff-1', role: 'ADMIN' },
  metadata: { ip: '127.0.0.1', userAgent: 'vitest' },
} as never;

const KEY = Buffer.alloc(32, 9);

type Row = Record<string, unknown> & { passwordEncrypted: string | null };

function harness(initial: Row | null = null, key: Buffer | null = KEY) {
  let row: Row | null = initial;
  const record = vi.fn(async (entry: unknown) => {
    void entry;
  });
  const database = {
    smtpSettings: {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(async (args: { create: Row; update: Row }) => {
        row = { ...(row ?? args.create), ...args.update, updatedAt: new Date('2026-10-21T10:00:00Z') };
        return row;
      }),
    },
  } as unknown as SystemSettingsDatabase;

  const configs: SmtpEmailProviderConfig[] = [];
  const sent: EmailMessage[] = [];
  const transport: SmtpTransport = {
    send: vi.fn(async (message: EmailMessage): Promise<NotificationResult> => {
      sent.push(message);
      return { success: true, providerMessageId: 'id@centohub.com', sentAt: new Date() };
    }),
    verify: vi.fn(async () => ({ success: true, authenticated: true, durationMs: 12 })),
  };
  const createTransport = vi.fn((config: SmtpEmailProviderConfig) => {
    configs.push(config);
    return transport;
  });

  const secrets = new SettingsSecretBox(key);
  return {
    secrets,
    record,
    configs,
    sent,
    transport,
    database,
    current: () => row,
    service: new SmtpSettingsService(database, { record } as never, secrets, createTransport),
  };
}

const FORM = {
  isEnabled: true,
  host: 'smtp.example.com',
  port: 587,
  security: 'STARTTLS' as const,
  username: 'no-reply@centohub.com',
  password: 's3cret-smtp-password',
  fromAddress: 'no-reply@centohub.com',
  fromName: 'سنتو',
  replyTo: '',
  clearPassword: false,
};

describe('SmtpSettingsService.update', () => {
  it('seals the password, never returns it, and keeps it out of the audit trail', async () => {
    const { service, current, record, secrets } = harness();

    const { settings } = await service.update(FORM, ACTOR);

    expect(settings).toMatchObject({ isEnabled: true, hasPassword: true, host: 'smtp.example.com' });
    expect(JSON.stringify(settings)).not.toContain('s3cret');
    const stored = current()?.passwordEncrypted as string;
    expect(stored).toMatch(/^v1\./u);
    expect(secrets.open('smtpPassword', stored)).toBe('s3cret-smtp-password');

    const audit = JSON.stringify(record.mock.calls[0]?.[0]);
    expect(audit).not.toContain('s3cret');
    expect(audit).not.toContain(stored);
    expect(audit).toContain('"credentialChanged":true');
  });

  it('keeps the stored password when the field is left empty', async () => {
    const { service, current } = harness();
    await service.update(FORM, ACTOR);
    const first = current()?.passwordEncrypted;

    await service.update({ ...FORM, password: '', fromName: 'Cento' }, ACTOR);

    expect(current()?.passwordEncrypted).toBe(first);
    expect(current()?.fromName).toBe('Cento');
  });

  it('can clear the password for a relay without AUTH', async () => {
    const { service } = harness();
    await service.update(FORM, ACTOR);

    const { settings } = await service.update({ ...FORM, username: '', password: '', clearPassword: true }, ACTOR);

    expect(settings.hasPassword).toBe(false);
  });

  it('refuses to switch on without a host, a sender, or a password for the username', async () => {
    const { service } = harness();

    await expect(service.update({ ...FORM, host: '' }, ACTOR)).rejects.toBeInstanceOf(BaratDomainException);
    await expect(service.update({ ...FORM, fromAddress: '' }, ACTOR)).rejects.toBeInstanceOf(BaratDomainException);
    await expect(service.update({ ...FORM, password: '' }, ACTOR)).rejects.toThrow();
  });

  it('allows saving an incomplete form while switched off', async () => {
    const { service } = harness();

    const { settings } = await service.update({ ...FORM, isEnabled: false, host: '', password: '' }, ACTOR);

    expect(settings.isEnabled).toBe(false);
  });

  it('refuses to store a password when SETTINGS_ENCRYPTION_KEY is not set', async () => {
    const { service } = harness(null, null);

    await expect(service.update(FORM, ACTOR)).rejects.toMatchObject({
      safeMessage: expect.stringContaining('SETTINGS_ENCRYPTION_KEY'),
    });
  });
});

describe('SmtpSettingsService tests', () => {
  it('tests the unsaved form, falling back to the stored password', async () => {
    const { service, configs } = harness();
    await service.update(FORM, ACTOR);

    const result = await service.testConnection({ ...FORM, host: 'smtp2.example.com', password: '' });

    expect(result.success).toBe(true);
    expect(configs.at(-1)).toMatchObject({
      host: 'smtp2.example.com',
      password: 's3cret-smtp-password',
      timeoutMs: 10_000,
    });
  });

  it('sends a test e-mail and audits only the masked recipient', async () => {
    const { service, sent, record } = harness();

    const result = await service.sendTestEmail({ ...FORM, to: 'admin@example.com' }, ACTOR);

    expect(result.success).toBe(true);
    expect(sent[0]).toMatchObject({ to: 'admin@example.com', subject: 'ایمیل آزمایشی سنتو' });
    const audit = record.mock.calls[0]?.[0] as { action: string; after: Record<string, unknown> };
    expect(audit.action).toBe('SMTP_TEST_EMAIL_SENT');
    expect(audit.after['recipient']).toBe('a***@example.com');
  });

  it('turns a provider failure into a Persian message with the technical reason', async () => {
    const { service, transport } = harness();
    vi.mocked(transport.verify).mockResolvedValueOnce({
      success: false,
      failureCode: 'AUTH_FAILED',
      failureMessage: 'The SMTP server rejected the username or password (SMTP 535)',
      authenticated: true,
      durationMs: 40,
    });

    const result = await service.testConnection(FORM);

    expect(result).toMatchObject({ success: false, failureCode: 'AUTH_FAILED' });
    expect(result.message).toContain('گذرواژه');
    expect(result.message).toContain('535');
  });
});

describe('ConfiguredEmailProvider', () => {
  const message = { to: 'customer@example.com', subject: 'کد ورود', html: '<p>1</p>' };

  it('keeps the mock transport while SMTP is switched off', async () => {
    const { database, secrets } = harness({ ...FORM, isEnabled: false, passwordEncrypted: null });
    const createTransport = vi.fn();
    const provider = new ConfiguredEmailProvider(database, secrets, createTransport);

    const result = await provider.send(message);

    expect(result.success).toBe(true);
    expect(provider.name).toBe('mock-email');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends through SMTP with the decrypted password once switched on', async () => {
    const { service, database, secrets, configs, sent } = harness();
    await service.update(FORM, ACTOR);
    const provider = new ConfiguredEmailProvider(database, secrets, (config) => {
      configs.push(config);
      return { send: async (m) => (sent.push(m), { success: true, sentAt: new Date() }), verify: vi.fn() };
    });

    const result = await provider.send(message);

    expect(result.success).toBe(true);
    expect(provider.name).toBe('smtp');
    expect(configs.at(-1)).toMatchObject({ host: 'smtp.example.com', password: 's3cret-smtp-password' });
    expect(sent.at(-1)).toEqual(message);
  });

  it('fails loudly, never silently mocks, when switched on but the key is gone', async () => {
    const { service, database } = harness();
    await service.update(FORM, ACTOR);
    const provider = new ConfiguredEmailProvider(database, new SettingsSecretBox(null));

    const result = await provider.send(message);

    expect(result).toMatchObject({ success: false, failureCode: 'SMTP_NOT_CONFIGURED' });
  });
});

describe('SMTP schemas', () => {
  it('accepts the panel form', () => {
    expect(updateSmtpSettingsSchema.parse(FORM)).toMatchObject({ host: 'smtp.example.com', port: 587 });
  });

  it.each([5432, 6379, 4000, 22, 80])('refuses port %i, which is not an SMTP port', (port) => {
    const { isEnabled: _e, clearPassword: _c, ...draft } = FORM;
    expect(smtpDraftSchema.safeParse({ ...draft, port }).success).toBe(false);
    expect(smtpDraftSchema.safeParse({ ...draft, port: 465 }).success).toBe(true);
  });

  it.each(['smtp.example.com\r\nRCPT', '-oProxy', 'smtp example.com', 'http://smtp.example.com'])(
    'refuses host %j',
    (host) => {
      expect(updateSmtpSettingsSchema.safeParse({ ...FORM, host }).success).toBe(false);
    },
  );

  it('refuses a test recipient that is not a plain address', () => {
    const { isEnabled: _e, clearPassword: _c, ...draft } = FORM;
    expect(sendTestEmailSchema.safeParse({ ...draft, to: 'a@example.com\r\nBcc: b@example.com' }).success).toBe(
      false,
    );
  });
});
