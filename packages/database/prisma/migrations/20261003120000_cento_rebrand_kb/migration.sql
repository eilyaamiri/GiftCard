-- CENTO rebrand: the help-centre copy seeded by 20260924190000_kb.
--
-- Data only; no table changes. Scoped deliberately:
--   * only the rows that migration seeded, by id, so an article an admin wrote
--     later is never rewritten behind their back;
--   * only the knowledge base, which is marketing copy. Orders, payments,
--     audit and every other historical record keep the name they were created
--     under.
-- Row ids (kb_art_what_is_barat, ...) are internal keys and stay as they are.
-- The old public slug is answered by a permanent redirect in apps/web.

UPDATE "KbCategory"
SET "name" = 'شروع کار با سنتو', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'kb_cat_getting_started' AND "name" = 'شروع کار';

UPDATE "KbCategory"
SET "description" = REPLACE("description", 'برات', 'سنتو'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN ('kb_cat_getting_started', 'kb_cat_orders', 'kb_cat_gift_cards', 'kb_cat_support')
  AND "description" LIKE '%برات%';

UPDATE "KbArticle"
SET "title"   = REPLACE("title", 'برات', 'سنتو'),
    "excerpt" = REPLACE("excerpt", 'برات', 'سنتو'),
    "content" = REPLACE("content", 'برات', 'سنتو'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN ('kb_art_what_is_barat', 'kb_art_create_account', 'kb_art_payment_methods', 'kb_art_failed_order',
               'kb_art_how_to_redeem', 'kb_art_invalid_code', 'kb_art_contact_support', 'kb_art_refund_policy')
  AND ("title" LIKE '%برات%' OR "excerpt" LIKE '%برات%' OR "content" LIKE '%برات%');

UPDATE "KbArticle" AS a
SET "slug" = 'what-is-cento', "updatedAt" = CURRENT_TIMESTAMP
WHERE a."id" = 'kb_art_what_is_barat' AND a."slug" = 'what-is-barat'
  AND NOT EXISTS (
    SELECT 1 FROM "KbArticle" AS b WHERE b."categoryId" = a."categoryId" AND b."slug" = 'what-is-cento'
  );
