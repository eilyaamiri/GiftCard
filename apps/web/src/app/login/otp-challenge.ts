import type { IdentityType } from "@barat/contracts";
import { resolvedPathname, sameOriginPath } from "@barat/ui";

/**
 * The handoff between /login and /otp.
 *
 * It holds the opaque challenge id, the masked target the API echoed back and
 * the two clocks the server owns (expiry and resend cooldown). It never holds
 * the code — the code exists only in the SMS and in the user's head.
 *
 * sessionStorage rather than the URL: the challenge is not a secret, but keeping
 * it out of the address bar keeps it out of history, bookmarks and any referrer.
 */
const STORAGE_KEY = "barat.otp.challenge";

export interface OtpChallenge {
  readonly challengeId: string;
  readonly identityType: IdentityType;
  readonly identifier: string;
  readonly maskedTarget: string;
  readonly codeLength: number;
  readonly expiresAt: string;
  /** Epoch ms before which the resend button stays disabled. */
  readonly resendAvailableAt: number;
  /** Same-origin path to land on after a successful verify. */
  readonly next: string;
}

export function saveChallenge(challenge: OtpChallenge): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(challenge));
}

export function readChallenge(): OtpChallenge | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Partial<OtpChallenge>;
    if (typeof value.challengeId !== "string" || typeof value.identifier !== "string") return null;
    /* `next` is navigated to after verify; it is re-checked on the way out of
     * storage rather than trusted because this module once wrote it. */
    return { ...(value as OtpChallenge), next: safeNextPath(typeof value.next === "string" ? value.next : null) };
  } catch {
    return null;
  }
}

export function clearChallenge(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Only a same-origin path may be followed after login. `//evil.example`, any
 * absolute URL, and the forms a URL parser rewrites into one (`/\evil.example`,
 * `/<TAB>/evil.example`) are rejected, which is what keeps `?next=` from being
 * an open redirect.
 */
export function safeNextPath(candidate: string | null | undefined, fallback = "/account"): string {
  const path = sameOriginPath(candidate);
  if (path === null) return fallback;
  // Landing back on the sign-in flow after signing in is a loop, not a destination.
  const pathname = resolvedPathname(path);
  if (pathname.startsWith("/login") || pathname.startsWith("/otp")) return fallback;
  return path;
}
