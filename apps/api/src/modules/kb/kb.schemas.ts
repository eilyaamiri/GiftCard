import { z } from 'zod';

export const categoryParamSchema = z.object({ id: z.string().min(1) }).strict();
export type CategoryParam = z.infer<typeof categoryParamSchema>;

export const articleParamSchema = z.object({ id: z.string().min(1) }).strict();
export type ArticleParam = z.infer<typeof articleParamSchema>;

/** A key into the storefront's icon map — kept in lockstep with `kb-icon.tsx`. */
export const KB_ICON_KEYS = ['book-open', 'credit-card', 'gift', 'life-buoy'] as const;
const iconSchema = z.enum(KB_ICON_KEYS).default('book-open');

const slugSchema = z
  .string()
  .trim()
  .min(1, 'اسلاگ را وارد کنید.')
  .max(80, 'اسلاگ نباید بیشتر از ۸۰ نویسه باشد.')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'اسلاگ فقط می‌تواند شامل حروف/اعداد انگلیسی کوچک و خط تیره باشد.');

const nameSchema = z.string().trim().min(2, 'نام دسته را وارد کنید.').max(80, 'نام دسته نباید بیشتر از ۸۰ نویسه باشد.');
const descriptionSchema = z.string().trim().max(300, 'توضیح نباید بیشتر از ۳۰۰ نویسه باشد.');
const sortOrderSchema = z.number().int().min(0).max(999);

export const createKbCategorySchema = z
  .object({
    slug: slugSchema,
    name: nameSchema,
    description: descriptionSchema.default(''),
    icon: iconSchema,
    isEnabled: z.boolean().default(true),
    sortOrder: sortOrderSchema.default(0),
  })
  .strict();
export type CreateKbCategoryInput = z.infer<typeof createKbCategorySchema>;

export const updateKbCategorySchema = z
  .object({
    slug: slugSchema,
    name: nameSchema,
    description: descriptionSchema,
    icon: z.enum(KB_ICON_KEYS),
    isEnabled: z.boolean(),
    sortOrder: sortOrderSchema,
  })
  .strict();
export type UpdateKbCategoryInput = z.infer<typeof updateKbCategorySchema>;

const titleSchema = z.string().trim().min(2, 'عنوان را وارد کنید.').max(200, 'عنوان نباید بیشتر از ۲۰۰ نویسه باشد.');
const excerptSchema = z.string().trim().max(300, 'چکیده نباید بیشتر از ۳۰۰ نویسه باشد.');
const contentSchema = z.string().trim().min(4, 'متن مقاله را وارد کنید.').max(20000, 'متن مقاله نباید بیشتر از ۲۰۰۰۰ نویسه باشد.');
const categoryIdSchema = z.string().min(1, 'دسته را انتخاب کنید.');

export const createKbArticleSchema = z
  .object({
    categoryId: categoryIdSchema,
    slug: slugSchema,
    title: titleSchema,
    excerpt: excerptSchema.default(''),
    content: contentSchema,
    isEnabled: z.boolean().default(true),
    isPromoted: z.boolean().default(false),
    sortOrder: sortOrderSchema.default(0),
  })
  .strict();
export type CreateKbArticleInput = z.infer<typeof createKbArticleSchema>;

export const updateKbArticleSchema = z
  .object({
    categoryId: categoryIdSchema,
    slug: slugSchema,
    title: titleSchema,
    excerpt: excerptSchema,
    content: contentSchema,
    isEnabled: z.boolean(),
    isPromoted: z.boolean(),
    sortOrder: sortOrderSchema,
  })
  .strict();
export type UpdateKbArticleInput = z.infer<typeof updateKbArticleSchema>;
