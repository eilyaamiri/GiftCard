/**
 * The fewest characters a masked code ever keeps hidden.
 *
 * `maskedCode` is declared safe to log and is shown to any operator who opens a
 * workspace and written into audit payloads, so it must not be a near-copy of
 * the secret. Revealing the first and last four characters of a 10-character
 * code would leave two unknown characters — a few dozen guesses — which is the
 * code itself in all but name. Eight hidden characters is the floor.
 */
const MIN_HIDDEN_CHARACTERS = 8;
const VISIBLE_GROUP = 4;

function hiddenGroups(hiddenLength: number): string[] {
  return Array.from({ length: Math.max(1, Math.ceil(hiddenLength / VISIBLE_GROUP)) }, () => 'XXXX');
}

/**
 * Produce a display-safe code such as `ABCD-XXXX-XXXX-8271`.
 *
 * Long codes keep their first and last four characters. A shorter code keeps
 * only its last four, and a code too short for even that is masked entirely, so
 * at least {@link MIN_HIDDEN_CHARACTERS} characters are always withheld.
 */
export function maskGiftCardCode(code: string): string {
  const value = code.trim();
  const compact = value.replace(/[\s-]/gu, '');

  if (compact.length >= 2 * VISIBLE_GROUP + MIN_HIDDEN_CHARACTERS) {
    const prefix = compact.slice(0, VISIBLE_GROUP);
    const suffix = compact.slice(-VISIBLE_GROUP);
    return [prefix, ...hiddenGroups(compact.length - 2 * VISIBLE_GROUP), suffix].join('-');
  }

  if (compact.length >= VISIBLE_GROUP + MIN_HIDDEN_CHARACTERS) {
    const suffix = compact.slice(-VISIBLE_GROUP);
    return [...hiddenGroups(compact.length - VISIBLE_GROUP), suffix].join('-');
  }

  return 'X'.repeat(Math.max(compact.length, VISIBLE_GROUP));
}
