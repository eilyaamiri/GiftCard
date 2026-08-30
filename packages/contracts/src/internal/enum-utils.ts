/**
 * Internal helpers used to declare an enum exactly once and derive
 *   - a frozen const object (`OrderStatus.PAID`)
 *   - a union type (`OrderStatus`)
 *   - a Zod schema (`orderStatusSchema`)
 * from a single tuple of literals.
 *
 * Not exported from the package root on purpose — enums are declaration sites,
 * not a runtime toolkit.
 */

/** A non-empty tuple of string literals. */
export type EnumValues = readonly [string, ...string[]];

/** `{ PAID: 'PAID', FAILED: 'FAILED' }` derived from `['PAID', 'FAILED']`. */
export type EnumObject<T extends EnumValues> = { readonly [K in T[number]]: K };

/** Build the frozen const object for a tuple of literals. */
export function enumFrom<const T extends EnumValues>(values: T): EnumObject<T> {
  const record: Record<string, string> = {};
  for (const value of values) {
    record[value] = value;
  }
  return Object.freeze(record) as EnumObject<T>;
}

/** Runtime type guard for an enum tuple. */
export function isEnumValue<const T extends EnumValues>(
  values: T,
  candidate: unknown,
): candidate is T[number] {
  return typeof candidate === 'string' && (values as readonly string[]).includes(candidate);
}
