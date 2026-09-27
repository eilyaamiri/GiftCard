# ReSellCodes (resell.codes) — سرویس‌دهنده‌ی جدید

## وضعیت

این سند فقط طراحی و دستورالعمل پیاده‌سازی است؛ هنوز هیچ اتصال ReSellCodes، تغییری در دیتابیس، یا تغییر UI انجام نشده است.

هدف، اضافه‌کردن ReSellCodes به‌عنوان یک `SupplierProvider` جدید در [integrations/suppliers](integrations/suppliers/src/supplier-provider.interface.ts) است — هم برای گیفت‌کارت (مسیر موجود) و هم برای Game Top-up (همان مدل تحویل `DIRECT_TOPUP` که در [docs/fazercards-game-topup.md](fazercards-game-topup.md) طراحی شده و باید بازاستفاده شود، نه از نو ساخته شود).

## خلاصه‌ی API

- Base URL: `https://resell.codes/api/v1`
- Auth: `Authorization: Bearer rsc_live_...` — هدر ساده، مثل الگوی فعلی.
- بدون idempotency-key رسمی روی سفارش‌ها — این مهم‌ترین تفاوت با Reloadly/FazerCards است و بخش جداگانه‌ای در ادامه دارد.
- بدون sandbox — هر تماس روی موجودی واقعی اثر می‌گذارد.
- Rate limit: ۳۰ در دقیقه و ۵۰۰۰ در روز، با هدرهای `X-RateLimit-*` و `429` + `Retry-After`.
- Pagination: cursor-based (`limit`, `cursor`, `has_more`, `next_cursor`).
- خطاها: JSON یکنواخت با `error.type`/`error.message` (`invalid_request`, `unauthorized`, `forbidden`, `not_found`, `rate_limited`).

### Endpointهای مرتبط با adapter

| قابلیت | Endpoint |
|---|---|
| کاتالوگ گیفت‌کارت | `GET /gift-cards/categories`, `GET /gift-cards/categories/{id}/cards`, `GET /gift-cards/brands` |
| کاتالوگ Game Top-up | `GET /top-ups/categories`, `GET /top-ups/categories/{id}/offers`, `GET /top-ups/brands` |
| خرید گیفت‌کارت | `POST /gift-cards/order` |
| خرید Top-up | `POST /top-ups/order` |
| وضعیت سفارش | `GET /orders/{number}` (شامل `status_history`, `fail_code`) |
| لیست سفارش‌ها | `GET /orders?status=&type=` |
| موجودی حساب | `GET /me` |
| تراکنش‌ها | `GET /transactions`, `GET /transactions/{number}` |

سایر خانواده‌های محصول (Game Keys, Steam, Telegram, Manual Services) در دامنه‌ی فعلی سیستم موضوعیت ندارند و در فاز اول adapter پیاده‌سازی نمی‌شوند.

## نگاشت به `SupplierProvider`

| متد اینترفیس | پیاده‌سازی با ReSellCodes |
|---|---|
| `getCatalog()` | ترکیب `/gift-cards/categories/{id}/cards` (برای هر دسته) و `/top-ups/categories/{id}/offers` |
| `getPrice(providerSku)` | از همان پاسخ کاتالوگ (`price_usd`) خوانده می‌شود؛ نیازی به تماس جدا نیست مگر برای تازه‌سازی نقطه‌ای |
| `checkAvailability(providerSku)` | از فیلد `stock` همان آیتم کاتالوگ |
| `purchase(request)` | `POST /gift-cards/order` یا `POST /top-ups/order`، بسته به نوع SKU؛ برای Top-up، `request.topupRecipient` (طراحی‌شده در سند FazerCards) به فیلدهای `fields` مربوط به همان offer نگاشت می‌شود |
| `getPurchaseStatus(providerReference)` | `GET /orders/{number}`؛ نگاشت وضعیت‌ها در ادامه |
| `getBalance()` | `GET /me` |

### نگاشت وضعیت سفارش

`created` → `PENDING`
`processing` → `PENDING`
`completed` → `SUCCEEDED`
`failed` / `refund` → `FAILED`، با `failureCode` گرفته‌شده از `fail_code` (`out_of_stock`, `stock_short`, `price_changed`, `offer_gone`, `account_problem`, `region_restricted`, `limit_exceeded`, `timed_out`, `cancelled`, `declined`) — این مقادیر باید به کدهای داخلی موجود نگاشت شوند، نه اینکه خام منتقل شوند.

## نبود Idempotency-Key: مهم‌ترین ریسک

ReSellCodes هیچ مکانیزم رسمی برای جلوگیری از سفارش تکراری روی retry ارائه نمی‌دهد. برخلاف Reloadly و FazerCards، ارسال دوباره‌ی همان درخواست (مثلاً بعد از timeout شبکه) می‌تواند باعث خرید و کسر موجودی دوباره شود.

راه‌حل باید کاملاً سمت ما باشد، در لایه‌ی adapter یا سرویس بالادستی:

1. قبل از هر `POST .../order`، یک رکورد داخلی «تلاش خرید» با کلید یکتا (`idempotencyKey` که اینترفیس داخلی همین حالا هم از purchase request می‌گیرد) با وضعیت `IN_FLIGHT` قفل و ذخیره شود.
2. اگر تماس شبکه با خطا یا timeout مواجه شد، **قبل از هر تلاش دوباره**، ابتدا `GET /orders?status=&type=` یا جست‌وجوی سفارش‌های اخیر بر اساس زمان و SKU بررسی شود که آیا سفارش قبلاً واقعاً ایجاد شده یا نه.
3. فقط در صورت عدم وجود سفارش matching، retry مجاز است.
4. رکورد «تلاش خرید» بعد از نتیجه‌ی نهایی (موفق یا قطعاً ناموفق) به state نهایی برود؛ در غیر این صورت این SKU/کاربر باید در صف بررسی عملیاتی (operator review) قرار گیرد، نه retry خودکار.

این منطق باید عمومی و در سطح adapter/service نوشته شود، طوری که برای هر supplier آینده‌ی بدون idempotency رسمی هم قابل استفاده باشد — نه یک وصله‌ی مخصوص ReSellCodes.

## adapter پیشنهادی

یک فایل جدید در همان الگوی Reloadly:

```
integrations/suppliers/src/providers/resellcodes.provider.ts
integrations/suppliers/src/providers/resellcodes.provider.test.ts
```

مسئولیت‌ها:
- تبدیل پاسخ‌های snake_case ReSellCodes (`price_usd`, `stock`, `status_history`, `fail_code`) به شکل‌های اینترفیس داخلی (`SupplierMoney`, `SupplierPurchaseStatus`, ...).
- هیچ متن خام خطای ReSellCodes نباید مستقیم به کاربر یا لاگ عمومی برسد؛ فقط `failureCode` نگاشت‌شده.
- رعایت rate limit با backoff بر اساس هدر `Retry-After` هنگام `429`.
- تفکیک واضح مسیر گیفت‌کارت از مسیر Top-up در همان adapter (دو متد داخلی خصوصی، یک کلاس واحد پیاده‌ساز اینترفیس).

## env و فعال‌سازی

با همان الگوی [suppliers.env.ts](../apps/api/src/modules/suppliers/suppliers.env.ts):

```
RESELLCODES_ENABLED=false
RESELLCODES_API_KEY=
RESELLCODES_BASE_URL=https://resell.codes/api/v1
RESELLCODES_TIMEOUT_MS=20000
```

- پیش‌فرض `RESELLCODES_ENABLED=false`، دقیقاً مثل Reloadly — ثبت adapter هیچ‌وقت از روی وجود کلید استنباط نمی‌شود؛ فعال‌سازی واقعی خرید یک تصمیم جداگانه‌ی انسانی است.
- کلید API (`rsc_live_...`) هرگز در چت، commit، یا لاگ قرار نگیرد؛ فقط در فایل secrets سمت سرور (`/opt/baratpay/secrets/.env.api` روی production) یا env محلی ignore‌شده برای توسعه.
- چون sandbox ندارد، تست اولیه‌ی خرید واقعی باید با یک آیتم کم‌قیمت و سقف مالی مشخص، و فقط بعد از تأیید انسانی انجام شود — نه در CI و نه به‌صورت خودکار.

## مراحل اجرایی پیشنهادی

1. ثبت‌نام و ساخت کلید API در dashboard ReSellCodes؛ تعیین سقف مالی اولیه.
2. اضافه‌کردن `RESELLCODES_*` env vars (با `enabled=false`).
3. ساخت adapter با تست‌های mocked: موفق، `failed` با هر `fail_code`، `429` با `Retry-After`، timeout.
4. پیاده‌سازی لایه‌ی idempotency داخلی (تلاش خرید + بررسی سفارش‌های قبل از retry) — این باید قبل از فعال‌سازی هر خرید واقعی کامل و تست‌شده باشد.
5. نگاشت کاتالوگ (`price_usd`, `stock`) به مدل SKU/Offer داخلی، هم برای گیفت‌کارت هم Top-up.
6. اتصال مسیر Top-up به همان زیرساخت مقصد (`DIRECT_TOPUP`, فرم بعد از پرداخت) که در سند FazerCards طراحی شده — دو adapter نباید دو پیاده‌سازی جدا از UI/فرم مقصد داشته باشند.
7. تست read-only (`getCatalog`, `getBalance`) با کلید واقعی، بدون فعال‌کردن خرید.
8. فعال‌سازی خرید فقط بعد از تأیید دستی و رصد اولیه‌ی چند سفارش کم‌ریسک.
