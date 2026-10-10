/**
 * An anonymous quote needs a `commerceSessionToken` (see @barat/contracts
 * `commerceSessionTokenSchema`) so the API can tie a pre-login quote back to
 * a browser without a customer id. The token itself carries no identity — it
 * is just an opaque handle the server upserts a `CommerceSession` row for.
 *
 * It lives in localStorage AND is mirrored into a cookie of the same name:
 * the quote page is a server component, and the cookie is the only channel
 * through which that render can present the token (as the API's
 * `x-commerce-session` header) and read an anonymous quote at all.
 */
const STORAGE_KEY = "barat_commerce_session";

export const COMMERCE_SESSION_COOKIE = STORAGE_KEY;

/** The token only ever holds hex from randomUUID; anything else is discarded. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

function mirrorCookie(token: string): void {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COMMERCE_SESSION_COOKIE}=${token}; path=/; max-age=31536000; samesite=lax${secure}`;
}

export function getCommerceSessionToken(): string {
  if (typeof window === "undefined") {
    throw new Error("getCommerceSessionToken can only run in the browser");
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  const token =
    existing !== null && TOKEN_PATTERN.test(existing) ? existing : crypto.randomUUID().replaceAll("-", "");
  if (token !== existing) window.localStorage.setItem(STORAGE_KEY, token);
  /* Re-written on every call: a browser that predates the cookie mirror has the
   * token in localStorage only, and this is where it catches up. */
  mirrorCookie(token);
  return token;
}

/**
 * The token if this browser already has one, without minting a fresh one.
 * Login uses it to adopt the visitor's pre-login quotes; a visitor who never
 * quoted has nothing to adopt, and minting a session just to link it would
 * write an empty row per login. A found token is re-mirrored into the cookie,
 * so a browser that quoted before the cookie mirror existed heals here — on
 * the login page — before it is sent back to its پیش‌فاکتور.
 */
export function peekCommerceSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing === null || !TOKEN_PATTERN.test(existing)) return null;
  mirrorCookie(existing);
  return existing;
}
