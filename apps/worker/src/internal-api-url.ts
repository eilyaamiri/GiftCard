/**
 * Validation for `INTERNAL_API_URL`, the address the worker sends the internal
 * service token to.
 *
 * Every call carries that token, so a typo or a public address here would hand
 * it to whoever answers. The worker only ever talks to the API over the host's
 * loopback or a private network (a Docker service name, a private address), so
 * anything else is refused at startup instead of at the first call.
 */

const PRIVATE_NAME_SUFFIXES = ['.internal', '.local', '.localhost'] as const;

export const INTERNAL_API_URL_RULE =
  'INTERNAL_API_URL must be an http(s) URL on an internal host (loopback, a private ' +
  'address or a single-label service name), with no credentials, query or fragment';

/** Parses and checks the URL; returns it without a trailing slash, or null. */
export function parseInternalApiUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return null;
  }
  if (!isInternalHost(url.hostname)) {
    return null;
  }
  return url.toString().replace(/\/+$/, '');
}

export function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host.startsWith('[') && host.endsWith(']')) {
    return isInternalIpv6(host.slice(1, -1));
  }
  const ipv4 = parseIpv4(host);
  if (ipv4 !== null) {
    return isInternalIpv4(ipv4);
  }
  if (host === 'localhost' || !host.includes('.')) {
    // A single-label name only resolves inside a private network (`api` in Compose).
    return host.length > 0;
  }
  return PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function parseIpv4(host: string): readonly number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isInternalIpv4([a = 0, b = 0]: readonly number[]): boolean {
  return (
    a === 127 || // loopback
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isInternalIpv6(address: string): boolean {
  // Loopback, and unique-local fc00::/7.
  return address === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(address);
}
