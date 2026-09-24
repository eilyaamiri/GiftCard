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
