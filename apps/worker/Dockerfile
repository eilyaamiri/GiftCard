# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat tini
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /repo

FROM base AS deps
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --child-concurrency=4

FROM deps AS build
ENV NODE_OPTIONS=--max-old-space-size=768
ENV DATABASE_URL=postgresql://barat:barat@localhost:5432/barat?schema=public
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --child-concurrency=4 \
    && pnpm exec turbo run build --filter=@barat/worker... --concurrency=1
RUN pnpm --filter=@barat/worker --prod deploy --legacy /out/worker

FROM node:24-alpine AS runtime
RUN apk add --no-cache tini libc6-compat openssl \
    && addgroup -g 10001 -S baratpay \
    && adduser -u 10001 -S baratpay -G baratpay
WORKDIR /app
ENV NODE_ENV=production
ENV WORKER_CONCURRENCY=5
COPY --from=build --chown=baratpay:baratpay /out/worker ./
USER baratpay
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
