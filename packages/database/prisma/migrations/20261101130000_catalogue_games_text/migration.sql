-- Starter copy for the text under the gift-card catalogue and the games shelf.
--
-- Data only; no table changes. The storefront renders the KB articles
-- `site-content` / `gift-cards-page` and `games-page` under those pages
-- (apps/web/src/components/site-text.tsx). The catalogue shows its text only
-- when no filter is active. Runs after 20261101120000_home_intro_content, which
-- creates the `site-content` category.
--
-- Safe to re-run and safe after staff have edited it: both inserts do nothing
-- when the row already exists, so a later edit made in the admin panel is
-- never overwritten.
--
-- Facts stated in the copy, as given by the owner on 2026-11-01: codes are
-- delivered instantly, support runs 24 hours a day, 7 days a week, and the
-- brands are Apple, Steam, PlayStation, Xbox, Telegram and direct game top-up.
-- Nothing else is claimed: no game titles, denominations, prices or regions
-- beyond what the storefront already says. International service payment is
-- hidden (apps/web/src/lib/features.ts), so it is not mentioned.

INSERT INTO "KbArticle" ("id", "categoryId", "slug", "title", "excerpt", "content", "isEnabled", "isPromoted", "sortOrder", "createdAt", "updatedAt")
SELECT
    'kb_art_gift_cards_page',
    c."id",
    'gift-cards-page',
    'خرید گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس با ریال',
    'گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس با پرداخت ریالی و تحویل کد در لحظه.',
    $md$در سنتو گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس را با ریال و از درگاه‌های پرداخت داخلی می‌خرید، بدون نیاز به کارت بین‌المللی. قیمت نهایی را پیش از پرداخت می‌بینید و کد سفارش در لحظه تحویل داده می‌شود.

## چطور گیفت‌کارت مناسب را انتخاب کنم؟

برند، مبلغ و منطقه‌ی کارت را از فیلترهای همین صفحه انتخاب کنید. هر گیفت‌کارت برای یک منطقه (ریجن) صادر می‌شود؛ پیش از خرید مطمئن شوید منطقه‌ی کارت با منطقه‌ی حساب شما یکی است، وگرنه کد روی حساب فعال نمی‌شود. بعد از خرید، کد را در پنل کاربری خود می‌بینید. اگر درباره‌ی ریدیم کد یا مشکلی در کارت سؤال دارید، [راهنمای سنتو](/help) پاسخ‌های رایج را دارد.

## گیفت‌کارت یا شارژ مستقیم؟

گیفت‌کارت یک کد تحویل می‌دهد که خودتان روی حساب وارد می‌کنید. اگر نمی‌خواهید کدی وارد کنید، [شارژ مستقیم بازی](/games) را ببینید: شناسه‌ی حساب بازی را می‌دهید و شارژ روی همان حساب انجام می‌شود. موجودی استیم را هم از صفحه‌ی [شارژ استیم](/steam) تأمین کنید. برای استارز و پرمیوم هم [تلگرام](/telegram) صفحه‌ی جداگانه دارد.

## چرا سنتو؟

- **تحویل کد در لحظه:** کد سفارش بعد از پرداخت بلافاصله تحویل داده می‌شود.
- **قیمت شفاف:** قیمت نهایی را پیش از پرداخت می‌بینید.
- **پرداخت امن:** پرداخت از درگاه‌های داخلی انجام می‌شود.
- **پشتیبانی ۲۴ ساعته، ۷ روز هفته:** هر ساعت از شبانه‌روز می‌توانید از پنل کاربری تیکت ثبت کنید.$md$,
    true,
    false,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KbCategory" c
WHERE c."slug" = 'site-content'
ON CONFLICT DO NOTHING;

INSERT INTO "KbArticle" ("id", "categoryId", "slug", "title", "excerpt", "content", "isEnabled", "isPromoted", "sortOrder", "createdAt", "updatedAt")
SELECT
    'kb_art_games_page',
    c."id",
    'games-page',
    'شارژ مستقیم بازی با ریال، بدون کد و بدون رمز عبور',
    'شارژ مستقیم حساب بازی با شناسه‌ی بازیکن و پرداخت ریالی؛ قیمت نهایی پیش از پرداخت.',
    $md$در سنتو حساب بازی‌تان را مستقیم و با ریال شارژ می‌کنید. لازم نیست کدی دریافت و وارد کنید و رمز عبور حساب بازی را هم به ما نمی‌دهید: بازی را انتخاب می‌کنید، بسته را برمی‌گزینید، شناسه‌ی بازیکن را وارد می‌کنید و قیمت نهایی را پیش از پرداخت می‌بینید.

## شارژ مستقیم چطور کار می‌کند؟

1. از فهرست بالا بازی مورد نظرتان را باز کنید.
2. بسته را انتخاب کنید و مشخصات حساب بازی را وارد کنید.
3. قیمت نهایی را ببینید و با ریال، از درگاه‌های پرداخت داخلی، پرداخت کنید.
4. بعد از تأیید پرداخت، شارژ خودکار و مستقیم روی همان حساب انجام می‌شود.

اگر شارژ با مشکل روبه‌رو شود، سفارش برای پیگیری ثبت می‌شود و پشتیبانی تا انجام شارژ یا بازگشت وجه آن را دنبال می‌کند.

## شارژ مستقیم یا گیفت‌کارت؟

شارژ مستقیم برای کسی است که نمی‌خواهد کدی را روی حسابش وارد کند. اگر کد می‌خواهید، [گیفت‌کارت اپل، استیم، پلی‌استیشن و ایکس‌باکس](/gift-cards) را با تحویل کد در لحظه بخرید. موجودی استیم از صفحه‌ی [شارژ استیم](/steam) تأمین می‌شود، و برای [استارز و پرمیوم تلگرام](/telegram) هم صفحه‌ی جداگانه داریم.

## چرا سنتو؟

- **قیمت شفاف:** قیمت نهایی را پیش از پرداخت می‌بینید.
- **بدون رمز عبور:** فقط شناسه‌ی بازیکن لازم است.
- **پرداخت امن:** پرداخت از درگاه‌های داخلی انجام می‌شود.
- **پشتیبانی ۲۴ ساعته، ۷ روز هفته:** هر ساعت از شبانه‌روز می‌توانید از پنل کاربری تیکت ثبت کنید.$md$,
    true,
    false,
    2,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "KbCategory" c
WHERE c."slug" = 'site-content'
ON CONFLICT DO NOTHING;
