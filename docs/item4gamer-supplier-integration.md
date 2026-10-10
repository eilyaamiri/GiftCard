# Item4Gamer (item4gamer.com) — تأمین‌کننده‌ی جدید

## وضعیت

این سند فقط طراحی و طرح پیاده‌سازی است؛ هنوز هیچ کدی، env، تغییر دیتابیس یا اتصال واقعی انجام نشده است. مبنای سند، مستند Postman‌ی «Item4Gamer Reseller API» است که کاربر ارائه داده؛ هر چیزی که در آن مستند نبوده با برچسب **[تأیید لازم]** مشخص شده و نباید حدس زده شود.

هدف: اضافه‌کردن Item4Gamer به‌عنوان یک `SupplierProvider` جدید در [integrations/suppliers](../integrations/suppliers/src/supplier-provider.interface.ts)، با همان مدل `DIRECT_TOPUP` که در [fazercards-game-topup.md](fazercards-game-topup.md) طراحی شده و بازاستفاده می‌شود — نه ساخت مسیر موازی.

## خلاصه‌ی API

- Base URL: در مستند فقط به‌صورت متغیر `{{base_url}}` آمده و مقدارش معلوم نیست. **[تأیید لازم]** — باید از پشتیبانی Item4Gamer گرفته شود و بدون مقدار پیش‌فرض در env بیاید.
- Auth: هدر `api-key: <کلید>` روی همه‌ی endpointها. کلید فقط بعد از ثبت‌نام در سایت و فعال‌سازی سرویس API توسط پشتیبانی صادر می‌شود.
- پاسخ‌ها همه در پوشش `{ "data": { "status": 200, ... } }` هستند. شکل پاسخ خطا در مستند **نیامده** است. **[تأیید لازم]**
- مبالغ (`price`, `total`, `balance`) در JSON به‌صورت **عدد** می‌آیند (`0.58`)، نه رشته. ارز در مثال‌ها همیشه `USD`.
- Idempotency-Key ندارد. endpoint لیست سفارش‌ها هم ندارد (فقط `get-order` با شناسه).
- Rate limit، sandbox و webhook در مستند ذکر نشده. **[تأیید لازم]**

### Endpointها

| قابلیت | Endpoint |
|---|---|
| دسته‌ها | `GET /product/get-categories` |
| محصولات یک دسته | `GET /product/get-products?category_id=` |
| یک محصول با همه‌ی variationها | `GET /product/get-product?product_id=` |
| یک variation با قیمت | `GET /product/get-variation?variation_id=` |
| ثبت سفارش | `POST /order/add-order` |
| وضعیت سفارش | `GET /order/get-order?order_id=` |
| موجودی حساب | `GET /get-balance` (بدون پیشوند `/product`) |

### مدل داده

دسته ← محصول (`id`, `name`) ← variation. هر variation: `id`, `name`, `price`, `currency`, `discount`, `in_stock`, `delivery_type` (در مثال‌ها فقط `topup`) و `fields[]` با `data_name`, `type`, `required`, `name`.

دسته‌های نمونه: Games (18)، Game Credits (19)، Gift Cards (20)، Payment Services (23)، Ping Reducers (22)، Other Products (15)، Uncategorized (160).

بدنه‌ی `add-order`: `variation_id`، `quantity` (پیش‌فرض ۱)، `customer` (اختیاری: نام، ایمیل، تلفن)، و `data` — کلیدهای آن «بر اساس محصول و variation» هستند و در مثال شامل `email`, `game_password`, `player_name` است. پاسخ: `order_id`, `total`, `currency` (بدون وضعیت).

`get-order`: `status`, `total`, `currency`, `items[]`, `created_at`, `notes[]`. در مثال فقط وضعیت `cancelled` دیده شده. کد گیفت‌کارت (در صورت وجود) داخل `notes` است و با regex ``copyToClipboard\(`([^`]+)`\)`` بیرون کشیده می‌شود.

## ناسازگاری‌ها و نکته‌های مستند

1. مثال `get-products` با `category_id=89` برگشته، در حالی که ۸۹ در خروجی `get-categories` نیست. یعنی یا زیردسته‌ای وجود دارد که فهرست نشده یا مثال‌ها از جاهای مختلف آمده‌اند. **[تأیید لازم]** با فراخوانی واقعی read-only.
2. شناسه‌ی variation در مثال‌های مختلف یکی نیست (`366068`، `49544`، `189309`)؛ قیمت‌ها را فقط از فراخوانی واقعی باید خواند.
3. معنی `discount` روشن نیست. در مثال، قیمت `0.58` با `discount: 5` و `total` سفارش هم `0.58` است؛ یعنی احتمالاً `price` همان مبلغ کسرشده است ولی قطعی نیست. **[تأیید لازم]** با یک سفارش کم‌قیمت و مقایسه‌ی کسر موجودی.
4. نام‌ها HTML-escaped هستند (`Frost &amp; Flame`)؛ adapter باید entityها را decode کند.
5. region داخل نام variation است (`... - Indonesia, 63 CP`)، نه فیلد جدا.

## ریسک‌های اصلی و پاسخ طراحی

### ۱. نبود Idempotency-Key و نبود لیست سفارش‌ها

از ReSellCodes هم سخت‌تر است: آنجا پس از timeout می‌شد سفارش‌های اخیر را جست‌وجو کرد، اینجا نه. پس بعد از یک `add-order` مبهم راهی برای فهمیدن «ثبت شد یا نه» نیست.

پاسخ، همان که زیرساخت فعلی از قبل دارد:

- [topup-fulfillment.service.ts](../apps/api/src/modules/suppliers/topup-fulfillment.service.ts) قبل از `purchase` رکورد را در دیتابیس با transition اتمیک به `PURCHASING` می‌برد؛ دو worker هم‌زمان نمی‌توانند هر دو بخرند.
- وضعیت `UNKNOWN` ترمینال است و **هرگز خودکار دوباره خریده نمی‌شود**؛ یک تسک برای اپراتور باز می‌شود.
- adapter: `add-order` را **هیچ‌گاه retry نمی‌کند**؛ فقط یک in-flight map و یک cache نتیجه‌ی ۲۴ ساعته (کلید `request.idempotencyKey = topup:{orderId}`) مثل [fazercards-telegram.provider.ts](../integrations/suppliers/src/providers/fazercards-telegram.provider.ts). هر پاسخ مبهم (timeout، قطع اتصال، ۵xx، بدنه‌ی نامعتبر) = `UNKNOWN` بدون `providerReference`.
- فقط خطای ۴xx با بدنه‌ی قابل‌خواندن که صریحاً رد شدن سفارش را بگوید `FAILED` است.
- اپراتور برای تکلیف `UNKNOWN` باید لیست سفارش‌ها را در پنل خود item4gamer.com ببیند؛ این در راهنمای عملیاتی (runbook) نوشته شود.
- `getBalance` از قبل در `checkFunding` قبل از هر خرید خوانده می‌شود، پس سفارش وقتی موجودی کم است اصلاً ثبت نمی‌شود.

### ۲. پول به‌صورت عدد JSON

قاعده‌ی ۲ AGENTS.md: هرگز float برای پول. `JSON.parse` عدد `0.58` را به double تبدیل می‌کند. راه‌حل: قبل از parse، مقدار کلیدهای `price`, `total`, `balance` در متن خام پاسخ با regex به رشته تبدیل شود، بعد با regex سخت‌گیر ``^\d+(\.\d{1,6})?$`` اعتبارسنجی شود و به‌صورت decimal-string عبور کند. نمایش با `Decimal`/BigInt در سمت دامنه. تست‌ها باید مقادیری مثل `0.58`, `57.95`, `35036.38`, `1e-7` و منفی/NaN را پوشش دهند.

### ۳. فیلدهای credential

`game_password` در مثال هست. طبق قاعده‌ی پروژه، بازی‌ای که هر فیلد credential دارد **هرگز فروخته نمی‌شود** (`requiresCredentials`). تشخیص محافظه‌کارانه: `type === 'password'` یا `data_name`/`name` شامل `pass`, `pwd`, `otp`, `pin`, `token`, `secret`, `2fa`, `verification`. هر variation با چنین فیلدی از فروش خارج است. `email` به‌تنهایی credential نیست ولی همراه password است و آن‌وقت کل variation حذف می‌شود.

### ۴. داده‌ی مشتری

بخش `customer` اختیاری است و **ارسال نمی‌شود**: Item4Gamer نیازی به نام/ایمیل/تلفن مشتری‌ی ما ندارد و حداقل‌سازی داده درست است. فقط `variation_id`, `quantity: 1` و `data` (فیلدهای عمومی حساب بازی) فرستاده می‌شود. هیچ مقدار `data` لاگ نمی‌شود.

### ۵. واژگان وضعیت سفارش ناشناخته

فقط `cancelled` دیده شده؛ مدل داده شبیه WooCommerce است ولی تأییدی نیست. **[تأیید لازم]** نگاشت پیشنهادی (هر چیز ناشناخته = `UNKNOWN`، نه PENDING و نه SUCCEEDED):

| وضعیت Item4Gamer | وضعیت داخلی |
|---|---|
| `completed` | `SUCCEEDED` (با `DIRECT_TOPUP`) |
| `pending`, `processing`, `on-hold` | `PENDING` |
| `cancelled`, `failed`, `refunded` | `FAILED` (فقط اگر تأیید شود که موجودی برگشته) |
| هر مقدار دیگر | `UNKNOWN` |

یادآوری: `FAILED` یعنی «تأمین‌کننده می‌گوید چیزی کسر نشد» و مسیر بازگشت وجه مشتری را باز می‌کند. اگر `cancelled` موجودی را خودکار برنمی‌گرداند، آن‌را `FAILED` نکنیم و `UNKNOWN` کنیم.

### ۶. هزینه‌ی خواندن کاتالوگ

کاتالوگ N+1 است: دسته‌ها ← `get-products` برای هر دسته (حدود ۱۳۰ محصول فقط در یک دسته) ← `get-product` برای هر محصول. فقط در sync زمان‌بندی‌شده اجرا شود، با محدودیت هم‌زمانی کوچک (`mapWithConcurrency` مثل FazerCards) و backoff روی ۵xx/۴۲۹ برای درخواست‌های GET. قیمت زنده و موجودی هنگام quote با یک تماس `get-variation` خوانده می‌شود، نه با crawl.

## سیاست تأمین (تصمیم محصولی لازم)

قاعده‌ی ثبت‌شده‌ی قبلی (۲۰۲۶-۰۹-۳۰): شارژ تلگرام و بازی‌ها فقط از FazerCards تأمین شود، هرگز Reloadly. افزودن Item4Gamer را کاربر صریحاً خواسته؛ پس این قاعده باید بازنویسی شود، ولی معنی آن باید روشن شود:

- **الف (پیشنهاد فاز ۱):** Item4Gamer فقط بازی‌هایی را اضافه می‌کند که FazerCards ندارد. هر `TopUpGame` یک `supplierId` دارد، پس هیچ منطق انتخاب/failover لازم نیست. بازی‌ها غیرفعال import می‌شوند و ادمین یکی‌یکی بازبینی و فعال می‌کند (همان مسیر فعلی).
- **ب:** Item4Gamer تأمین‌کننده‌ی جایگزین برای همان بازی‌هایی باشد که FazerCards هم دارد. این به اولویت‌بندی و failover در سطح offer نیاز دارد که امروز وجود ندارد؛ جداگانه طراحی شود.

محدوده‌ی فاز ۱: فقط variationهایی با `delivery_type === 'topup'` از دسته‌های Games (18) و Game Credits (19) (قابل‌تنظیم با env). گیفت‌کارت (دسته ۲۰) و Payment Services (۲۳) **خارج از فاز ۱** هستند: کد گیفت‌کارت از `notes` با regex خوانده می‌شود، یعنی باید رمزنگاری AES-256-GCM و نبودِ لاگ تضمین شود و این یک گیت امنیتی انسانی است (AGENTS.md §4.4).

## نگاشت به `SupplierProvider`

یک کلاس واحد `Item4GamerTopUpSupplierProvider` با `key = 'item4gamer-topup'` (= `Supplier.code`).

| متد | پیاده‌سازی |
|---|---|
| `getTopUpCatalog()` / `readTopUpCatalog()` | دسته‌های مجاز ← محصولات ← `get-product`. هر محصول یک یا چند `SupplierTopUpGame` (بخش پایین). offerها = variationهای `topup`، با `offerId = variation.id` و `cost` از `price` |
| `getCatalog()` | تخت‌شده‌ی همان، `assetType: 'DIRECT_TOPUP'`، `requiredAccountFields` از `fields[].data_name` |
| `getPrice(sku)` | `get-variation` ← `price` به‌صورت decimal-string، `USD` |
| `checkAvailability(sku)` | `get-variation` ← `in_stock` (`true`/`false`؛ پاسخ خراب = `UNKNOWN`) |
| `purchase(request)` | `add-order` با `variation_id` + `data = accountFields` (فقط کلیدهای تعریف‌شده در `fields`)، `quantity` ≠ ۱ ← `FAILED: QUANTITY_NOT_SUPPORTED`. موفقیت = `PENDING` با `providerReference = String(order_id)`؛ `SUCCEEDED` فقط از `get-order` |
| `getPurchaseStatus(ref)` | `get-order` + نگاشت جدول بالا؛ `accountReference` از `accountFields` درخواست اصلی (پاسخ `get-order` حساب را برنمی‌گرداند) |
| `getBalance()` | `get-balance` ← `{ amount: decimal-string, currency }` |

### ساختار providerSku و بازی

`providerSku = {gameKey}:{variationId}` و adapter برای خرید فقط بخش آخر (variation id) را می‌خواند. `gameKey` همان `categoryId` در `SupplierTopUpGame` است.

فیلدهای ورودی در مدل ما **به‌ازای بازی** هستند، ولی در Item4Gamer **به‌ازای variation**. پس اگر variationهای یک محصول امضای فیلد (مجموعه‌ی `data_name`ها) متفاوت داشتند، محصول به چند `SupplierTopUpGame` شکسته می‌شود: `gameKey = {productId}` وقتی همه یکسان‌اند، وگرنه `{productId}-{hash کوتاه امضا}`. region از پیشوند نام variation استخراج می‌شود؛ اگر نشد `GLOBAL`.

## فایل‌ها و نقاط اتصال

- جدید: `integrations/suppliers/src/providers/item4gamer-topup.provider.ts` و `.test.ts`، و export در [index.ts](../integrations/suppliers/src/index.ts).
- [suppliers.env.ts](../apps/api/src/modules/suppliers/suppliers.env.ts): `ITEM4GAMER_TOPUP_ENABLED` (پیش‌فرض `false`)، `ITEM4GAMER_API_KEY`، `ITEM4GAMER_BASE_URL` (اجباری، بدون پیش‌فرض)، `ITEM4GAMER_TIMEOUT_MS`، `ITEM4GAMER_CATEGORY_IDS` (پیش‌فرض `18,19`). فعال‌بودن هرگز از وجود کلید استنباط نمی‌شود.
- [supplier-providers.factory.ts](../apps/api/src/modules/suppliers/supplier-providers.factory.ts): ثبت adapter در `buildSupplierProviders` زیر flag مستقل (و `isTest` برتر از آن)، و یک reader در `buildTopUpCatalogReaders` که **مستقل از flag خرید** است تا import بدون امکان `purchase` کار کند.
- [suppliers.wiring.spec.ts](../apps/api/src/modules/suppliers/suppliers.wiring.spec.ts): پوشش ثبت/عدم‌ثبت.
- تغییر schema ندارد: `TopUpGame.supplierId/providerCategoryId`, `TopUpOffer`, `TopUpField` همه موجودند. [schema.prisma](../packages/database/prisma/schema.prisma) فریز است و دست نمی‌خورد.
- `.env.example` متعلق به Foundation است؛ کمبود گزارش شود، نه ویرایش.
- روت‌ها: `SUPPLIER_PRICE_LOOKUP` و `providersByKey` خودکار با `Supplier.code` کار می‌کنند؛ تغییر دیگری در هسته لازم نیست.

## تست‌ها (قاعده‌ی ۱۲؛ Playwright اضافه نمی‌شود)

- کاتالوگ: دسته‌های مجاز، تشکیل بازی، شکستن بر اساس امضای فیلد، حذف variation با فیلد credential، decode کردن HTML entity، محصول ناخوانا ← `unreadable` بدون توقف کل import.
- پول: تبدیل عدد JSON به decimal-string (`0.58`, `57.95`, `35036.38`)، ردّ مقدار نامعتبر، عدم عبور از `Number`.
- `purchase`: موفق ← `PENDING` + `order_id`؛ رد صریح ۴xx ← `FAILED`؛ timeout/۵xx/بدنه‌ی خراب ← `UNKNOWN` **بدون retry** (شمارش تعداد POST)؛ دو فراخوانی هم‌زمان با یک `idempotencyKey` ← یک POST؛ `quantity` ≠ ۱؛ `accountFields` ناقص؛ عدم ارسال `customer`.
- `getPurchaseStatus`: هر وضعیت جدول، وضعیت ناشناخته ← `UNKNOWN`.
- عدم لاگ: هیچ مقدار `data`، کلید API، یا بدنه‌ی خام در لاگ و پیام خطا نباشد.
- کنترل مرز: ESLint بررسی کند domain به provider انتزاعی import نمی‌کند.

## مراحل اجرایی

1. **قبل از کد، از پشتیبانی Item4Gamer بپرسید** (فهرست پایین) و `ITEM4GAMER_BASE_URL` و کلید API را بگیرید. کلید هرگز در چت یا commit نیاید؛ فقط در `/opt/baratpay/secrets/.env.api` سرور یا env محلی ignore‌شده.
2. تصمیم الف/ب سیاست تأمین (بالا) و بازنویسی قاعده‌ی حافظه/مستندات.
3. فراخوانی read-only واقعی (`get-categories`, `get-products`, `get-product`, `get-balance`) و ثبت پاسخ‌های واقعی به‌عنوان fixture تست.
4. پیاده‌سازی adapter + تست‌ها + env + wiring با `ITEM4GAMER_TOPUP_ENABLED=false`.
5. import کاتالوگ (dry-run سپس واقعی): بازی‌ها غیرفعال وارد می‌شوند.
6. بازبینی ادمین و فعال‌سازی تک‌تک بازی‌ها/offerها.
7. **گیت انسانی (AGENTS.md §4.5):** فعال‌سازی `ITEM4GAMER_TOPUP_ENABLED` در production. تست خرید واقعی فقط با ارزان‌ترین variation، سقف مالی مشخص، و رصد دستی چند سفارش اول؛ نه در CI.

## سؤال‌های باز برای پشتیبانی Item4Gamer

1. مقدار `base_url` و نسخه‌بندی API.
2. Rate limit (در دقیقه/روز) و رفتار `429`.
3. شکل پاسخ خطا برای `add-order` (کد HTTP، `data.status`، `message`) و فهرست خطاهای ممکن (موجودی ناکافی، اتمام موجودی، فیلد ناقص).
4. فهرست کامل وضعیت‌های سفارش و اینکه `cancelled` موجودی را خودکار برمی‌گرداند یا نه.
5. معنی `discount`: آیا `price` از قبل کسرشده است؟
6. روش امن برای فهمیدن «سفارش ثبت شد یا نه» پس از timeout (idempotency، لیست سفارش‌ها، یا پارامتر مرجع سمت ما).
7. آیا `add-order` به یک شناسه‌ی مرجع سمت ما (reference) اجازه می‌دهد؟
8. وجود sandbox یا حساب آزمایشی.
9. SLA زمان تحویل شارژ و سیاست مسدودسازی/ban برای حجم درخواست crawl.
10. شناسه‌ی `category_id` زیردسته‌ها (مثال ۸۹).
