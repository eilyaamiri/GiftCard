-- Fixes the ReSellCodes SKUs whose `region` the API cannot serve, and holds the
-- products whose region is not a real region for review.
--
-- Why: the venue's `region` field also holds currency codes ("USD", "BRL") and a
-- product's own word ("ROBUX", "CONQUEROR", "MINECOINS"), and the first imports
-- stored whatever letters they found. `Sku.region` is served as 2–8 characters,
-- so "CONQUEROR" (9) made the admin catalog and the offers list fail to load.
--
-- The value the venue wrote stays on every SKU, so a reviewer can see what each
-- product said and set the right region. Nothing is turned into GLOBAL. What this
-- script does, on ReSellCodes rows (`rsc_` prefix) that were never switched on:
--   1. marks `needsReview` on every product that has a SKU whose region is not
--      a country code, GLOBAL or CIS — the import does this for new products
--      now, but will not touch one that already exists;
--   2. deletes the inactive SKUs whose region is over 8 characters (their
--      offers go with them, by cascade), because the re-run writes them again
--      with the venue's word cut to 8 letters ("CONQUERO"), which fits.
-- A SKU something else points at (an order, a quote) is refused by its foreign
-- key and the whole script fails with nothing changed.
--
-- Dry run, which changes nothing — it ends in ROLLBACK:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat < ops/sql/resellcodes-bad-region-cleanup.sql
--
-- For real, after reading the counts:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat -v commit=1 < ops/sql/resellcodes-bad-region-cleanup.sql
--
-- Then re-run the import (`import-resellcodes-catalog.ts --fetch`).

BEGIN;

\echo ''
\echo '== Regions that are not a country code, GLOBAL or CIS, with the number of SKUs'
SELECT region, length(region) AS len, count(*) AS skus
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%' AND region !~ '^([A-Z]{2}|GLOBAL|CIS)$'
GROUP BY region
ORDER BY len DESC, skus DESC;

\echo ''
\echo '== Of the ones over 8 characters, switched on (kept; expected 0)'
SELECT count(*) AS active_kept
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%' AND length(region) > 8 AND "isActive";

UPDATE "Product" SET "needsReview" = true
WHERE id LIKE 'rsc\_p\_%'
  AND NOT "needsReview"
  AND id IN (SELECT "productId" FROM "Sku" WHERE id LIKE 'rsc\_s\_%' AND region !~ '^([A-Z]{2}|GLOBAL|CIS)$');

DELETE FROM "Sku"
WHERE id LIKE 'rsc\_s\_%'
  AND length(region) > 8
  AND NOT "isActive";

\echo ''
\echo '== After: ReSellCodes SKUs with a region over 8 characters (expected 0)'
SELECT count(*) AS still_too_long
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%' AND length(region) > 8;

\if :{?commit}
  \echo ''
  \echo 'COMMIT'
  COMMIT;
\else
  \echo ''
  \echo 'DRY RUN - rolled back. Add -v commit=1 to keep this.'
  ROLLBACK;
\endif
