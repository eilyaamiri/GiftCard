# Server operations

The deployment at `185.236.37.201` (Ubuntu 24.04, 2 vCPU, 1.9 GiB RAM plus a 3 GiB
swapfile). These files are the source of truth; the copies on the server are
installed from here.

The previous host, `130.185.72.83`, moved here on 2026-10-13. It is switched off
for the application, not deleted: its three `barat-*` units are stopped and
disabled, its nginx only redirects the old `nip.io` names to the new domain, and
its PostgreSQL and Redis containers and `/opt/baratpay` are untouched.

| file | installed to |
|---|---|
| `deploy.sh` | `/opt/baratpay/deploy.sh` |
| `ci-deploy.sh` | `/opt/baratpay/ci-deploy.sh` (mode 700) |
| `nginx-baratpay.conf` | `/etc/nginx/sites-available/baratpay` |
| `barat-worker.service` | `/etc/systemd/system/barat-worker.service` |

Secrets are **not** here. They live in `/opt/baratpay/secrets/.env.{api,web,admin}`
on the server, mode 600, and are never committed.

## Public addresses

- storefront — `https://www.centohub.com` (`https://centohub.com` redirects to it)
- admin panel — `https://myspace.centohub.com`

DNS for `centohub.com` is served by the registrar's nameservers
(`ns1-3.pegahtech.ir`): one A record each for `@`, `www` and `myspace`, all
pointing at the server. One Let's Encrypt certificate covers the three names and
renews itself through certbot's timer using the webroot authenticator.

## Why HTTPS is not optional here

Two independent failures made the panels unusable over cleartext, and both are
fixed by TLS:

1. A transparent middlebox on the path rewrites any cleartext request whose URL
   contains `/chunks/` into a `302` towards a private address. Every JS and CSS
   bundle Next emits lives under that path, so the pages arrived as unstyled
   HTML. The server was answering `200` the whole time — the response never
   reached the browser. TLS cannot be inspected that way, so the rewrite stops.

2. Session cookies carry `Secure`, which a browser honours by refusing to
   *store* the cookie at all over plain HTTP. Login returned `201` and the
   cookie was discarded before it was ever kept, which is indistinguishable from
   a wrong password. The API now derives `Secure` from the scheme of the public
   URL, so an https origin gets it and the flag is never the thing that breaks a
   login.

## Releasing

A release is a person pressing a button, never a push. Run the **Deploy**
workflow (`.github/workflows/deploy.yml`) from the Actions tab on `main`; it
runs the full CI suite first, then waits for someone to approve the `production`
environment before it touches the server. Both gates are deliberate: production
release is one of the changes that requires human review.

What runs where:

1. `deploy.yml` calls `ci.yml` through `workflow_call`, so no revision can ship
   without lint, typecheck, tests and both Next builds passing on that commit.
2. After approval the runner opens one SSH connection with a key that exists
   only for this. Server-side that key is pinned to `ci-deploy.sh`, so it cannot
   open a shell, read `/opt/baratpay/secrets/`, or forward a port — the string
   Actions sends is a label, not a command.
3. `ci-deploy.sh` fetches, checks that the SHA Actions verified is an ancestor of
   `origin/main`, checks it out, and runs a *copy* of `deploy.sh` with
   `DEPLOY_SKIP_PULL=1`. The copy matters: `deploy.sh` lives in the checkout it
   rewrites, and bash reads a script as it goes.
4. The workflow then curls the three services, including one request that must
   still answer `401`. A panel that answered `200` there would be an open back
   office, and that is worth failing a release over.

Rotating the deploy key means: new keypair on the server, replace the
`command="/opt/baratpay/ci-deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding`
line in `~/.ssh/authorized_keys`, and update the `DEPLOY_SSH_KEY` secret on the
`production` environment. `deploy.sh` still runs by hand on the box when GitHub
is unreachable.

## Notes

- The box has 1.9 GiB of RAM, 2 vCPU and a 3 GiB swapfile (`/swapfile`, in
  `/etc/fstab`). The two Next builds are run one after the other on purpose;
  together they OOM, and without the swap even one build is killed (exit 137).
- `next build --output standalone` does not copy `.next/static` or `public/`
  into the standalone bundle. `deploy.sh` stages them explicitly. Without that
  step the server boots cleanly and 404s every asset.
- The certificate covers all three names and renews itself through certbot's
  timer, using the webroot authenticator. Port 80 must stay reachable for the
  renewal challenge, and nginx must keep serving `/var/www/html` there.
- Product images live in `/var/lib/baratpay/product-images` (`PRODUCT_IMAGE_DIR`),
  outside the database and outside git. Move them with the data when the host
  changes, or every product image answers 404.

## Sign-in codes and demo data

`OTP_DEV_FIXED_CODE` must not be set in production. It makes one fixed value
the login code for every number, so anyone who knows it can open any
customer's account and read their gift-card codes. The variable is for local
development only; see its comment in `apps/api/src/common/config/env.schema.ts`.
Checked absent from `/opt/baratpay/secrets/.env.api` on 2026-10-20. To re-check
without printing the value:

    sudo grep -c '^OTP_DEV_FIXED_CODE=.' /opt/baratpay/secrets/.env.api   # must print 0

Since the security wave 1 release the API also refuses to start in production
with the variable set, whatever the gateway flags say.

## Payment gateway at boot

In production the API starts only when exactly one live rial gateway is on
(`ZARINPAL_ENABLED=true` or `BAZAARPAY_ENABLED=true`, never both). With neither,
it would fall back to the mock gateway, which reports every payment as paid —
so it refuses to boot unless `PAYMENTS_ALLOW_MOCK=true` says that is intended.
Before deploying a release that carries this check, confirm which case the
server is in without printing any secret:

    sudo grep -cE '^(ZARINPAL|BAZAARPAY)_ENABLED=(true|1|yes)$' /opt/baratpay/secrets/.env.api   # must print 1

`BAZAARPAY_*` and `INTERNAL_SERVICE_TOKEN` are now validated at boot with the
rest of the environment; see `.env.example` for the full list.

The operator queue only has claimable work because the seed leaves the
unfulfilled tail `UNASSIGNED`. Claiming consumes it, so to get the queue back:

    cd /opt/baratpay/app
    set -a; . /opt/baratpay/secrets/.env.api; set +a
    NODE_ENV=development pnpm --filter @barat/database db:seed

`NODE_ENV` is overridden because the seed refuses to run under `production` —
that guard is deliberate and stays. This database holds nothing but demo data.

## Background worker

`apps/worker` runs three sweeps: quote expiry (every minute), abandonment
(every 5 minutes) and automatic delivery retry (every 2 minutes). Until the
security wave 1 release nothing in production ran them. The retry sweep e-mails
a failed gift card again after 15 minutes, at most 5 automatic attempts per
card (an operator's "resend" does not count). A card past that, or stuck in
`SENDING` for over 15 minutes, is never re-sent automatically: it opens a
reconciliation issue and pages Telegram once.

The worker reads the API's env file. It needs `INTERNAL_SERVICE_TOKEN` there
(the API holds the same value) and refuses to start in production without it;
`INTERNAL_API_URL` defaults to `http://127.0.0.1:4000/api`. Enabling it is a
change customers see, so do it on purpose, one step at a time, after the
release is deployed:

1. Check the token is set (must print 1):

       sudo grep -c '^INTERNAL_SERVICE_TOKEN=.\{32,\}' /opt/baratpay/secrets/.env.api

   If it prints 0, add one and restart the API so both sides hold it:

       echo "INTERNAL_SERVICE_TOKEN=$(openssl rand -hex 32)" | sudo tee -a /opt/baratpay/secrets/.env.api >/dev/null

       sudo systemctl restart barat-api

2. See what the first sweeps will act on, and deal with any old test order in
   the lists first:

       sudo docker exec -i barat-postgres psql -U barat -d barat < /opt/baratpay/app/ops/sql/worker-activation-precheck.sql

3. Install and start the unit:

       sudo cp /opt/baratpay/app/ops/barat-worker.service /etc/systemd/system/

       sudo systemctl daemon-reload

       sudo systemctl enable --now barat-worker

4. Confirm it runs (look for `Sweep workers started` and the per-sweep counts):

       sudo journalctl -u barat-worker -n 30 --no-pager

From then on `deploy.sh` rebuilds and restarts it with the other units, and
the watchdog below pages when no sweep has completed for two checks in a row.
To ask the heartbeat directly:

    cd /opt/baratpay/app/apps/worker && sudo sh -c 'set -a; . /opt/baratpay/secrets/.env.api; node dist/healthcheck.js'

## Uptime watchdog

`ops/healthcheck.sh` checks `/api/health` from outside the API process and
pages Telegram when the API is down for two checks in a row, when it restarted
outside a deploy (a crash the supervisor recovered), and once when it is back.
A process that has crashed cannot report itself; this is the part that can.
Once `barat-worker` is enabled it also reads the worker's heartbeat and pages
when no sweep has completed for two checks in a row, and once when sweeps
resume (`WORKER_CHECK=0` in the crontab line turns that off).

It reads `ALERT_TELEGRAM_ENABLED`, `ALERT_TELEGRAM_BOT_TOKEN` and
`ALERT_TELEGRAM_CHAT_ID` from `/opt/baratpay/secrets/.env.api` — the same values
the API uses — so set those there first. Install once, as the user that owns
`/opt/baratpay`:

    mkdir -p /opt/baratpay/state/healthcheck
    ( crontab -l 2>/dev/null; echo '* * * * * /opt/baratpay/app/ops/healthcheck.sh >/dev/null 2>&1' ) | crontab -

Try it without sending anything:

    DRY_RUN=1 /opt/baratpay/app/ops/healthcheck.sh; cat /opt/baratpay/state/healthcheck/state

A restart within 30 minutes of `HEAD` moving is treated as a deploy and does
not page (`DEPLOY_GRACE_SECONDS`). A deploy that leaves the API down still does.
`HEALTH_URL`, `FAIL_THRESHOLD` and `TIMEOUT_SECONDS` can be overridden in the
crontab line.
