-- Starter copy for the two service-list category pages that exist today:
-- `games` («بازی‌ها») and `utility-software` («نرم‌افزارهای کاربردی»), seeded by
-- 20261005120000_service_categories.
--
-- Data only; no table changes. The storefront renders the KB article
-- `site-content` / `category-<category slug>` under a service-list category
-- page (apps/web/src/app/categories/[slug]/page.tsx). Runs after
-- 20261101120000_home_intro_content, which creates the `site-content` category.
--
-- Safe to re-run and safe after staff have edited it: both inserts do nothing
-- when the row already exists, so a later edit made in the admin panel is
-- never overwritten. A category an operator adds later gets its text by
-- creating an article named `category-<slug>` in the same panel.
--
-- These pages list links an operator curates, so what they hold is not known
-- here. The copy therefore names no product, game, price or delivery time, and
-- claims only what the owner confirmed on 2026-11-01 (24/7 support) and what the
-- storefront already says (final price shown before payment, domestic payment
-- gateways, order tracking from the account panel). Add specifics from the
-- admin panel once the lists are final. International service payment is hidden
-- (apps/web/src/lib/features.ts), so it is not mentioned.

INSERT INTO "KbArticle" ("id", "categoryId", "slug", "title", "excerpt", "content", "isEnabled", "isPromoted", "sortOrder", "createdAt", "updatedAt")
SELECT
    'kb_art_category_games',
    c."id",
    'category-games',
    'شارژ و خرید برای بازی‌ها با ریال',
    'بازی مورد نظرتان را از فهرست انتخاب کنید و با ریال و قیمت شفاف سفارش بدهید.',
    $md$در این صفحه بازی‌هایی را می‌بینید که می‌توانید در سنتو با ریال برایشان سفارش بدهید. هر مورد صفحه‌ی خودش را دارد؛ بازی را از فهرست بالا باز کنید، بسته یا مبلغ را انتخاب کنید و قیمت نهایی را پیش از پرداخت ببینید.

## با ریال پرداخت کنید

پرداخت از درگاه‌های داخلی انجام می‌شود و برای سفارش به کارت بین‌المللی نیازی ندارید. بعد از ثبت سفارش، وضعیت آن را از پنل کاربری دنبال می‌کنید.

## بازی مورد نظرم اینجا نیست

برای شارژ مستقیم حساب بازی، فهرست کامل [شارژ مستقیم بازی](/games) را ببینید. اگر کد می‌خواهید، [گیفت‌کارت‌ها](/gift-cards) شامل گیفت‌کارت استیم، پلی‌استیشن و ایکس‌باکس است، و موجودی استیم را از صفحه‌ی [شارژ استیم](/steam) تأمین می‌کنید. اگر درباره‌ی نحوه‌ی استفاده سؤال دارید، [راهنمای سنتو](/help) پاسخ‌های رایج را دارد.

## پشتیبانی ۲۴ ساعته، ۷ روز هفته

اگر سفارشی به مشکل خورد یا سؤالی دارید، هر ساعت از شبانه‌روز می‌توانید از پنل کاربری تیکت ثبت کنید.$md$,
    true,
    false,
    3,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KbCategory" c
WHERE c."slug" = 'site-content'
ON CONFLICT DO NOTHING;

INSERT INTO "KbArticle" ("id", "categoryId", "slug", "title", "excerpt", "content", "isEnabled", "isPromoted", "sortOrder", "createdAt", "updatedAt")
SELECT
    'kb_art_category_utility_software',
    c."id",
    'category-utility-software',
    'نرم‌افزارهای کاربردی با پرداخت ریالی',
    'نرم‌افزار یا ابزار مورد نظرتان را از فهرست انتخاب کنید و با ریال و قیمت شفاف سفارش بدهید.',
    $md$در این صفحه نرم‌افزارها و ابزارهای کاربردی را می‌بینید که می‌توانید در سنتو با ریال سفارش بدهید. هر مورد صفحه‌ی خودش را دارد؛ آن را از فهرست بالا باز کنید و قیمت نهایی را پیش از پرداخت ببینید.

## با ریال پرداخت کنید

پرداخت از درگاه‌های داخلی انجام می‌شود و برای سفارش به کارت بین‌المللی نیازی ندارید. بعد از ثبت سفارش، وضعیت آن را از پنل کاربری دنبال می‌کنید.

## مورد مورد نظرم اینجا نیست

[گیفت‌کارت‌ها](/gift-cards) و [شارژ مستقیم بازی](/games) را هم ببینید، و برای استارز و پرمیوم، صفحه‌ی [تلگرام](/telegram) را. اگر درباره‌ی سفارش سؤال دارید، [راهنمای سنتو](/help) پاسخ‌های رایج را دارد.

## پشتیبانی ۲۴ ساعته، ۷ روز هفته

اگر سفارشی به مشکل خورد یا سؤالی دارید، هر ساعت از شبانه‌روز می‌توانید از پنل کاربری تیکت ثبت کنید.$md$,
    true,
    false,
    4,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KbCategory" c
WHERE c."slug" = 'site-content'
ON CONFLICT DO NOTHING;
