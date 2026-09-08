import { z } from 'zod';
import { featureFlagKeySchema, staffRoleSchema } from '@barat/contracts';

const changeReasonSchema = z
  .string()
  .trim()
  .min(8, 'دلیل تغییر باید حداقل ۸ نویسه باشد.')
  .max(500, 'دلیل تغییر نباید بیشتر از ۵۰۰ نویسه باشد.');

export const createStaffSchema = z
  .object({
    email: z.email('ایمیل معتبر وارد کنید.').max(254),
    fullName: z.string().trim().min(2, 'نام کامل را وارد کنید.').max(100),
    role: staffRoleSchema,
    password: z
      .string()
      .min(12, 'گذرواژهٔ موقت باید حداقل ۱۲ نویسه باشد.')
      .max(128)
      .regex(/[a-z]/u, 'گذرواژهٔ موقت باید حرف کوچک انگلیسی داشته باشد.')
      .regex(/[A-Z]/u, 'گذرواژهٔ موقت باید حرف بزرگ انگلیسی داشته باشد.')
      .regex(/[0-9]/u, 'گذرواژهٔ موقت باید عدد داشته باشد.'),
  })
  .strict();
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const staffStatusSchema = z
  .object({
    isActive: z.boolean(),
    reason: changeReasonSchema,
  })
  .strict();
export type StaffStatusInput = z.infer<typeof staffStatusSchema>;

export const deleteStaffSchema = z.object({ reason: changeReasonSchema }).strict();
export type DeleteStaffInput = z.infer<typeof deleteStaffSchema>;

export const featureFlagParamSchema = z.object({ key: featureFlagKeySchema }).strict();
export type FeatureFlagParam = z.infer<typeof featureFlagParamSchema>;

export const updateFeatureFlagSchema = z
  .object({
    isEnabled: z.boolean(),
    rolloutBps: z.number().int().min(0).max(10_000),
    reason: changeReasonSchema,
  })
  .strict();
export type UpdateFeatureFlagInput = z.infer<typeof updateFeatureFlagSchema>;

export const idParamSchema = z.object({ id: z.string().min(1).max(64) }).strict();
export type IdParam = z.infer<typeof idParamSchema>;

export const updateQueueSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(300).nullable(),
    isActive: z.boolean(),
    slaMinutes: z.number().int().min(5).max(10_080).nullable(),
    reason: changeReasonSchema,
  })
  .strict();
export type UpdateQueueInput = z.infer<typeof updateQueueSchema>;

export const replaceQueueOperatorsSchema = z
  .object({
    staffIds: z.array(z.string().min(1).max(64)).max(500),
    reason: changeReasonSchema,
  })
  .strict()
  .transform((input) => ({ ...input, staffIds: [...new Set(input.staffIds)] }));
export type ReplaceQueueOperatorsInput = z.infer<typeof replaceQueueOperatorsSchema>;
