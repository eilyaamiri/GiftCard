import type { Prisma } from '@barat/database';

/**
 * What a top-up customer must type for the venue to credit their account.
 *
 * Unlike a service's account fields, these are NOT reserved keys: the venue
 * names them (`player_id`, `server`, `telegram_username`) and the purchase call
 * sends those exact names back. So validation is driven entirely by the
 * `TopUpField` rows synced for that game, and an unrecognised key is an error
 * rather than something to pass along.
 *
 * Nothing here is encrypted, and nothing here should be. These are public
 * identifiers — a player id, a username the customer already made public in
 * game. A game that wants an email and password is refused at quote time by
 * `CatalogService.getTopUpOfferForQuote`, so a credential cannot reach this
 * module to be stored in the first place.
 */

/** A field as the venue defined it. Only the parts validation needs. */
export interface TopUpFieldDefinition {
  readonly key: string;
  readonly labelFa: string | null;
  readonly label: string;
  readonly isRequired: boolean;
  readonly validationRegex: string | null;
  readonly options: Prisma.JsonValue | null;
}

export interface TopUpFieldValidationDetail {
  readonly path: string;
  readonly message: string;
}

const MAX_VALUE_LENGTH = 256;

/** Bounds the work a hostile client can cause with a huge object. */
const MAX_ACCOUNT_FIELDS = 20;

/**
 * Checks the submitted account fields against the venue's own definitions.
 *
 * Returns details rather than throwing, matching `validateServiceFields`, so
 * every problem is reported in one response instead of the customer fixing one
 * field at a time.
 *
 * The rules, in order of what they protect:
 *
 *   - An unknown key is rejected. The venue ignores keys it did not ask for, so
 *     accepting them would silently drop what the customer typed and then fail
 *     the purchase on a missing required field — after the money moved.
 *   - A missing required field is rejected here, before any charge.
 *   - A value that does not match the venue's own regex is rejected. The regex
 *     is copied from the venue, so this is the same check the purchase would
 *     eventually fail, run while it is still free to do so.
 *   - A `SELECT` value must be one of the offered options.
 *   - Length is capped. An unbounded field is a way to make a supplier call
 *     fail on the way out and leave us not knowing what happened.
 */
export function validateTopUpAccountFields(
  fields: readonly TopUpFieldDefinition[],
  values: Readonly<Record<string, string>>,
): readonly TopUpFieldValidationDetail[] {
  const details: TopUpFieldValidationDetail[] = [];
  const byKey = new Map(fields.map((field) => [field.key, field]));

  const submitted = Object.entries(values);
  if (submitted.length > MAX_ACCOUNT_FIELDS) {
    return [
      {
        path: 'topUpAccountFields',
        message: 'Too many account fields were supplied',
      },
    ];
  }

  for (const [key] of submitted) {
    if (!byKey.has(key)) {
      /* The path is `topUpAccountFields.<key>`, matching how the reserved
       * service fields are reported, so a client can highlight the input. */
      details.push({
        path: `topUpAccountFields.${key}`,
        message: 'This field is not used by this game',
      });
    }
  }

  for (const field of fields) {
    const raw = values[field.key];
    const value = (raw ?? '').trim();
    const path = `topUpAccountFields.${field.key}`;
    /* The label, never the value: a validation error must not echo back what
     * the customer typed. */
    const named = field.labelFa ?? field.label;

    if (value === '') {
      if (field.isRequired) {
        details.push({ path, message: `${named} is required` });
      }
      continue;
    }
    if (value.length > MAX_VALUE_LENGTH) {
      details.push({ path, message: 'The value is too long' });
      continue;
    }
    const options = readOptions(field.options);
    if (options !== null && !options.some((option) => option.value === value)) {
      details.push({ path, message: `${named} is not one of the available options` });
      continue;
    }
    if (field.validationRegex !== null && !matchesRegex(field.validationRegex, value)) {
      details.push({ path, message: `${named} is not in the expected format` });
    }
  }

  return details;
}

/**
 * The submitted values, trimmed to the keys the venue actually asked for.
 *
 * Called only after validation has passed, so at this point the filter is a
 * belt-and-braces guarantee rather than a correction: what is written to the
 * snapshot and later sent to the venue is exactly the venue's own key set, and
 * a future caller that skips validation still cannot smuggle an extra key into
 * a purchase request.
 */
export function buildTopUpAccountFields(
  fields: readonly TopUpFieldDefinition[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.key] ?? '').trim();
    if (value !== '') {
      result[field.key] = value;
    }
  }
  return result;
}

interface SelectOption {
  readonly value: string;
}

/**
 * The `[{label, value}]` list a SELECT field carries, or null for every other
 * field type.
 *
 * Read defensively: `TopUpField.options` is an untyped JSON column filled by a
 * sync against a venue that is free to change shape, and a malformed block must
 * not throw inside a customer's checkout.
 */
function readOptions(options: Prisma.JsonValue | null): readonly SelectOption[] | null {
  if (!Array.isArray(options)) {
    return null;
  }
  const parsed: SelectOption[] = [];
  for (const entry of options) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const value = (entry as Record<string, unknown>)['value'];
    if (typeof value === 'string' && value !== '') {
      parsed.push({ value });
    }
  }
  return parsed.length === 0 ? null : parsed;
}

/**
 * The venue's pattern, applied without a `u` flag.
 *
 * The regex comes from an external system, so two things matter: a pattern that
 * cannot compile must not throw on a customer request, and it must not be
 * anchored with `^...$` by us — some venues write `\d{6,12}` meaning "contains
 * a run of digits", and adding anchors would reject values the venue accepts.
 */
function matchesRegex(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    // An unusable pattern from the venue must not block a legitimate purchase.
    return true;
  }
}
