import { Inject, Injectable } from '@nestjs/common';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { maskEmail } from '../identity/identity.utils';
import type { SettingsSecretBox } from './settings-secrets';
import type { SendTestEmailInput, SmtpDraftInput, UpdateSmtpSettingsInput } from './smtp-settings.schemas';
import {
  SETTINGS_SECRET_BOX,
  SMTP_SETTINGS_ID,
  SMTP_TRANSPORT_FACTORY,
  SYSTEM_SETTINGS_DATABASE,
  smtpTransportConfig,
  type SmtpTransport,
  type SmtpTransportFactory,
  type SystemSettingsDatabase,
} from './smtp-transport';

export const SMTP_SETTINGS_AUDIT_ACTION = 'SMTP_SETTINGS_UPDATED';
export const SMTP_TEST_EMAIL_AUDIT_ACTION = 'SMTP_TEST_EMAIL_SENT';

/** Shorter than the delivery timeout so a test answers inside the request deadline. */
const TEST_TIMEOUT_MS = 10_000;

export interface SmtpSettingsDto {
  readonly isEnabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly security: 'SSL_TLS' | 'STARTTLS';
  readonly username: string;
  /** Whether a password is stored. The password itself is never returned. */
  readonly hasPassword: boolean;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly replyTo: string;
  readonly updatedAt: string | null;
  /** False until SETTINGS_ENCRYPTION_KEY is set on the server. */
  readonly encryptionKeyConfigured: boolean;
}

export interface SmtpTestResultDto {
  readonly success: boolean;
  readonly message: string;
  readonly failureCode: string | null;
  readonly durationMs: number;
}

interface SettingsActor {
  readonly staff: AuthenticatedStaff;
  readonly metadata: IdentityActor;
}

const DEFAULTS = {
  isEnabled: false,
  host: '',
  port: 587,
  security: 'STARTTLS' as const,
  username: '',
  passwordEncrypted: null,
  fromAddress: '',
  fromName: '',
  replyTo: null,
  updatedAt: null,
};

/**
 * Admin control of the outbound SMTP account.
 *
 * The password is write-only: it is sealed under SETTINGS_ENCRYPTION_KEY on the
 * way in and only ever opened inside the API to talk to the relay. The audit
 * trail records that it changed, never what it is.
 */
@Injectable()
export class SmtpSettingsService {
  constructor(
    @Inject(SYSTEM_SETTINGS_DATABASE) private readonly database: SystemSettingsDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SETTINGS_SECRET_BOX) private readonly secrets: SettingsSecretBox,
    @Inject(SMTP_TRANSPORT_FACTORY) private readonly createTransport: SmtpTransportFactory,
  ) {}

  async get(): Promise<{ settings: SmtpSettingsDto }> {
    const row = await this.database.smtpSettings.findUnique({ where: { id: SMTP_SETTINGS_ID } });
    return { settings: this.toDto(row ?? DEFAULTS) };
  }

  async update(input: UpdateSmtpSettingsInput, actor: SettingsActor): Promise<{ settings: SmtpSettingsDto }> {
    const current = await this.database.smtpSettings.findUnique({ where: { id: SMTP_SETTINGS_ID } });
    const newPassword = (input.password ?? '') === '' ? null : (input.password as string);

    let passwordEncrypted = current?.passwordEncrypted ?? null;
    if (input.clearPassword) passwordEncrypted = null;
    if (newPassword !== null) passwordEncrypted = this.secrets.seal('smtpPassword', newPassword);

    if (input.isEnabled) {
      const missing: string[] = [];
      if (input.host === '') missing.push('نام سرور');
      if (input.fromAddress === '') missing.push('آدرس فرستنده');
      if (input.username !== '' && passwordEncrypted === null) missing.push('گذرواژه');
      if (missing.length > 0) {
        throw invalid(`برای فعال‌کردن ارسال ایمیل این موارد لازم است: ${missing.join('، ')}.`);
      }
    }

    const data = {
      isEnabled: input.isEnabled,
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.username,
      passwordEncrypted,
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      replyTo: input.replyTo === '' ? null : input.replyTo,
      updatedByStaffId: actor.staff.staffId,
    };
    const updated = await this.database.smtpSettings.upsert({
      where: { id: SMTP_SETTINGS_ID },
      create: { id: SMTP_SETTINGS_ID, ...data },
      update: data,
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: SMTP_SETTINGS_AUDIT_ACTION,
      entity: 'SmtpSettings',
      entityId: SMTP_SETTINGS_ID,
      before: current === null ? null : auditView(current),
      after: {
        ...auditView(updated),
        credentialChanged: newPassword !== null || (input.clearPassword && current?.passwordEncrypted != null),
      },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { settings: this.toDto(updated) };
  }

  /** Connect, negotiate TLS and authenticate with the form's values, without saving them. */
  async testConnection(draft: SmtpDraftInput): Promise<SmtpTestResultDto> {
    const transport = await this.draftTransport(draft);
    const result = await transport.verify();
    return {
      success: result.success,
      message: result.success
        ? result.authenticated
          ? 'اتصال امن برقرار شد و نام کاربری و گذرواژه پذیرفته شد.'
          : 'اتصال امن برقرار شد (بدون احراز هویت).'
        : smtpFailureMessage(result.failureCode ?? null, result.failureMessage ?? null),
      failureCode: result.failureCode ?? null,
      durationMs: result.durationMs,
    };
  }

  /** Send one real message with the form's values, without saving them. */
  async sendTestEmail(input: SendTestEmailInput, actor: SettingsActor): Promise<SmtpTestResultDto> {
    const { to, ...draft } = input;
    const transport = await this.draftTransport(draft);
    const started = Date.now();
    const sentAt = new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date());

    const result = await transport.send({
      to,
      subject: 'ایمیل آزمایشی سنتو',
      text: `این یک ایمیل آزمایشی از پنل مدیریت سنتو است.\nزمان ارسال: ${sentAt}\nاگر این پیام را می‌بینید، تنظیمات SMTP درست کار می‌کند.`,
      html:
        '<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:1.9">' +
        '<p>این یک ایمیل آزمایشی از پنل مدیریت سنتو است.</p>' +
        `<p>زمان ارسال: ${escapeHtml(sentAt)}</p>` +
        '<p>اگر این پیام را می‌بینید، تنظیمات SMTP درست کار می‌کند.</p></div>',
      templateId: 'SMTP_TEST',
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: SMTP_TEST_EMAIL_AUDIT_ACTION,
      entity: 'SmtpSettings',
      entityId: SMTP_SETTINGS_ID,
      after: {
        recipient: maskEmail(to),
        host: draft.host,
        success: result.success,
        /* Not `failureCode`: the audit redactor blanks any key containing "code". */
        failure: result.failureCode ?? null,
      },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return {
      success: result.success,
      message: result.success
        ? `ایمیل آزمایشی به ${to} تحویل سرور SMTP شد. صندوق ورودی و پوشه‌ی هرزنامه را بررسی کنید.`
        : smtpFailureMessage(result.failureCode?.replace(/^SMTP_/u, '') ?? null, result.failureMessage ?? null),
      failureCode: result.failureCode ?? null,
      durationMs: Date.now() - started,
    };
  }

  /* ----------------------------------------------------------------- helpers */

  private async draftTransport(draft: SmtpDraftInput): Promise<SmtpTransport> {
    if (draft.host === '' || draft.fromAddress === '') {
      throw invalid('برای آزمایش، نام سرور و آدرس فرستنده را وارد کنید.');
    }

    let password: string | null = (draft.password ?? '') === '' ? null : (draft.password as string);
    if (password === null && draft.username !== '') {
      /* The form never holds the stored password, so an untouched field means
       * "use the one already saved". */
      const row = await this.database.smtpSettings.findUnique({ where: { id: SMTP_SETTINGS_ID } });
      if (row?.passwordEncrypted == null) throw invalid('گذرواژه‌ی SMTP را وارد کنید.');
      password = this.secrets.open('smtpPassword', row.passwordEncrypted);
    }

    try {
      return this.createTransport({
        ...smtpTransportConfig({ ...draft, replyTo: draft.replyTo === '' ? null : draft.replyTo }, password),
        timeoutMs: TEST_TIMEOUT_MS,
      });
    } catch {
      throw invalid('تنظیمات SMTP کامل یا معتبر نیست.');
    }
  }

  private toDto(row: {
    isEnabled: boolean;
    host: string;
    port: number;
    security: 'SSL_TLS' | 'STARTTLS';
    username: string;
    passwordEncrypted: string | null;
    fromAddress: string;
    fromName: string;
    replyTo: string | null;
    updatedAt: Date | null;
  }): SmtpSettingsDto {
    return {
      isEnabled: row.isEnabled,
      host: row.host,
      port: row.port,
      security: row.security,
      username: row.username,
      hasPassword: row.passwordEncrypted !== null,
      fromAddress: row.fromAddress,
      fromName: row.fromName,
      replyTo: row.replyTo ?? '',
      updatedAt: row.updatedAt === null ? null : row.updatedAt.toISOString(),
      encryptionKeyConfigured: this.secrets.isAvailable,
    };
  }
}

const SMTP_FAILURE_FA: Record<string, string> = {
  CONNECT_FAILED: 'اتصال به سرور SMTP برقرار نشد؛ نام سرور، پورت و دسترسی شبکه را بررسی کنید.',
  TLS_FAILED: 'اتصال امن (TLS) برقرار نشد؛ نوع رمزنگاری یا گواهی سرور را بررسی کنید.',
  STARTTLS_UNSUPPORTED: 'سرور روی این پورت STARTTLS ارائه نمی‌کند؛ حالت SSL/TLS یا پورت دیگری را امتحان کنید.',
  AUTH_UNSUPPORTED: 'سرور هیچ روش احراز هویت پشتیبانی‌شده‌ای (PLAIN یا LOGIN) ارائه نمی‌کند.',
  AUTH_FAILED: 'نام کاربری یا گذرواژه‌ی SMTP پذیرفته نشد.',
  SENDER_REJECTED: 'سرور آدرس فرستنده را نپذیرفت؛ معمولاً باید با نام کاربری یکی باشد.',
  RECIPIENT_REJECTED: 'سرور آدرس گیرنده را نپذیرفت.',
  MESSAGE_REJECTED: 'سرور متن پیام را نپذیرفت.',
  INVALID_MESSAGE: 'آدرس یا سرتیتر پیام معتبر نیست.',
  TIMEOUT: 'سرور SMTP در زمان مجاز پاسخ نداد.',
  CONNECTION_LOST: 'سرور SMTP اتصال را قطع کرد.',
  PROTOCOL_ERROR: 'سرور SMTP پاسخ غیرمنتظره داد.',
};

function smtpFailureMessage(code: string | null, technical: string | null): string {
  const persian = (code === null ? undefined : SMTP_FAILURE_FA[code]) ?? 'ارسال یا اتصال ناموفق بود.';
  return technical === null ? persian : `${persian} — ${technical}`;
}

function auditView(row: {
  isEnabled: boolean;
  host: string;
  port: number;
  security: string;
  username: string;
  passwordEncrypted: string | null;
  fromAddress: string;
  fromName: string;
  replyTo: string | null;
}): Record<string, unknown> {
  return {
    isEnabled: row.isEnabled,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    hasCredential: row.passwordEncrypted !== null,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    replyTo: row.replyTo,
  };
}

function invalid(safeMessage: string): BaratDomainException {
  return new BaratDomainException({ code: 'VALIDATION_ERROR', status: 400, safeMessage });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => `&#${char.charCodeAt(0)};`);
}
