import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Every HTTP route must declare who may call it.
 *
 * The API's authorisation guards (`RolesGuard`, `CustomerScopedGuard`, both
 * APP_GUARDs registered by the identity module) are default-ALLOW: a handler
 * that carries none of `@Public()`, `@Roles(...)` or `@CustomerScoped()` passes
 * both of them untouched and is reachable by anyone on the internet. That is a
 * reasonable design only as long as forgetting the decorator cannot go
 * unnoticed. This inventory makes it noticeable: a new route with no declared
 * posture fails here until someone either decorates it or adds it to
 * UNDECORATED_ALLOWLIST below with a written reason.
 *
 * It reads the same Nest metadata the guards read, with the same precedence
 * (handler over class), so it cannot drift from what the server enforces.
 *
 * Run:  apps/api/node_modules/.bin/vitest run --root . tests/platform
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulesDir = join(repoRoot, 'apps/api/src/modules');

/* The decorators need the polyfill before any controller module evaluates. */
const apiRequire = createRequire(join(repoRoot, 'apps/api/package.json'));
apiRequire('reflect-metadata');

/* Importing a controller pulls in the Prisma singleton (which refuses to
 * construct without a URL) and, for some modules, the validated config. Nothing
 * connects or boots here; these are the same throwaway values CI uses. */
const INVENTORY_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://inventory:inventory@127.0.0.1:1/never',
  REDIS_URL: 'redis://127.0.0.1:1',
  API_PUBLIC_URL: 'http://localhost:4000',
  WEB_PUBLIC_URL: 'http://localhost:3000',
  ADMIN_PUBLIC_URL: 'http://localhost:3001',
  SESSION_JWT_SECRET: 'route-inventory-only-secret-at-least-32-chars',
  GIFT_CARD_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
};
for (const [key, value] of Object.entries(INVENTORY_ENV)) {
  process.env[key] ??= value;
}

/* Same keys as apps/api/src/modules/identity/rbac/roles.decorator.ts. */
const ROLES_METADATA_KEY = 'barat:roles';
const CUSTOMER_SCOPED_METADATA_KEY = 'barat:customer-scoped';
const PUBLIC_METADATA_KEY = 'barat:public';
/* Nest's own route metadata keys (@nestjs/common/constants). */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];

/**
 * Routes that intentionally carry no auth decorator. Each needs a reason; the
 * test also fails when an entry here no longer matches a real route, so the
 * list cannot quietly rot.
 */
const UNDECORATED_ALLOWLIST: Readonly<Record<string, string>> = {
  'GET /health': 'liveness/readiness probe, no data',
  'GET /health/live': 'liveness probe, no data',
  'POST /internal/fulfillment/retry-delivery':
    'machine-to-machine; the handler checks x-internal-service-token itself',
};

type Posture = 'public' | 'roles' | 'customer' | 'undecorated';

interface RouteInfo {
  readonly key: string;
  readonly posture: Posture;
  readonly roles: readonly string[] | undefined;
  readonly file: string;
}

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

function joinPath(...parts: Array<string | string[] | undefined>): string {
  const segments = parts
    .flatMap((part) => (Array.isArray(part) ? part.slice(0, 1) : [part]))
    .filter((part): part is string => typeof part === 'string' && part !== '' && part !== '/')
    .map((part) => part.replace(/^\/+|\/+$/gu, ''));
  return `/${segments.join('/')}`;
}

function meta<T>(key: string, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

const routes: RouteInfo[] = [];

beforeAll(async () => {
  for (const file of controllerFiles(modulesDir)) {
    const exported = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function') continue;
      const controller = value as abstract new (...args: never[]) => unknown;
      const basePath = meta<string | string[]>(PATH_METADATA, controller);
      if (basePath === undefined || meta('__controller__', controller) !== true) continue;

      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method = meta<number>(METHOD_METADATA, handler);
        const handlerPath = meta<string | string[]>(PATH_METADATA, handler);
        if (method === undefined || handlerPath === undefined) continue;

        /* Handler metadata overrides class metadata, exactly as the guards'
         * `reflector.getAllAndOverride([handler, controller])` does. */
        const pick = <T>(key: string): T | undefined =>
          meta<T>(key, handler) ?? meta<T>(key, controller);
        const isPublic = pick<boolean>(PUBLIC_METADATA_KEY) === true;
        const roles = pick<readonly string[]>(ROLES_METADATA_KEY);
        const scoped = pick<boolean>(CUSTOMER_SCOPED_METADATA_KEY) === true;

        const posture: Posture = isPublic
          ? 'public'
          : roles !== undefined
            ? 'roles'
            : scoped
              ? 'customer'
              : 'undecorated';

        routes.push({
          key: `${HTTP_METHODS[method] ?? String(method)} ${joinPath(basePath, handlerPath)}`,
          posture,
          roles,
          file: relative(repoRoot, file),
        });
      }
    }
  }
});

describe('route auth posture inventory', () => {
  it('found the API controllers', () => {
    /* A broken glob or import would otherwise make every assertion vacuous. */
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((route) => route.key === 'POST /payments')).toBe(true);
  });

  it('every route declares @Public, @Roles or @CustomerScoped, or is allow-listed', () => {
    const offenders = routes
      .filter((route) => route.posture === 'undecorated' && !(route.key in UNDECORATED_ALLOWLIST))
      .map((route) => `${route.key}  (${route.file})`);
    expect(offenders, 'undecorated routes are reachable without a session').toEqual([]);
  });

  it('the allow-list only names routes that exist and are still undecorated', () => {
    const undecorated = new Set(
      routes.filter((route) => route.posture === 'undecorated').map((route) => route.key),
    );
    const stale = Object.keys(UNDECORATED_ALLOWLIST).filter((key) => !undecorated.has(key));
    expect(stale).toEqual([]);
  });

  it('no @Roles route has an empty role list', () => {
    const empty = routes
      .filter((route) => route.posture === 'roles' && (route.roles?.length ?? 0) === 0)
      .map((route) => route.key);
    expect(empty).toEqual([]);
  });

  it('staff-only path prefixes are never public or customer-scoped', () => {
    const misplaced = routes
      .filter((route) => /^\S+ \/(admin|operator|staff)\//u.test(route.key))
      .filter((route) => route.posture !== 'roles')
      .map((route) => `${route.key} -> ${route.posture}`);
    expect(misplaced).toEqual([]);
  });
});
