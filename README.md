# Barat Pay — International Commerce POC

A digital-commerce platform that lets Iranian customers pay in rial for global digital
value. Two service lines:

1. **Gift Cards** — a curated set of SKUs (Apple, Google Play, PlayStation, Steam,
   Netflix, Xbox, Amazon) in controlled regions, fulfilled **manually by an operator**.
2. **International Payments** — SaaS, AI tools, cloud, domain/hosting, courses, exam fees.

> Read [`AGENTS.md`](./AGENTS.md) before writing a single line of code, and
> [`docs/EXECUTION-PLAN.fa.md`](./docs/EXECUTION-PLAN.fa.md) for full product context.

---

## Architecture

**Modular monolith.** No microservices. One `apps/api` with bounded domain modules.

```
GiftCard/
├── apps/
│   ├── web/        Next.js 16 — customer site (RTL Persian, mobile-first from 320px)
│   ├── admin/      Next.js 16 — admin panel + operator workspace (RBAC)
│   ├── api/        NestJS 12 — modular monolith
│   └── worker/     NestJS standalone + BullMQ — async jobs
├── packages/
│   ├── contracts/  Zod schemas, enums, DTOs, money primitive types  (FROZEN)
│   ├── database/   Prisma schema + migrations + seed                (FROZEN schema)
│   ├── ui/         @barat/ui design system + Vazirmatn
│   ├── config/     shared tsconfig / eslint / tailwind presets
│   └── test-utils/ factories, fixtures, deterministic seed
├── integrations/
│   ├── fx/           FxRateProvider interface + implementations
│   ├── payments/     RialPaymentProvider interface + zarinpal
│   ├── suppliers/    SupplierProvider interface + tillo/reloadly/runa/giftbit
│   └── notifications/ SmsProvider / EmailProvider
├── docs/
└── tests/          e2e / payment / pricing / reconciliation
```

## Toolchain (pinned — never use `^`)

| Tool | Version |
|---|---|
| Node | 24.x |
| pnpm | 11.24.0 |
| Turborepo | 2.10.12 |
| TypeScript | 5.9.3 |
| Next.js | 16.3.3 / React 19.2.8 |
| NestJS | 12.0.1 |
| Prisma | 7.10.0 |
| PostgreSQL | 17-alpine |
| Redis | 8-alpine |

## Getting started

```bash
# 1. Toolchain
corepack enable && corepack prepare pnpm@11.24.0 --activate

# 2. Install
pnpm install

# 3. Environment
cp .env.example .env
# then edit .env — at minimum SESSION_JWT_SECRET and GIFT_CARD_ENCRYPTION_KEY:
#   openssl rand -base64 32

# 4. Infrastructure
pnpm docker:up          # postgres 17 + redis 8, with healthchecks

# 5. Database
pnpm db:generate        # generate the Prisma client
pnpm db:migrate         # apply migrations
pnpm db:seed            # deterministic seed data

# 6. Run everything
pnpm dev
```

| App | URL |
|---|---|
| API | http://localhost:4000/api |
| API docs (non-production only) | http://localhost:4000/api/docs |
| Health | http://localhost:4000/api/health |
| Web | http://localhost:3000 |
| Admin | http://localhost:3001 |

## Common commands

```bash
pnpm build          # turbo build, respects the dependency graph
pnpm typecheck      # tsc --noEmit everywhere
pnpm lint           # eslint, includes the import-boundary rule
pnpm test           # vitest
pnpm test:e2e       # playwright
pnpm format         # prettier --write
pnpm docker:reset   # wipe volumes and restart postgres + redis
```

## Prisma 7 notes

Prisma 7 no longer accepts `url = env(...)` inside `schema.prisma`. The connection string
lives in `packages/database/prisma.config.ts`, and `PrismaClient` is constructed with the
`@prisma/adapter-pg` driver adapter. See `packages/database/src/index.ts`.

## Non-negotiables (short form)

- No JS float for money. `BigInt` for IRR, `Decimal.js` for foreign currency.
- Percentages are integer basis points (`100 bps = 1%`).
- Payment callbacks are verified server-side; callback parameters are untrusted.
- Idempotency on payment, quote acceptance, order creation and fulfillment.
- Never log tokens, secrets, gift-card codes/PINs, or OTP values.
- Domain modules never import a concrete provider — interface barrels only.

Full list: [`AGENTS.md`](./AGENTS.md).
