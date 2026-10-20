/**
 * URL and inline-script hygiene shared by the storefront and the panel.
 *
 * Each helper answers one question about a string that did not originate in
 * our own source code — a `?next=` parameter, a link a supplier or an operator
 * typed, an admin-edited FAQ answer — before it reaches a navigation or a
 * `<script>` element.
 */

/** Any origin works as long as it can never be a real one (RFC 2606). */
const PROBE_ORIGIN = "https://same-origin.invalid";

/**
 * Characters a WHATWG URL parser silently rewrites or drops. A backslash is
 * read as `/` in http(s) URLs and tab/CR/LF are stripped, so `/\evil.example`
 * and `/\t/evil.example` both become the protocol-relative `//evil.example`.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const PARSER_REWRITTEN = /[\\\u0000-\u001f\u007f]/u;

const MAX_PATH_LENGTH = 2_048;

/**
 * `candidate` if it is a path on this origin, otherwise `null`.
 *
 * "Starts with `/` and not `//`" is not enough on its own: `/\evil.example`
 * passes that test, and the browser — and Next's router, which resolves the
 * href with `new URL` — then leaves the site. The string is therefore resolved
 * exactly the way the browser will resolve it, and only kept if it stays here.
 *
 * The original string is returned unchanged (not the resolved form), so a
 * legitimate path navigates exactly as it did before.
 */
export function sameOriginPath(candidate: unknown): string | null {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > MAX_PATH_LENGTH) return null;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (PARSER_REWRITTEN.test(candidate)) return null;
  let resolved: URL;
  try {
    resolved = new URL(candidate, PROBE_ORIGIN);
  } catch {
    return null;
  }
  return resolved.origin === PROBE_ORIGIN ? candidate : null;
}

/** The pathname `candidate` resolves to, for checks such as "is this the login page". */
export function resolvedPathname(candidate: string): string {
  try {
    return new URL(candidate, PROBE_ORIGIN).pathname;
  } catch {
    return candidate;
  }
}

/**
 * `raw` if it is an absolute http(s) URL, otherwise `null`.
 *
 * For links whose target was typed by a person or returned by a provider. React
 * already neutralises `javascript:`; this also refuses `data:`, `blob:`,
 * `file:` and anything else that is not a web page to open in a new tab.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return parsed.hostname === "" ? null : parsed.toString();
}

/**
 * `JSON.stringify` made safe to place inside an inline `<script>` element.
 *
 * Plain `JSON.stringify` does not escape `<`, so a value containing
 * `</script><script>…` closes the element and runs as page script — a stored
 * XSS when the value is admin- or user-editable (FAQ answers, product copy).
 * The escapes below are valid JSON string escapes, so every JSON / JSON-LD
 * consumer reads back exactly the original value.
 */
export function jsonForInlineScript(value: unknown): string {
  return (JSON.stringify(value) ?? "null")
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}
