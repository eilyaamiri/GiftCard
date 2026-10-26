/**
 * The visitor's address, as the web server's own API calls should report it.
 *
 * A server component calls the API from the web server, so without help the API
 * sees every visitor as the web server's address and its per-IP rate limit
 * becomes one bucket for the whole site. nginx has already put the visitor's
 * address on the request (`X-Forwarded-For`, `X-Real-IP`); this hands it on.
 *
 * The header is passed through untouched, chain and all. Deciding which hop to
 * believe is the API's job (`trust proxy` in `apps/api/src/main.ts` takes the
 * right-most address that is not a private or loopback proxy), so a visitor who
 * sends their own `X-Forwarded-For` only ever adds a hop to the left of the one
 * nginx appended.
 */
export function clientIpHeaders(read: (name: string) => string | null): Record<string, string> {
  const chain = read("x-forwarded-for")?.trim();
  if (chain) return { "x-forwarded-for": chain };
  const real = read("x-real-ip")?.trim();
  return real ? { "x-forwarded-for": real } : {};
}
