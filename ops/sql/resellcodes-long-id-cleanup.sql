-- Removes the ReSellCodes SKUs whose id is longer than the API will serve.
--
-- Why: the first ReSellCodes import built a SKU id from two of the venue's own
-- ids, `rsc_s_<category>_<card>`, which for UUID-length ids is ~80 characters.
-- `idSchema` in @barat/contracts is max(64), so one such row made the admin
-- catalog and the supplier's offers list fail to load. The import now gives
-- those cards a short, stable id instead; this clears the long ones so that the
-- re-run does not leave each card twice.
--
-- Only rows that were never switched on are touched: a SKU that is inactive,
-- with the `rsc_s_` prefix and an id over 64 characters. A row that something
-- else points at (an order, a quote) is refused by its foreign key and the
-- whole script fails with nothing changed. Its offers go with it (cascade).
--
-- Dry run, which changes nothing — it ends in ROLLBACK:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat < ops/sql/resellcodes-long-id-cleanup.sql
--
-- For real, after reading the counts:
--
--   sudo docker exec -i barat-postgres psql -U barat -d barat -v commit=1 < ops/sql/resellcodes-long-id-cleanup.sql
--
-- Then re-run the import (`import-resellcodes-catalog.ts --fetch`), which adds
-- every card back under its short id. Products are not touched: their ids were
-- already short enough.

BEGIN;

\echo ''
\echo '== Before: ReSellCodes SKUs, by id length'
SELECT count(*) FILTER (WHERE length(id) <= 64) AS "ok (<= 64)",
       count(*) FILTER (WHERE length(id) > 64)  AS "too long (> 64)",
       count(*) FILTER (WHERE length(id) > 64 AND "isActive") AS "too long and active (kept)"
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%';

\echo ''
\echo '== Products and offers with an id over 64 (expected: none)'
SELECT (SELECT count(*) FROM "Product" WHERE id LIKE 'rsc\_p\_%' AND length(id) > 64) AS products,
       (SELECT count(*) FROM "SupplierOffer" WHERE length("skuId") > 64 AND "skuId" NOT LIKE 'rsc\_s\_%') AS other_offers;

DELETE FROM "Sku"
WHERE id LIKE 'rsc\_s\_%'
  AND length(id) > 64
  AND NOT "isActive";

\echo ''
\echo '== After'
SELECT count(*) FILTER (WHERE length(id) <= 64) AS "ok (<= 64)",
       count(*) FILTER (WHERE length(id) > 64)  AS "too long (> 64)"
FROM "Sku"
WHERE id LIKE 'rsc\_s\_%';

\if :{?commit}
  \echo ''
  \echo 'COMMIT'
  COMMIT;
\else
  \echo ''
  \echo 'DRY RUN - rolled back. Add -v commit=1 to keep this.'
  ROLLBACK;
\endif
