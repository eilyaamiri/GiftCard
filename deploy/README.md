# Barat Pay production deployment

This directory contains the production deployment for the Barat Pay monorepo. The
production compose file keeps Postgres, Redis and application services on an
internal Docker network; only Nginx publishes ports 80 and 443.

## Prerequisites

- Ubuntu 26.04 x86_64 with Docker Engine and the Compose plugin.
- At least 1.9 GB RAM and 4 GB swap. Builds are deliberately serialized and each
  service has a memory limit; do not increase build parallelism on the target host.
- DNS records for the customer domain and (recommended) a separate admin domain.
- A checked-out repository and a root `.env.production` file. Never put this file
  in Git or in a Docker image.

Create the environment file with mode 600:

```sh
cp .env.example .env.production
chmod 600 .env.production
```

Set `NODE_ENV=production`, replace every placeholder, and set these production
keys at minimum:

| Group                      | Keys                                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                    | `NODE_ENV`, `PORT`                                                                                                                                                                                 |
| Database                   | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`                                                                                                                                                |
| Application infrastructure | `DATABASE_URL`, `REDIS_URL`                                                                                                                                                                        |
| Public URLs                | `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `ADMIN_PUBLIC_URL`                                                                                                                                             |
| Secrets                    | `SESSION_JWT_SECRET`, `GIFT_CARD_ENCRYPTION_KEY`                                                                                                                                                   |
| OTP policy                 | `OTP_LENGTH`, `OTP_TTL_SECONDS`, `OTP_RESEND_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_MAX_REQUESTS_PER_HOUR`                                                                                             |
| Pricing                    | `FX_STALE_THRESHOLD_SECONDS`, `QUOTE_TTL_SECONDS`                                                                                                                                                  |
| Worker                     | `WORKER_CONCURRENCY`                                                                                                                                                                               |
| ZarinPal                   | `ZARINPAL_ENABLED`, `ZARINPAL_MERCHANT_ID`, `ZARINPAL_REQUEST_URL`, `ZARINPAL_VERIFY_URL`, `ZARINPAL_STARTPAY_URL`, `ZARINPAL_CALLBACK_URL`, `ZARINPAL_REQUEST_TIMEOUT_MS`, `ZARINPAL_AMOUNT_UNIT` |

`DATABASE_URL` and `REDIS_URL` may use the public-looking values from the
example; compose injects service-local URLs into API and worker containers. Use
strong, unique database and JWT secrets. Generate the gift-card key with
`openssl rand -base64 32`. Do not log or paste secret values into issue trackers.

## Build and deploy

From the repository root:

```sh
./deploy/deploy.sh
# or: make deploy
```

The script is idempotent: it pulls available images, builds all four application
images with `--parallel 1`, starts healthy Postgres and Redis, applies committed
Prisma migrations, and recreates the application services with
`restart: unless-stopped`. The migration command runs the pinned Prisma CLI in a
short-lived container because production application images intentionally omit
Prisma's development CLI. Verify with:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f --tail=100 api worker nginx
```

The default Nginx configuration serves the web app at `/` and the admin app at
`/admin/`. Because the admin Next.js app is built without a `basePath`, the safer
production arrangement is an admin hostname (for example `admin.example.ir`)
with a dedicated Nginx server block proxying `/` to `admin:3001`; alternatively,
coordinate a `basePath: '/admin'` change in the foundation-owned Next configs
before relying on the path arrangement. Set `ADMIN_PUBLIC_URL` consistently.
Only the Nginx host should be reachable from the Internet.

### Next standalone requirement

`apps/web/next.config.ts` and `apps/admin/next.config.ts` are owned by the
foundation workstream. Their production config must set `output: 'standalone'`
for the included Dockerfiles to work. If that option is absent, add it through
the owning workstream before deploying; this deployment does not edit those files.

## TLS with Certbot

The Nginx file includes a commented TLS template and an ACME challenge location.
Point DNS at the host, expose port 80, and issue certificates using Certbot (or
an existing Certbot installation). Mount the resulting certificate directory via
the `certbot-etc` volume, uncomment and adapt the TLS server block in
`deploy/nginx/conf.d/barat.conf`, then reload:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -t
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

Use HTTPS URLs in all public environment variables after TLS is active. The
ZarinPal callback must be the HTTPS API callback and must be reachable from the
public Internet.

## Backups and restore

Run a nightly cron job as root (or a restricted deployment account):

```cron
15 2 * * * cd /srv/barat-pay && ./deploy/backup.sh >> /var/log/baratpay-backup.log 2>&1
```

`backup.sh` writes compressed, mode-600 custom-format dumps to
`/var/backups/baratpay` and removes dumps older than seven days. Override
`BACKUP_DIR` or `RETENTION_DAYS` when needed. Copy backups to separate durable
storage. A restore is performed with `pg_restore` into a stopped/isolated target
and must be rehearsed before an incident.

## ZarinPal production readiness — do not skip

Production payments are **never auto-enabled**. Keep `ZARINPAL_ENABLED=false`
until every item below has been explicitly approved by the operator:

- [ ] The production merchant ID is supplied and verified.
- [ ] The gateway amount unit is confirmed against the merchant contract
      (`ZARINPAL_AMOUNT_UNIT=IRR` or `IRT`); do not guess.
- [ ] The callback URL is HTTPS and points to the production API route.
- [ ] The callback is reachable from outside the firewall and reverse proxy.
- [ ] A small real transaction has been tested end-to-end, including server-side
      callback verification and reconciliation.
- [ ] Monitoring, alerting, backup and rollback contacts are recorded.

Only after the checklist is signed off may an operator deliberately set
`ZARINPAL_ENABLED=true`, redeploy, and monitor the first transactions. Never
enable production payments as a side effect of `deploy.sh`.
