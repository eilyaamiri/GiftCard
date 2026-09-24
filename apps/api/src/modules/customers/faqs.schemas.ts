import { z } from 'zod';

export const faqParamSchema = z.object({ id: z.string().min(1) }).strict();
export type FaqParam = z.infer<typeof faqParamSchema>;

const questionSchema = z.string().trim().min(4, 'پرسش را وارد کنید.').max(200, 'پرسش نباید بیشتر از ۲۰۰ نویسه باشد.');
const answerSchema = z.string().trim().min(4, 'پاسخ را وارد کنید.').max(2000, 'پاسخ نباید بیشتر از ۲۰۰۰ نویسه باشد.');
const sortOrderSchema = z.number().int().min(0).max(999);

export const createFaqSchema = z
  .object({
    question: questionSchema,
    answer: answerSchema,
    isEnabled: z.boolean().default(true),
    sortOrder: sortOrderSchema.default(0),
  })
  .strict();
export type CreateFaqInput = z.infer<typeof createFaqSchema>;

export const updateFaqSchema = z
  .object({
    question: questionSchema,
    answer: answerSchema,
    isEnabled: z.boolean(),
    sortOrder: sortOrderSchema,
  })
  .strict();
export type UpdateFaqInput = z.infer<typeof updateFaqSchema>;
