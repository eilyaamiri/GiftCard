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

export const SETTINGS_REASON_MIN_LENGTH = 8;
