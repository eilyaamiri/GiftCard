import { z } from 'zod';

import { customerStatusSchema, identityTypeSchema, otpPurposeSchema } from '../enums/identity';
import { commerceSessionTokenSchema, idSchema, isoDateTimeSchema } from './common';

/* ============================================================================
 * Identity values
 * ==========================================================================*/

/**
 * Iranian mobile number in normalised form: `09xxxxxxxxx`.
 * The API accepts `+98…`, `0098…` and `9…` and normalises before storing, so
 * `CustomerIdentity(type, valueNormalized)` stays genuinely unique.
 */
export const mobileSchema = z
  .string()
  .trim()
  .regex(/^(?:\+98|0098|98|0)?9\d{9}$/u, 'Enter a valid Iranian mobile number');

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** A login identifier is either a mobile number or an e-mail address. */
export const identifierSchema = z.union([mobileSchema, emailSchema]);

/* ============================================================================
 * POST /api/auth/otp/request  — requestOtp
 * ==========================================================================*/

/**
 * The response NEVER reveals whether the identifier exists — that would be an
 * account-enumeration oracle. It always looks the same.
 *
 * The OTP value itself is never returned, never logged and never stored in
 * plaintext; only an argon2 hash is persisted.
 */
export const requestOtpRequestSchema = z.object({
  identityType: identityTypeSchema,
  identifier: z.string().min(3).max(254),
  purpose: otpPurposeSchema.default('LOGIN'),
  commerceSessionToken: commerceSessionTokenSchema.optional(),
});
export type RequestOtpRequest = z.infer<typeof requestOtpRequestSchema>;

export const requestOtpResponseSchema = z.object({
  /** Opaque handle for the follow-up verify call. Not a secret, not the code. */
  challengeId: idSchema,
  /** Masked target, e.g. `0912***4567` or `a***@gmail.com`. */
  maskedTarget: z.string(),
  /** Number of digits the UI should render. */
  codeLength: z.number().int().min(4).max(8),
  expiresAt: isoDateTimeSchema,
  /** Seconds before "resend" becomes available. */
  resendAvailableInSeconds: z.number().int().min(0),
  attemptsRemaining: z.number().int().min(0),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

/* ============================================================================
 * POST /api/auth/otp/verify  — verifyOtp
 * ==========================================================================*/

export const verifyOtpRequestSchema = z.object({
  challengeId: idSchema,
  /** Digits only. Always rendered LTR in the RTL UI. */
  code: z.string().regex(/^\d{4,8}$/u, 'The verification code must be 4 to 8 digits'),
  commerceSessionToken: commerceSessionTokenSchema.optional(),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

export const customerDtoSchema = z.object({
  id: idSchema,
  customerCode: z.string().min(1),
  status: customerStatusSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  maskedMobile: z.string().nullable(),
  maskedEmail: z.string().nullable(),
  isMobileVerified: z.boolean(),
  isEmailVerified: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type CustomerDto = z.infer<typeof customerDtoSchema>;

export const verifyOtpResponseSchema = z.object({
  customer: customerDtoSchema,
  /**
   * Short-lived session JWT. In the browser this is also set as an
   * HttpOnly + Secure + SameSite=Lax cookie; the body copy exists for native
   * clients only.
   */
  accessToken: z.string(),
  expiresAt: isoDateTimeSchema,
  /** True when this verification created the customer record. */
  isNewCustomer: z.boolean(),
});
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

/* ============================================================================
 * Session
 * ==========================================================================*/

export const meResponseSchema = z.object({
  customer: customerDtoSchema.nullable(),
  isAuthenticated: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const logoutResponseSchema = z.object({
  loggedOut: z.boolean(),
});
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;
