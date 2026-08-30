import { z } from 'zod';

import { enumFrom } from '../internal/enum-utils';

/* ============================================================================
 * Staff
 * ==========================================================================*/

/**
 * Server-side RBAC roles. `MANAGEMENT` exists because the reporting documents
 * assume a CEO/board persona that is not an `ADMIN`.
 *
 * Authorisation is always evaluated on the server. A UI that hides a button is
 * a convenience, never a control.
 */
export const STAFF_ROLE_VALUES = [
  'ADMIN',
  'MANAGEMENT',
  'OPS_MANAGER',
  'OPERATOR',
  'FINANCE',
  'SUPPORT',
  'VIEWER',
] as const;

export const StaffRole = enumFrom(STAFF_ROLE_VALUES);
export type StaffRole = (typeof STAFF_ROLE_VALUES)[number];
export const staffRoleSchema = z.enum(STAFF_ROLE_VALUES);

/** Roles allowed to approve a supplier cost variance beyond tolerance. */
export const MANAGER_APPROVAL_ROLES = ['ADMIN', 'OPS_MANAGER', 'MANAGEMENT'] as const;

/* ============================================================================
 * Customer identity
 * ==========================================================================*/

export const IDENTITY_TYPE_VALUES = ['MOBILE', 'EMAIL'] as const;

export const IdentityType = enumFrom(IDENTITY_TYPE_VALUES);
export type IdentityType = (typeof IDENTITY_TYPE_VALUES)[number];
export const identityTypeSchema = z.enum(IDENTITY_TYPE_VALUES);

export const OTP_PURPOSE_VALUES = [
  'LOGIN',
  'VERIFY_MOBILE',
  'VERIFY_EMAIL',
  'CHANGE_MOBILE',
  'CHANGE_EMAIL',
] as const;

export const OtpPurpose = enumFrom(OTP_PURPOSE_VALUES);
export type OtpPurpose = (typeof OTP_PURPOSE_VALUES)[number];
export const otpPurposeSchema = z.enum(OTP_PURPOSE_VALUES);

export const CUSTOMER_STATUS_VALUES = ['ACTIVE', 'DISABLED', 'REVIEW_REQUIRED'] as const;

export const CustomerStatus = enumFrom(CUSTOMER_STATUS_VALUES);
export type CustomerStatus = (typeof CUSTOMER_STATUS_VALUES)[number];
export const customerStatusSchema = z.enum(CUSTOMER_STATUS_VALUES);
