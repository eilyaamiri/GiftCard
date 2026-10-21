-- Read-only pre-check for migration 20261021120000_money_invariants.
--
-- Run on production BEFORE deploying the release that carries the migration:
--
--   psql "$DATABASE_URL" -f ops/sql/money-invariants-precheck.sql
--
-- Every query in the BLOCKING section must return 0. A non-zero count means the
-- migration's pre-flight block will refuse to run; the second query of each pair
-- lists the offending rows so they can be resolved (by status transition, never
-- by deleting financial history) before the deploy.
--
-- The INFORMATIONAL section does not block the migration; it shows what the
-- backfill will decide on its own (the newest live row keeps the key).
--
-- The whole script runs inside a READ ONLY transaction and is rolled back.

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '=== BLOCKING: must all be 0 ==='

\echo ''
\echo '-- 1. Quotes anchoring more than one order (Order.quoteId becomes UNIQUE)'
SELECT count(*) AS quotes_with_several_orders
FROM (SELECT 1 FROM "Order" GROUP BY "quoteId" HAVING count(*) > 1) d;

SELECT "quoteId", count(*) AS orders, array_agg("orderNumber" ORDER BY "createdAt") AS order_numbers
FROM "Order"
GROUP BY "quoteId"
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT 50;

\echo ''
\echo '-- 2. Orders with more than one PAID payment (Payment.paidOrderKey becomes UNIQUE)'
SELECT count(*) AS orders_with_several_paid_payments
FROM (SELECT 1 FROM "Payment" WHERE status = 'PAID' GROUP BY "orderId" HAVING count(*) > 1) d;

SELECT p."orderId", o."orderNumber", count(*) AS paid_payments, sum(p."amountIrr") AS paid_total_irr
FROM "Payment" p
JOIN "Order" o ON o.id = p."orderId"
WHERE p.status = 'PAID'
GROUP BY p."orderId", o."orderNumber"
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT 50;

\echo ''
\echo '-- 3. Orders with more than one gift-card asset (GiftCardAsset.liveOrderKey becomes UNIQUE)'
SELECT count(*) AS orders_with_several_assets
FROM (SELECT 1 FROM "GiftCardAsset" GROUP BY "orderId" HAVING count(*) > 1) d;

SELECT a."orderId", o."orderNumber", count(*) AS assets, array_agg(a.id ORDER BY a."createdAt") AS asset_ids
FROM "GiftCardAsset" a
JOIN "Order" o ON o.id = a."orderId"
GROUP BY a."orderId", o."orderNumber"
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT 50;

\echo ''
\echo '-- 4. Supplier orders recorded on more than one fulfillment (UNIQUE (supplierId, supplierOrderId))'
SELECT count(*) AS duplicated_supplier_orders
FROM (
  SELECT 1 FROM "Fulfillment"
  WHERE "supplierId" IS NOT NULL AND "supplierOrderId" IS NOT NULL
  GROUP BY "supplierId", "supplierOrderId"
  HAVING count(*) > 1
) d;

SELECT "supplierId", "supplierOrderId", count(*) AS fulfillments, array_agg("orderId" ORDER BY "createdAt") AS order_ids
FROM "Fulfillment"
WHERE "supplierId" IS NOT NULL AND "supplierOrderId" IS NOT NULL
GROUP BY "supplierId", "supplierOrderId"
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT 50;

\echo ''
\echo '-- 5. Duplicate abandonment records per quote / per cart (UNIQUE (type, quoteId) and (type, cartId))'
SELECT
  (SELECT count(*) FROM (
     SELECT 1 FROM "AbandonmentRecord" WHERE "quoteId" IS NOT NULL
     GROUP BY type, "quoteId" HAVING count(*) > 1) d) AS duplicate_per_quote,
  (SELECT count(*) FROM (
     SELECT 1 FROM "AbandonmentRecord" WHERE "cartId" IS NOT NULL
     GROUP BY type, "cartId" HAVING count(*) > 1) d) AS duplicate_per_cart;

\echo ''
\echo '=== INFORMATIONAL: resolved by the backfill, not blocking ==='

\echo ''
\echo '-- 6. Orders with more than one open gateway session (only the newest gets liveOrderKey)'
SELECT count(*) AS orders_with_several_open_sessions
FROM (
  SELECT 1 FROM "Payment"
  WHERE status IN ('CREATED', 'REDIRECTED', 'PENDING')
  GROUP BY "orderId"
  HAVING count(*) > 1
) d;

\echo ''
\echo '-- 7. Orders with more than one non-terminal fulfillment (only the newest gets activeOrderKey)'
SELECT count(*) AS orders_with_several_active_fulfillments
FROM (
  SELECT 1 FROM "Fulfillment"
  WHERE status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL')
  GROUP BY "orderId"
  HAVING count(*) > 1
) d;

\echo ''
\echo '-- 8. Rows the new ON DELETE RESTRICT rules now protect (counts only)'
SELECT
  (SELECT count(*) FROM "QuoteComponent")       AS quote_components,
  (SELECT count(*) FROM "PaymentAttempt")       AS payment_attempts,
  (SELECT count(*) FROM "SupportTicket")        AS support_tickets,
  (SELECT count(*) FROM "FulfillmentChecklist") AS fulfillment_checklists,
  (SELECT count(*) FROM "GiftCardCodeRequest")  AS gift_card_code_requests;

\echo ''
\echo '-- 9. WEB-3: stored delivery links that are not http(s). From this release the'
\echo '--    customer sees no link for these; replace the card if a real order is listed.'
-- Only the scheme is shown: the link itself is the card.
SELECT a.id AS asset_id, o."orderNumber", a.status,
       coalesce(substring(a."deliveryUrl" from '^[A-Za-z][A-Za-z0-9+.-]*:'), '(no scheme)') AS scheme
FROM "GiftCardAsset" a
JOIN "Order" o ON o.id = a."orderId"
WHERE a."deliveryUrl" IS NOT NULL
  AND a."deliveryUrl" !~* '^https?://'
ORDER BY a."createdAt"
LIMIT 50;

ROLLBACK;
