/**
 * An anonymous quote needs a `commerceSessionToken` (see @barat/contracts
 * `commerceSessionTokenSchema`) so the API can tie a pre-login quote back to
 * a browser without a customer id. The token itself carries no identity — it
 * is just an opaque handle the server upserts a `CommerceSession` row for.
 */
const STORAGE_KEY = "barat_commerce_session";

export function getCommerceSessionToken(): string {
  if (typeof window === "undefined") {
    throw new Error("getCommerceSessionToken can only run in the browser");
  }
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const token = crypto.randomUUID().replaceAll("-", "");
  window.localStorage.setItem(STORAGE_KEY, token);
  return token;
}
