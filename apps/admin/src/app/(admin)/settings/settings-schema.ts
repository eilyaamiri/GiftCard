import { z } from "zod";
import {
  featureFlagKeySchema,
  isoDateTimeSchema,
  queueKeySchema,
  staffRoleSchema,
} from "@barat/contracts";

export const settingsQueueSummarySchema = z.object({
  id: z.string().min(1),
  key: queueKeySchema,
  name: z.string(),
});

export const settingsStaffSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  fullName: z.string(),
  role: staffRoleSchema,
  isActive: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  queues: z.array(settingsQueueSummarySchema),
});
export type SettingsStaff = z.infer<typeof settingsStaffSchema>;

export const settingsStaffListSchema = z.object({ items: z.array(settingsStaffSchema) });
export const settingsStaffMutationSchema = z.object({ staff: settingsStaffSchema });
export const settingsStaffDeleteSchema = z.object({
  deleted: z.literal(true),
  id: z.string().min(1),
});

export const settingsFeatureFlagSchema = z.object({
  id: z.string().min(1),
  key: featureFlagKeySchema,
  isEnabled: z.boolean(),
  description: z.string().nullable(),
  rolloutBps: z.number().int().min(0).max(10_000),
  updatedAt: isoDateTimeSchema,
});
export type SettingsFeatureFlag = z.infer<typeof settingsFeatureFlagSchema>;

export const settingsFeatureFlagListSchema = z.object({
  items: z.array(settingsFeatureFlagSchema),
});
export const settingsFeatureFlagMutationSchema = z.object({
  flag: settingsFeatureFlagSchema,
});

export const settingsQueueMemberSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  fullName: z.string(),
  role: staffRoleSchema,
  isActive: z.boolean(),
  canAssign: z.boolean(),
});

export const settingsQueueSchema = z.object({
  id: z.string().min(1),
  key: queueKeySchema,
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  slaMinutes: z.number().int().nullable(),
  workItemCount: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
  members: z.array(settingsQueueMemberSchema),
});
export type SettingsQueue = z.infer<typeof settingsQueueSchema>;

export const settingsQueueListSchema = z.object({ items: z.array(settingsQueueSchema) });
export const settingsQueueMutationSchema = z.object({ queue: settingsQueueSchema });

export const SUPPORT_CHANNEL_KINDS = ["PHONE", "TELEGRAM", "WHATSAPP", "TICKET"] as const;

/**
 * A contact route as the API stores it.
 *
 * `value` is the raw destination — a phone number, a normalised `t.me` URL, an
 * internal route. The panel edits it in that form and the API normalises and
 * validates it per kind, so what comes back may differ from what was typed.
 */
export const settingsSupportChannelSchema = z.object({
  kind: z.enum(SUPPORT_CHANNEL_KINDS),
  isEnabled: z.boolean(),
  title: z.string(),
  description: z.string(),
  value: z.string(),
  sortOrder: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
});
export type SettingsSupportChannel = z.infer<typeof settingsSupportChannelSchema>;

export const settingsSupportChannelListSchema = z.object({
  items: z.array(settingsSupportChannelSchema),
});
export const settingsSupportChannelMutationSchema = z.object({
  channel: settingsSupportChannelSchema,
});

export const settingsFaqSchema = z.object({
  id: z.string().min(1),
  question: z.string(),
  answer: z.string(),
  isEnabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
});
export type SettingsFaq = z.infer<typeof settingsFaqSchema>;

export const settingsFaqListSchema = z.object({ items: z.array(settingsFaqSchema) });
export const settingsFaqMutationSchema = z.object({ faq: settingsFaqSchema });
export const settingsFaqDeleteSchema = z.object({ id: z.string().min(1) });

export const SETTINGS_REASON_MIN_LENGTH = 8;

/* ---------------------------------------------------------------- SMTP */

export const SMTP_SECURITY_MODES = ["STARTTLS", "SSL_TLS"] as const;
/** Mirrors the API's allow-list; the API refuses any other port. */
export const SMTP_PORTS = [587, 465, 25, 2525, 2587, 2465] as const;

/** The password is write-only: the API reports whether one is stored, never what it is. */
export const settingsSmtpSchema = z.object({
  isEnabled: z.boolean(),
  host: z.string(),
  port: z.number().int(),
  security: z.enum(SMTP_SECURITY_MODES),
  username: z.string(),
  hasPassword: z.boolean(),
  fromAddress: z.string(),
  fromName: z.string(),
  replyTo: z.string(),
  updatedAt: isoDateTimeSchema.nullable(),
  encryptionKeyConfigured: z.boolean(),
});
export type SettingsSmtp = z.infer<typeof settingsSmtpSchema>;

export const settingsSmtpResponseSchema = z.object({ settings: settingsSmtpSchema });

export const settingsTestResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  failureCode: z.string().nullable().optional(),
  durationMs: z.number(),
});
export type SettingsTestResult = z.infer<typeof settingsTestResultSchema>;

/* -------------------------------------------------------------- backup */

/** The SSH key and the archive passphrase are write-only, like the SMTP password. */
export const settingsBackupSchema = z.object({
  isEnabled: z.boolean(),
  host: z.string(),
  port: z.number().int(),
  username: z.string(),
  remoteDirectory: z.string(),
  hostKeys: z.string(),
  hostKeyFingerprints: z.array(z.object({ type: z.string(), fingerprint: z.string() })),
  hasPrivateKey: z.boolean(),
  publicKey: z.string().nullable(),
  hasArchivePassphrase: z.boolean(),
  dailyAt: z.string(),
  retentionCount: z.number().int(),
  updatedAt: isoDateTimeSchema.nullable(),
  encryptionKeyConfigured: z.boolean(),
  sourceDirectory: z.string(),
});
export type SettingsBackup = z.infer<typeof settingsBackupSchema>;

export const settingsLocalSnapshotSchema = z.object({
  name: z.string(),
  createdAt: isoDateTimeSchema,
  sizeBytes: z.number(),
});
export type SettingsLocalSnapshot = z.infer<typeof settingsLocalSnapshotSchema>;

export const settingsBackupResponseSchema = z.object({
  settings: settingsBackupSchema,
  localSnapshot: settingsLocalSnapshotSchema.nullable().optional(),
  localSnapshotError: z.string().nullable().optional(),
});

export const BACKUP_RUN_STATUSES = ["RUNNING", "SUCCEEDED", "SKIPPED", "FAILED"] as const;

export const settingsBackupRunSchema = z.object({
  id: z.string().min(1),
  trigger: z.enum(["SCHEDULED", "MANUAL"]),
  status: z.enum(BACKUP_RUN_STATUSES),
  sourceSnapshot: z.string().nullable(),
  sourceCreatedAt: isoDateTimeSchema.nullable(),
  remoteFileName: z.string().nullable(),
  /** Decimal string: the column is a BigInt. */
  sizeBytes: z.string().nullable(),
  sha256: z.string().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
});
export type SettingsBackupRun = z.infer<typeof settingsBackupRunSchema>;

export const settingsBackupRunListSchema = z.object({ items: z.array(settingsBackupRunSchema) });
export const settingsBackupRunMutationSchema = z.object({ run: settingsBackupRunSchema });

export const settingsHostKeyScanSchema = z.object({
  keys: z.array(z.object({ type: z.string(), fingerprint: z.string(), line: z.string() })),
});
