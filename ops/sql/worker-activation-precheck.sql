-- Read-only look at what the background worker will do in its first minutes.
--
-- Run on production BEFORE enabling the barat-worker unit, after the release
-- carrying migration 20261021120000_money_invariants is deployed (it adds the
-- columns used below):
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat < ops/sql/worker-activation-precheck.sql
--
-- Nothing here blocks anything. The worker has never run in production, so on
-- its first sweeps it acts on everything that piled up: it e-mails the codes of
-- failed deliveries again, pages Telegram once per stuck or exhausted asset,
-- and expires and classifies old quotes and carts. Look at the lists first; an
-- old test order in them is better cancelled or refunded before the customer's
-- address receives a code e-mail out of the blue.
--
-- The whole script runs inside a READ ONLY transaction and is rolled back.

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '-- 1. Gift cards the delivery-retry sweep will e-mail again (DELIVERY_FAILED,'
\echo '--    live, order still deliverable, fewer than 5 automatic attempts). Oldest first.'
SELECT a.id AS asset_id, o."orderNumber", o.status AS order_status, a."updatedAt" AS failed_at,
       (SELECT count(*) FROM "DeliveryAttempt" d
         WHERE d."giftCardAssetId" = a.id AND d."initiatedByStaffId" IS NULL) AS automatic_attempts
FROM "GiftCardAsset" a
JOIN "Order" o ON o.id = a."orderId"
WHERE a.status = 'DELIVERY_FAILED'
  AND a."supersededAt" IS NULL
  AND o.status IN ('PAID', 'FULFILLMENT_PENDING', 'FULFILLING')
  AND (SELECT count(*) FROM "DeliveryAttempt" d
        WHERE d."giftCardAssetId" = a.id AND d."initiatedByStaffId" IS NULL) < 5
ORDER BY a."updatedAt"
LIMIT 100;

\echo ''
\echo '-- 2. Gift cards that will page Telegram as "retries exhausted" (one page each)'
SELECT a.id AS asset_id, o."orderNumber", a."updatedAt" AS failed_at
FROM "GiftCardAsset" a
JOIN "Order" o ON o.id = a."orderId"
WHERE a.status = 'DELIVERY_FAILED'
  AND a."supersededAt" IS NULL
  AND o.status IN ('PAID', 'FULFILLMENT_PENDING', 'FULFILLING')
  AND (SELECT count(*) FROM "DeliveryAttempt" d
        WHERE d."giftCardAssetId" = a.id AND d."initiatedByStaffId" IS NULL) >= 5
ORDER BY a."updatedAt"
LIMIT 100;

\echo ''
\echo '-- 3. Gift cards that will page Telegram as "stuck while sending" (SENDING > 15 min)'
SELECT a.id AS asset_id, o."orderNumber", a."updatedAt" AS sending_since
FROM "GiftCardAsset" a
JOIN "Order" o ON o.id = a."orderId"
WHERE a.status = 'SENDING'
  AND a."supersededAt" IS NULL
  AND a."updatedAt" <= now() - interval '15 minutes'
ORDER BY a."updatedAt"
LIMIT 100;

\echo ''
\echo '-- 4. Counts for the other two sweeps'
SELECT
  (SELECT count(*) FROM "Quote" WHERE status = 'ACTIVE' AND "expiresAt" <= now()) AS quotes_to_expire,
  (SELECT count(*) FROM "Cart" WHERE status = 'OPEN' AND "updatedAt" <= now() - interval '60 minutes') AS idle_open_carts;

ROLLBACK;
