const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PARTS = ['code', 'pin', 'otp', 'token', 'secret', 'password'] as const;
const MAX_DEPTH = 64;

export type RedactedJson =
  | null
  | boolean
  | number
  | string
  | RedactedJson[]
  | { [key: string]: RedactedJson };

function isSensitiveKey(key: string): boolean {
  const canonical = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return SENSITIVE_KEY_PARTS.some((part) => canonical.includes(part));
}

/**
 * Converts arbitrary input into JSON-safe data while stripping sensitive keys at
 * every depth. It also handles cycles defensively and serialises BigInt/Date
 * without losing financial precision or timestamps.
 */
export function deepRedact(value: unknown): RedactedJson | undefined {
  const ancestors = new WeakSet<object>();

  const visit = (current: unknown, depth: number): RedactedJson | undefined => {
    if (depth > MAX_DEPTH) {
      return '[MAX_DEPTH]';
    }
    if (current === null) {
      return null;
    }

    switch (typeof current) {
      case 'string':
      case 'boolean':
        return current;
      case 'number':
        return Number.isFinite(current) ? current : String(current);
      case 'bigint':
        return current.toString();
      case 'undefined':
      case 'function':
      case 'symbol':
        return undefined;
      case 'object':
        break;
      default:
        return undefined;
    }

    if (current instanceof Date) {
      return current.toISOString();
    }
    if (current instanceof Uint8Array) {
      return '[BINARY]';
    }

    if (ancestors.has(current)) {
      return '[CIRCULAR]';
    }
    ancestors.add(current);

    try {
      if (Array.isArray(current)) {
        return current.map((item) => visit(item, depth + 1) ?? null);
      }

      const output: Record<string, RedactedJson> = {};
      for (const [key, nested] of Object.entries(current)) {
        if (isSensitiveKey(key)) {
          output[key] = REDACTED;
          continue;
        }
        const redacted = visit(nested, depth + 1);
        if (redacted !== undefined) {
          output[key] = redacted;
        }
      }
      return output;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, 0);
}
