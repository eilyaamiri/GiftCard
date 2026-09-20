-- Catalog taxonomy: real Brand and Category rows, and a backfill of the 2406
-- products the Reloadly import left with only two free-text columns to their
-- name.
--
-- Nothing is deleted and nothing is deactivated here. Products that cannot be
-- classified confidently keep their row, land in «سایر» and are flagged
-- `needsReview` so an operator can see exactly what the rules could not decide.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "isQuickPick" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "logoUrl" TEXT,
    "descriptionFa" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL DEFAULT 'gift',
    "descriptionFa" TEXT,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_isActive_sortOrder_idx" ON "Brand"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Brand_isPopular_isActive_sortOrder_idx" ON "Brand"("isPopular", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_isActive_sortOrder_idx" ON "Category"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "ProductCategory_categoryId_idx" ON "ProductCategory"("categoryId");

-- CreateIndex
CREATE INDEX "Product_categoryId_isActive_sortOrder_idx" ON "Product"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_brandId_isActive_sortOrder_idx" ON "Product"("brandId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_isActive_needsReview_idx" ON "Product"("isActive", "needsReview");

-- CreateIndex
CREATE INDEX "Product_isQuickPick_isActive_sortOrder_idx" ON "Product"("isQuickPick", "isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Seed: the category set
--
-- `iconKey` names an icon the web app already ships (lucide-react). The list is
-- closed: the admin picks from it, so a category can never introduce an icon
-- drawn in a different style from the rest of the site.
-- ===========================================================================
INSERT INTO "Category" ("id", "slug", "name", "nameFa", "iconKey", "sortOrder", "updatedAt") VALUES
  ('cat_popular',       'popular',       'Popular',                   'عمومی و پرکاربرد',            'sparkles',     10, now()),
  ('cat_gaming',        'gaming',        'Gaming',                    'بازی و گیم',                  'gamepad-2',    20, now()),
  ('cat_console',       'console',       'Console',                   'کنسول',                       'joystick',     30, now()),
  ('cat_entertainment', 'entertainment', 'Entertainment & Streaming', 'سرگرمی و استریم',             'clapperboard', 40, now()),
  ('cat_shopping',      'shopping',      'Shopping',                  'فروشگاهی و خرید',             'shopping-bag', 50, now()),
  ('cat_mobile',        'mobile',        'Mobile & Connectivity',     'موبایل و ارتباطات',           'smartphone',   60, now()),
  ('cat_software',      'software',      'Software & Online Services','نرم‌افزار و سرویس‌های آنلاین', 'app-window',   70, now()),
  ('cat_education',     'education',     'Education & Books',         'آموزش و کتاب',                'book-open',    80, now()),
  ('cat_food',          'food',          'Food & Dining',             'غذا و رستوران',               'utensils',     90, now()),
  ('cat_travel',        'travel',        'Travel',                    'سفر',                         'plane',       100, now()),
  ('cat_sports',        'sports',        'Sports',                    'ورزش',                        'dumbbell',    110, now()),
  ('cat_electronics',   'electronics',   'Electronics',               'الکترونیک',                   'cpu',         120, now()),
  ('cat_home',          'home',          'Home & Lifestyle',          'خانه و سبک زندگی',            'sofa',        130, now()),
  ('cat_beauty',        'beauty',        'Beauty & Health',           'زیبایی و سلامت',              'flower-2',    140, now()),
  ('cat_prepaid',       'prepaid',       'Credit & Prepaid Cards',    'کارت‌های اعتباری و Prepaid',  'credit-card', 150, now()),
  ('cat_virtual',       'virtual',       'Virtual Cards',             'کارت‌های مجازی',              'wallet',      160, now()),
  ('cat_other',         'other',         'Other',                     'سایر',                        'ellipsis',    170, now());

-- ===========================================================================
-- Seed: brands, derived from the import
--
-- One row per brand as customers know it, not per spelling: the feed contains
-- both "NetFlix" and "Netflix", and both "Google Play" and "Google play". The
-- spelling carried by the most products wins, ties broken alphabetically so the
-- result does not depend on row order.
-- ===========================================================================
WITH spelling AS (
  SELECT "brand", count(*) AS products FROM "Product" GROUP BY 1
), canonical AS (
  SELECT lower("brand") AS key,
         (array_agg("brand" ORDER BY products DESC, "brand"))[1] AS name
  FROM spelling GROUP BY 1
), slugged AS (
  SELECT key, name,
         COALESCE(
           NULLIF(trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), ''),
           'brand'
         ) AS base
  FROM canonical
), deduped AS (
  SELECT key, name, base,
         row_number() OVER (PARTITION BY base ORDER BY name) AS collision
  FROM slugged
)
INSERT INTO "Brand" ("id", "slug", "name", "nameFa", "updatedAt")
SELECT
  'brnd_' || CASE WHEN collision = 1 THEN base ELSE base || '-' || collision END,
  CASE WHEN collision = 1 THEN base ELSE base || '-' || collision END,
  name,
  -- A brand name is transliterated, not translated, and inventing a Persian
  -- spelling for 300 unfamiliar retailers would be guesswork on the storefront.
  -- The well-known ones get a real Persian name just below; the rest keep their
  -- Latin name until an operator supplies one.
  name,
  now()
FROM deduped;

-- The spelling carried by the most products is not always the brand's own:
-- the feed spells Netflix "NetFlix" on 17 of its 18 products, and Google Play
-- "Google play" on 12 of 13. Both columns are corrected here.
UPDATE "Brand" SET "name" = v.name, "nameFa" = v.name_fa
FROM (VALUES
  ('apple',            'Apple',            'اپل'),
  ('amazon',           'Amazon',           'آمازون'),
  ('google play',      'Google Play',      'گوگل پلی'),
  ('playstation',      'PlayStation',      'پلی‌استیشن'),
  ('xbox',             'Xbox',             'ایکس‌باکس'),
  ('nintendo',         'Nintendo',         'نینتندو'),
  ('steam',            'Steam',            'استیم'),
  ('netflix',          'Netflix',          'نتفلیکس'),
  ('spotify',          'Spotify',          'اسپاتیفای'),
  ('roblox',           'Roblox',           'رابلاکس'),
  ('razer gold',       'Razer Gold',       'ریزر گلد'),
  ('free fire',        'Free Fire',        'فری فایر'),
  ('mobile legends',   'Mobile Legends',   'موبایل لجندز'),
  ('pubg',             'PUBG',             'پابجی'),
  ('minecraft',        'Minecraft',        'ماینکرفت'),
  ('twitch',           'Twitch',           'توییچ'),
  ('tinder',           'Tinder',           'تیندر'),
  ('uber',             'Uber',             'اوبر'),
  ('airbnb',           'Airbnb',           'ایربی‌ان‌بی'),
  ('nike',             'Nike',             'نایکی'),
  ('adidas',           'Adidas',           'آدیداس'),
  ('decathlon',        'Decathlon',        'دکتلون'),
  ('ikea',             'IKEA',             'آیکیا'),
  ('starbucks',        'Starbucks',        'استارباکس'),
  ('sephora',          'Sephora',          'سفورا'),
  ('shein',            'SHEIN',            'شی‌این'),
  ('zalando',          'Zalando',          'زالاندو'),
  ('huawei',           'HUAWEI',           'هوآوی'),
  ('mastercard',       'Mastercard',       'مسترکارت'),
  ('american express', 'American Express', 'امریکن اکسپرس'),
  ('paysafe card',     'Paysafe Card',     'پی‌سیف کارت'),
  ('binance',          'Binance',          'بایننس'),
  ('crypto voucher',   'Crypto Voucher',   'کریپتو واچر')
) AS v(key, name, name_fa)
WHERE lower("Brand"."name") = v.key;

-- Popular brands, curated rather than computed: there are no sales or traffic
-- figures in this database to rank by, and a made-up ranking would be worse
-- than an operator's judgement. Every brand listed here is present in the
-- catalog — the flag is editable from the admin panel.
UPDATE "Brand" SET "isPopular" = true
WHERE lower("name") IN (
  'apple', 'amazon', 'google play', 'playstation', 'xbox', 'nintendo',
  'steam', 'netflix', 'spotify', 'roblox', 'razer gold', 'free fire',
  'mobile legends'
);

UPDATE "Product" p SET "brandId" = b."id"
FROM "Brand" b WHERE lower(b."name") = lower(p."brand");

-- ===========================================================================
-- Backfill: primary and secondary categories
--
-- Rules are matched against "<brand> <title>", lowest priority number first,
-- and the first match becomes the primary category. The supplier's own
-- category is the fallback, and anything still unmatched goes to «سایر»
-- flagged for review rather than being hidden.
-- ===========================================================================
-- A plain table rather than a temporary one: whether Prisma wraps a migration
-- in a transaction is not something this file should depend on, and an
-- `ON COMMIT DROP` table outside one would vanish before the next statement.
-- It is dropped at the end of the migration.
CREATE TABLE _taxonomy_rule (priority INT, pattern TEXT, slug TEXT);

INSERT INTO _taxonomy_rule (priority, pattern, slug) VALUES
  -- Console platforms win over the generic gaming rules below them.
  (10, '%playstation%', 'console'), (10, '%psn%', 'console'), (10, '%xbox%', 'console'),
  (10, '%nintendo%', 'console'), (10, '%game pass%', 'console'),

  (20, '%steam%', 'gaming'), (20, '%roblox%', 'gaming'), (20, '%minecraft%', 'gaming'),
  (20, '%pubg%', 'gaming'), (20, '%free fire%', 'gaming'), (20, '%riot%', 'gaming'),
  (20, '%valorant%', 'gaming'), (20, '%league of legends%', 'gaming'), (20, '%razer%', 'gaming'),
  (20, '%blizzard%', 'gaming'), (20, '%battle.net%', 'gaming'), (20, '%epic games%', 'gaming'),
  (20, '%ea play%', 'gaming'), (20, '%ubisoft%', 'gaming'), (20, '%garena%', 'gaming'),
  (20, '%mobile legends%', 'gaming'), (20, '%jawaker%', 'gaming'), (20, '%netdragon%', 'gaming'),
  (20, '%molek%', 'gaming'), (20, '%big point%', 'gaming'), (20, '%fortnite%', 'gaming'),
  (20, '%genshin%', 'gaming'), (20, '%call of duty%', 'gaming'), (20, '%clash of%', 'gaming'),
  (20, '%world of warcraft%', 'gaming'), (20, '%diamond%', 'gaming'),
  (20, '%gaming%', 'gaming'), (20, '%gamivo%', 'gaming'), (20, '%nexon%', 'gaming'),

  (30, '%netflix%', 'entertainment'), (30, '%spotify%', 'entertainment'),
  (30, '%twitch%', 'entertainment'), (30, '%disney%', 'entertainment'),
  (30, '%hulu%', 'entertainment'), (30, '%hbo%', 'entertainment'),
  (30, '%paramount%', 'entertainment'), (30, '%starz%', 'entertainment'),
  (30, '%anghami%', 'entertainment'), (30, '%deezer%', 'entertainment'),
  (30, '%tidal%', 'entertainment'), (30, '%apple music%', 'entertainment'),
  (30, '%youtube%', 'entertainment'), (30, '%crunchyroll%', 'entertainment'),
  (30, '%shahid%', 'entertainment'), (30, '%cinema%', 'entertainment'),
  (30, '%theatre%', 'entertainment'), (30, '%theater%', 'entertainment'),
  (30, '%ticketmaster%', 'entertainment'), (30, '%atom tickets%', 'entertainment'),
  (30, '%tinder%', 'entertainment'), (30, '%bumble%', 'entertainment'),
  (30, '%mubi%', 'entertainment'), (30, '%viu%', 'entertainment'),
  (30, '%osn %', 'entertainment'), (30, '%abbonamenti%', 'entertainment'),

  (40, '%restaurant%', 'food'), (40, '%pizza%', 'food'), (40, '%grill%', 'food'),
  (40, '%steakhouse%', 'food'), (40, '%burger%', 'food'), (40, '%coffee%', 'food'),
  (40, '%starbucks%', 'food'), (40, '%dining%', 'food'), (40, '%deliveroo%', 'food'),
  (40, '%doordash%', 'food'), (40, '%uber eats%', 'food'), (40, '%wings%', 'food'),
  (40, '%brewhouse%', 'food'), (40, '%lobster%', 'food'), (40, '%applebee%', 'food'),
  (40, '%outback%', 'food'), (40, '%bahama breeze%', 'food'), (40, '%bonefish%', 'food'),
  (40, '%landry%', 'food'), (40, '%brinker%', 'food'), (40, '%chili''s%', 'food'),
  (40, '%olive garden%', 'food'), (40, '%cheesecake%', 'food'), (40, '%dunkin%', 'food'),
  (40, '%domino%', 'food'), (40, '%kfc%', 'food'), (40, '%mcdonald%', 'food'),
  (40, '%subway%', 'food'), (40, '%taco%', 'food'), (40, '%sushi%', 'food'),
  (40, '%bistro%', 'food'), (40, '%bakery%', 'food'), (40, '%panera%', 'food'),
  (40, '%pizzaria%', 'food'), (40, '%chifa%', 'food'), (40, '%wagamama%', 'food'),
  (40, '%nando%', 'food'), (40, '%papa john%', 'food'), (40, '%popeyes%', 'food'),
  (40, '%wendy%', 'food'), (40, '%just eat%', 'food'), (40, '%ifood%', 'food'),

  (50, '%sephora%', 'beauty'), (50, '%bath & body%', 'beauty'), (50, '%cosmetic%', 'beauty'),
  (50, '%beauty%', 'beauty'), (50, '%perfum%', 'beauty'), (50, '%skincare%', 'beauty'),
  (50, '%ulta%', 'beauty'), (50, '%the body shop%', 'beauty'), (50, '%douglas%', 'beauty'),
  (50, '%yves rocher%', 'beauty'), (50, '%pharmac%', 'beauty'), (50, '%nocibe%', 'beauty'),

  (60, '%nike%', 'sports'), (60, '%adidas%', 'sports'), (60, '%decathlon%', 'sports'),
  (60, '%golf%', 'sports'), (60, '%sport%', 'sports'), (60, '%fitness%', 'sports'),
  (60, '%athlet%', 'sports'), (60, '%puma%', 'sports'), (60, '%under armour%', 'sports'),
  (60, '%reebok%', 'sports'), (60, '%asics%', 'sports'), (60, '%bass pro%', 'sports'),
  (60, '%cabela%', 'sports'), (60, '%foot locker%', 'sports'), (60, '%intersport%', 'sports'),

  -- Not '%book%': that also catches Booking.com and Facebook.
  (70, '%barnes & noble%', 'education'), (70, '%bookstore%', 'education'),
  (70, '%bookshop%', 'education'), (70, '%books%', 'education'),
  (70, '%audible%', 'education'), (70, '%kindle%', 'education'), (70, '%udemy%', 'education'),
  (70, '%coursera%', 'education'), (70, '%skillshare%', 'education'), (70, '%kobo%', 'education'),
  (70, '%scribd%', 'education'), (70, '%waterstones%', 'education'), (70, '%duolingo%', 'education'),

  (80, '%airalo%', 'mobile'), (80, '%esim%', 'mobile'), (80, '%sim card%', 'mobile'),
  (80, '%top-up%', 'mobile'), (80, '%topup%', 'mobile'), (80, '%recharge%', 'mobile'),
  (80, '%airtime%', 'mobile'), (80, '%vodafone%', 'mobile'), (80, '%lycamobile%', 'mobile'),
  (80, '%lebara%', 'mobile'), (80, '%giffgaff%', 'mobile'), (80, '%t-mobile%', 'mobile'),
  (80, '%etisalat%', 'mobile'), (80, '%telecom%', 'mobile'), (80, '%mtn %', 'mobile'),

  (90, '%best buy%', 'electronics'), (90, '%currys%', 'electronics'),
  (90, '%media markt%', 'electronics'), (90, '%mediamarkt%', 'electronics'),
  (90, '%newegg%', 'electronics'), (90, '%electronic%', 'electronics'),
  (90, '%samsung%', 'electronics'), (90, '%huawei%', 'electronics'),
  (90, '%xiaomi%', 'electronics'), (90, '%lenovo%', 'electronics'),
  (90, '%jb hi-fi%', 'electronics'), (90, '%fnac%', 'electronics'),
  (90, '%euronics%', 'electronics'), (90, '%conrad%', 'electronics'),

  (100, '%ikea%', 'home'), (100, '%furniture%', 'home'), (100, '%cb2%', 'home'),
  (100, '%crate%', 'home'), (100, '%wayfair%', 'home'), (100, '%bed bath%', 'home'),
  (100, '%homesense%', 'home'), (100, '%garden%', 'home'), (100, '%leroy merlin%', 'home'),
  (100, '%hornbach%', 'home'), (100, '%castorama%', 'home'), (100, '%b&q%', 'home'),
  (100, '%maison%', 'home'), (100, '%home depot%', 'home'),

  (110, '%crypto%', 'virtual'), (110, '%bitcoin%', 'virtual'), (110, '%binance%', 'virtual'),
  (110, '%usdt%', 'virtual'), (110, '%bitfy%', 'virtual'), (110, '%ethereum%', 'virtual'),

  (120, '%mastercard%', 'prepaid'), (120, '%american express%', 'prepaid'),
  (120, '%amex%', 'prepaid'), (120, '%paysafe%', 'prepaid'), (120, '%prepaid%', 'prepaid'),
  (120, '%neosurf%', 'prepaid'), (120, '%flexepin%', 'prepaid'), (120, '%cashlib%', 'prepaid'),
  (120, '%visa %', 'prepaid'),

  (130, '%airbnb%', 'travel'), (130, '%hotel%', 'travel'), (130, '%flight%', 'travel'),
  (130, '%airline%', 'travel'), (130, '%booking%', 'travel'), (130, '%expedia%', 'travel'),
  (130, '%travel%', 'travel'), (130, '%uber%', 'travel'), (130, '%lyft%', 'travel'),
  (130, '%flixbus%', 'travel'), (130, '%rail%', 'travel'), (130, '%cruise%', 'travel'),
  (130, '%tours%', 'travel'), (130, '%rentacar%', 'travel'), (130, '%car rental%', 'travel'),
  (130, '%vacation%', 'travel'), (130, '%holiday%', 'travel'), (130, '%atrapalo%', 'travel'),
  (130, '%best western%', 'travel'), (130, '%flystay%', 'travel'),

  (140, '%microsoft%', 'software'), (140, '%office 365%', 'software'),
  (140, '%adobe%', 'software'), (140, '%norton%', 'software'), (140, '%mcafee%', 'software'),
  (140, '%kaspersky%', 'software'), (140, '%antivirus%', 'software'), (140, '%vpn%', 'software'),
  (140, '%hosting%', 'software'), (140, '%canva%', 'software'), (140, '%dropbox%', 'software'),
  (140, '%google one%', 'software'), (140, '%icloud%', 'software'), (140, '%openai%', 'software'),
  (140, '%github%', 'software'),

  -- The three store-credit brands that belong everywhere and nowhere.
  (150, '%apple%', 'popular'), (150, '%itunes%', 'popular'),
  (150, '%amazon%', 'popular'), (150, '%google play%', 'popular');

-- Several patterns can point at the same category; `min(priority)` collapses
-- them so a category is ranked once, by its strongest match.
CREATE VIEW _taxonomy_match AS
SELECT product_id, slug,
       row_number() OVER (PARTITION BY product_id ORDER BY priority, slug) AS rank
FROM (
  SELECT p."id" AS product_id, r.slug, min(r.priority) AS priority
  FROM "Product" p
  JOIN _taxonomy_rule r ON (p."brand" || ' ' || p."title") ILIKE r.pattern
  GROUP BY 1, 2
) best;

UPDATE "Product" p SET "categoryId" = c."id"
FROM _taxonomy_match m
JOIN "Category" c ON c."slug" = m.slug
WHERE p."id" = m.product_id AND m.rank = 1;

-- Whatever the rules could not name, the supplier's own category still can.
UPDATE "Product" p SET "categoryId" = c."id"
FROM (VALUES
  ('Gaming',        'gaming'),
  ('Shopping',      'shopping'),
  ('Crypto',        'virtual'),
  ('Entertainment', 'entertainment'),
  ('Travel',        'travel'),
  ('Payment Cards', 'prepaid'),
  ('Software',      'software'),
  ('gift-card',     'popular')
) AS raw(supplier_category, slug)
JOIN "Category" c ON c."slug" = raw.slug
WHERE p."categoryId" IS NULL AND p."category" = raw.supplier_category;

-- Still nothing. The brief is explicit that no product is left uncategorised
-- and none is hidden for it, so these go to «سایر» and wait for an operator.
UPDATE "Product" SET "categoryId" = 'cat_other', "needsReview" = true
WHERE "categoryId" IS NULL;

-- Secondary categories: the second and third rule matches, when they differ
-- from the primary one. A Steam card is a game and a software service.
-- Secondary categories are deliberately left empty for an operator to fill.
-- Taking the rules' second and third matches was tried and produced five rows,
-- all of them wrong: '%apple%' matched Applebee's, '%garden%' matched Olive
-- Garden. The primary category survives a loose pattern because a stronger
-- rule outranks it; a secondary category has nothing to outrank it.
DROP VIEW _taxonomy_match;
DROP TABLE _taxonomy_rule;

-- ===========================================================================
-- Flag what an operator has to finish before these can be sold
-- ===========================================================================

-- No brand row could be matched, or no picture to put on the card.
UPDATE "Product" SET "needsReview" = true
WHERE "brandId" IS NULL OR "imageUrl" IS NULL OR "imageUrl" = '';

-- No variant at all, or no variant any supplier currently offers: there is
-- nothing to price, so the product can be browsed but not bought.
UPDATE "Product" p SET "needsReview" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "Sku" s
  JOIN "SupplierOffer" o ON o."skuId" = s."id" AND o."isActive"
  WHERE s."productId" = p."id"
);

-- Two products with the same brand and the same title are the same card to a
-- customer. They are not merged here — merging loses rows, and the brief says
-- nothing may be removed without a report — but both are flagged.
UPDATE "Product" p SET "needsReview" = true
FROM (
  SELECT "brand", "title" FROM "Product" GROUP BY 1, 2 HAVING count(*) > 1
) dup
WHERE p."brand" = dup."brand" AND p."title" = dup."title";
