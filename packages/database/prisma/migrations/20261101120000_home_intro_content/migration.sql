-- Starter copy for the home page's text section.
--
-- Data only; no table changes. The storefront renders the KB article
-- `site-content` / `home-intro` under the home page's «سه قدم تا مقصد» block
-- (apps/web/src/components/home-intro.tsx). `/help` and the sitemap skip the
-- `site-content` category, so this is never listed as a help article.
--
-- Safe to re-run and safe after staff have edited it: both inserts do nothing
-- when the row already exists, so a later edit made in the admin panel is
-- never overwritten. Staff change the text from the knowledge-base panel.
--
-- Facts stated in the copy, as given by the owner on 2026-11-01: codes are
-- delivered instantly, and support runs 24 hours a day, 7 days a week.
-- International service payment is hidden (apps/web/src/lib/features.ts), so it
-- is not mentioned; add it to this article when that feature is switched on.

INSERT INTO "KbCategory" ("id", "slug", "name", "description", "icon", "isEnabled", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('kb_cat_site_content', 'site-content', 'متن صفحات سایت', 'متن‌هایی که در خود صفحات سایت نمایش داده می‌شوند و در بخش راهنما دیده نمی‌شوند.', 'book-open', true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "KbArticle" ("id", "categoryId", "slug", "title", "excerpt", "content", "isEnabled", "isPromoted", "sortOrder", "createdAt", "updatedAt")
SELECT
    'kb_art_home_intro',
    c."id",
    'home-intro',
    'خرید گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس، شارژ بازی و تلگرام با ریال',
    'سنتو؛ گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس، شارژ مستقیم بازی و تلگرام با پرداخت ریالی، تحویل کد در لحظه و پشتیبانی ۲۴ ساعته.',
    $md$سنتو فروشگاه آنلاین گیفت‌کارت و شارژ مستقیم است. گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس، شارژ بازی‌ها و استارز و پرمیوم تلگرام را با ریال و از درگاه‌های پرداخت داخلی بخرید. قیمت نهایی را پیش از پرداخت می‌بینید و کد سفارش در لحظه تحویل داده می‌شود.

## گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس

در [فروشگاه گیفت‌کارت](/gift-cards) می‌توانید گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس را با مبلغ و منطقه‌ی دلخواه پیدا کنید و بدون کارت بین‌المللی با ریال بخرید. هر گیفت‌کارت برای یک منطقه (ریجن) صادر می‌شود؛ پیش از خرید مطمئن شوید منطقه‌ی کارت با منطقه‌ی حساب شما یکی است، وگرنه کد روی حساب فعال نمی‌شود. اگر درباره‌ی ریدیم کد یا مشکلی در کارت سؤال دارید، [راهنمای سنتو](/help) پاسخ‌های رایج را دارد.

## شارژ استیم و شارژ مستقیم بازی‌ها

برای بعضی بازی‌ها لازم نیست کدی دریافت و وارد کنید. در بخش [شارژ بازی](/games) شناسه‌ی حساب خودتان را وارد می‌کنید و شارژ مستقیم روی همان حساب انجام می‌شود. موجودی استیم را هم از صفحه‌ی [شارژ استیم](/steam) تأمین کنید.

## استارز و پرمیوم تلگرام

[استارز و پرمیوم تلگرام](/telegram) را برای حساب خودتان بخرید: [خرید استارز تلگرام](/telegram/stars) و [خرید پرمیوم تلگرام](/telegram/premium) هرکدام صفحه‌ی خودشان را دارند.

## چرا سنتو؟

- **تحویل کد در لحظه:** کد سفارش بعد از پرداخت بلافاصله تحویل داده می‌شود.
- **قیمت شفاف:** قیمت نهایی را پیش از پرداخت می‌بینید.
- **پرداخت امن:** پرداخت از درگاه‌های داخلی انجام می‌شود.
- **پیگیری سفارش:** وضعیت هر سفارش را از پنل کاربری دنبال می‌کنید.
- **پشتیبانی ۲۴ ساعته، ۷ روز هفته:** هر ساعت از شبانه‌روز می‌توانید از پنل کاربری تیکت ثبت کنید.$md$,
    true,
    false,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KbCategory" c
WHERE c."slug" = 'site-content'
ON CONFLICT DO NOTHING;
