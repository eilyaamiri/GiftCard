import { open, seal } from '../../common/crypto/aead-envelope';

/**
 * The account details an international payment needs.
 *
 * An operator paying a foreign invoice on the customer's behalf needs to know
 * WHERE to pay and, when the payment happens inside the customer's own account,
 * how to sign in. Those three inputs are the same for every foreign service, so
 * they are reserved keys accepted on top of whatever `ServiceFieldDefinition`
 * rows a service configures — `packages/database/prisma/seed.ts` is
 * foundation-owned and cannot be extended from here.
 *
 * The password is why this file exists. It is sealed with AES-256-GCM before it
 * reaches `Quote.snapshot`, under an AAD of its own, so a snapshot dump, the
 * quote read endpoint, an audit row or a log line can only ever contain an
 * opaque envelope. It is opened in exactly one place: the operator's audited
 * reveal in the fulfillment module, which imports `openServiceAccountPassword`
 * from here so both sides can never disagree about the AAD.
 */

export const SERVICE_ACCOUNT_FIELD_KEYS = {
  SITE_URL: 'siteUrl',
  USERNAME: 'accountUsername',
  PASSWORD: 'accountPassword',
} as const;

/** Keys `validateServiceFields` must not reject as unknown. */
export const RESERVED_SERVICE_FIELD_KEYS: ReadonlySet<string> = new Set<string>(
  Object.values(SERVICE_ACCOUNT_FIELD_KEYS),
);

/**
 * Domain separation for the sealed password.
 *
 * Changing this string invalidates every envelope already written, so it is
 * versioned rather than edited.
 */
export const SERVICE_ACCOUNT_PASSWORD_AAD = 'barat-pay:service-account-password:v1';

const MAX_SITE_URL_LENGTH = 2_048;
const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 256;
const ALLOWED_SITE_URL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * What is persisted under `Quote.snapshot.serviceAccount`.
 *
 * There is no plaintext password field, by construction — the same reason
 * `GiftCardAssetView` has no `code`.
 */
export interface ServiceAccountSnapshot {
  readonly siteUrl: string;
  readonly accountUsername: string | null;
  /** `v1.<iv>.<tag>.<ciphertext>`, or null when the customer supplied none. */
  readonly accountPasswordEnvelope: string | null;
}

export interface ServiceAccountValidationDetail {
  readonly path: string;
  readonly message: string;
}

/**
 * Validates the reserved keys.
 *
 * Returns details instead of throwing so the caller can report them together
 * with the configured-field errors in a single validation response.
 */
export function validateServiceAccountFields(
  values: Readonly<Record<string, string>>,
): readonly ServiceAccountValidationDetail[] {
  const details: ServiceAccountValidationDetail[] = [];
  const siteUrl = (values[SERVICE_ACCOUNT_FIELD_KEYS.SITE_URL] ?? '').trim();
  const username = (values[SERVICE_ACCOUNT_FIELD_KEYS.USERNAME] ?? '').trim();
  const password = values[SERVICE_ACCOUNT_FIELD_KEYS.PASSWORD] ?? '';

  if (siteUrl === '') {
    details.push({
      path: `serviceFields.${SERVICE_ACCOUNT_FIELD_KEYS.SITE_URL}`,
      message: 'The website address is required',
    });
  } else if (siteUrl.length > MAX_SITE_URL_LENGTH) {
    details.push({
      path: `serviceFields.${SERVICE_ACCOUNT_FIELD_KEYS.SITE_URL}`,
      message: 'The website address is too long',
    });
  } else if (!isPayableSiteUrl(siteUrl)) {
    details.push({
      path: `serviceFields.${SERVICE_ACCOUNT_FIELD_KEYS.SITE_URL}`,
      message: 'Invalid website address',
    });
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    details.push({
      path: `serviceFields.${SERVICE_ACCOUNT_FIELD_KEYS.USERNAME}`,
      message: 'The username is too long',
    });
  }

  /* The message names the limit, never the value: a validation error for a
   * credential must not echo any part of it back. */
  if (password.length > MAX_PASSWORD_LENGTH) {
    details.push({
      path: `serviceFields.${SERVICE_ACCOUNT_FIELD_KEYS.PASSWORD}`,
      message: 'The password is too long',
    });
  }
  if (password !== '' && username === '') {
    details.push({
      path: `serviceFields.${SERVICE_ACCOUNT_FIELD_KEYS.USERNAME}`,
      message: 'A username is required when a password is supplied',
    });
  }

  return details;
}

/**
 * Splits the reserved keys out of the submitted values and seals the password.
 *
 * The caller owns `key` and must zero it afterwards, exactly as
 * `BankDetailsService` does.
 */
export function buildServiceAccountSnapshot(
  values: Readonly<Record<string, string>>,
  key: Buffer,
): ServiceAccountSnapshot {
  const siteUrl = (values[SERVICE_ACCOUNT_FIELD_KEYS.SITE_URL] ?? '').trim();
  const username = (values[SERVICE_ACCOUNT_FIELD_KEYS.USERNAME] ?? '').trim();
  const password = values[SERVICE_ACCOUNT_FIELD_KEYS.PASSWORD] ?? '';

  return {
    siteUrl,
    accountUsername: username === '' ? null : username,
    accountPasswordEnvelope:
      password === '' ? null : seal(password, key, SERVICE_ACCOUNT_PASSWORD_AAD),
  };
}

/** The configured service fields, with the reserved keys removed. */
export function withoutReservedKeys(
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !RESERVED_SERVICE_FIELD_KEYS.has(key)),
  );
}

/**
 * Reads the block back out of a persisted snapshot.
 *
 * Defensive on purpose: `Quote.snapshot` is an untyped JSON column that also
 * holds rows written before this block existed, so anything unexpected reads as
 * "no account details" rather than throwing inside an operator's workspace.
 */
export function readServiceAccountSnapshot(snapshot: unknown): ServiceAccountSnapshot | null {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return null;
  }
  const block = (snapshot as Record<string, unknown>)['serviceAccount'];
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return null;
  }
  const record = block as Record<string, unknown>;
  const siteUrl = record['siteUrl'];
  if (typeof siteUrl !== 'string' || siteUrl === '') {
    return null;
  }
  const username = record['accountUsername'];
  const envelope = record['accountPasswordEnvelope'];
  return {
    siteUrl,
    accountUsername: typeof username === 'string' && username !== '' ? username : null,
    accountPasswordEnvelope: typeof envelope === 'string' && envelope !== '' ? envelope : null,
  };
}

/** The one place the sealed password is turned back into a plaintext. */
export function openServiceAccountPassword(envelope: string, key: Buffer): string {
  return open(envelope, key, SERVICE_ACCOUNT_PASSWORD_AAD);
}

function isPayableSiteUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return ALLOWED_SITE_URL_PROTOCOLS.has(parsed.protocol) && parsed.hostname !== '';
}
