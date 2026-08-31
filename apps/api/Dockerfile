# syntax=docker/dockerfile:1.7
# ============================================================================
# Barat Pay API — multi-stage image, tuned for a 2 vCPU / 1.9 GB RAM host.
#
#   deps    -> install the full workspace (dev deps included) so turbo can build
#   build   -> `prisma generate` + compile @barat/api and everything it depends on
#   prune   -> `pnpm deploy --prod` into a self-contained, production-only tree
#   runtime -> node:24-alpine, non-root, tini as PID 1, only the pruned tree
#
# Build from the MONOREPO ROOT:
#   docker build -f apps/api/Dockerfile -t baratpay/api .
# ============================================================================

FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat tini
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------------------
FROM base AS deps
# Keep the memory footprint of the pnpm store fetcher small.
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/test-utils/package.json packages/test-utils/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY integrations/fx/package.json integrations/fx/package.json
COPY integrations/notifications/package.json integrations/notifications/package.json
COPY integrations/payments/package.json integrations/payments/package.json
COPY integrations/suppliers/package.json integrations/suppliers/package.json

# One vCPU worth of network concurrency; a fuller value risks OOM on 1.9 GB.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --child-concurrency=4

# ---------------------------------------------------------------------------
FROM deps AS build
ENV NODE_OPTIONS=--max-old-space-size=768
ENV DATABASE_URL=postgresql://barat:barat@localhost:5432/barat?schema=public
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

COPY . .
# Re-sync node_modules for any workspace-local bin symlinks after the full
# source copy, then build @barat/api and every workspace it depends on
# (this transitively runs `prisma generate` inside packages/database).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --child-concurrency=4 \
    && pnpm exec turbo run build --filter=@barat/api... --concurrency=1

# Produce a self-contained, production-only dependency tree for @barat/api.
# `pnpm deploy` follows each package's "files" field, so dist/, generated/
# and prisma/ all make it across for @barat/database.
# Migrations run from the API image during deploy. Prisma CLI is kept as one
# production dependency (the generated client alone has no migrate executable).
RUN pnpm --dir /out/api add --prod --offline --ignore-workspace prisma@7.10.0

# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
RUN apk add --no-cache tini libc6-compat openssl \
    && addgroup -g 10001 -S baratpay \
    && adduser -u 10001 -S baratpay -G baratpay

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build --chown=baratpay:baratpay /out/api ./

USER baratpay
EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
