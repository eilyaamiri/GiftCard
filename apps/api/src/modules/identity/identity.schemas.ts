import { z } from 'zod';

import { identityTypeSchema, otpPurposeSchema } from '@barat/contracts';

/**
 * Local request schemas for endpoints that packages/contracts does not describe
 * yet. They follow the same conventions and will be folded into the frozen
 * contract package by the Foundation agent in a controlled pass.
 */

export const addIdentityRequestSchema = z.object({
  identityType: identityTypeSchema,
  identifier: z.string().min(3).max(254),
  purpose: otpPurposeSchema,
});
export type AddIdentityRequest = z.infer<typeof addIdentityRequestSchema>;

export const staffLoginRequestSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(8).max(256),
});
export type StaffLoginRequest = z.infer<typeof staffLoginRequestSchema>;

export const updateProfileRequestSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).nullable().optional(),
    lastName: z.string().trim().min(1).max(60).nullable().optional(),
    preferredLanguage: z.enum(['fa', 'en']).optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be provided');
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const customerSearchRequestSchema = z
  .object({
    /** Free-text term matched against mobile, e-mail, customerCode. */
    query: z.string().trim().min(3).max(254).optional(),
    orderNumber: z.string().trim().min(3).max(64).optional(),
    /** Payment reference (`providerRefId`) shown to the customer by their bank. */
    paymentRef: z.string().trim().min(3).max(128).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(
    (value) => Boolean(value.query ?? value.orderNumber ?? value.paymentRef),
    'Provide a query, an order number or a payment reference',
  );
export type CustomerSearchRequest = z.infer<typeof customerSearchRequestSchema>;

export const createCustomerNoteRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  isPinned: z.boolean().default(false),
});
export type CreateCustomerNoteRequest = z.infer<typeof createCustomerNoteRequestSchema>;

export const listPageRequestSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListPageRequest = z.infer<typeof listPageRequestSchema>;

export const supportRequestSchema = z.object({
  orderId: z.string().min(1).max(64).optional(),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(3).max(2000),
});
export type SupportRequest = z.infer<typeof supportRequestSchema>;
