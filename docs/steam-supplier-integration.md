# Steam (شارژ کیف پول) — از طریق FazerCards

## وضعیت

adapter، وایرینگ، seed و صفحهٔ مستقل `/steam` نوشته شده‌اند. این سند **منبع حقیقت** برای
ایجنت‌های بعدی است؛ هر چیز «تأییدشده» از روی OpenAPI عمومی استخراج شده است.

- `FAZERCARDS_STEAM_ENABLED=false` — پیش‌فرض خاموش، مستقل از flagهای Telegram و top-up.
- seed همه‌چیز را **غیرفعال** می‌سازد (supplier، بازی و آفرها).
- **هیچ خرید واقعی‌ای مجاز نیست.** تست‌ها فقط mocked.

## جریان مشتری

مشتری فقط **شناسهٔ ورود استیم** و **مبلغ دلاری دلخواه** را تایپ می‌کند (پیش‌تنظیم/نردبان مبلغ
وجود ندارد، مثل پنل FazerCards)؛ قیمت نهایی ریالی قبل از پرداخت در quote نشان داده می‌شود. پس از پرداخت، همان مبلغ از طریق API فازرکارتز
به کیف پول استیم واریز می‌شود.

## منبع داده

کلید API در `secrets/fazercards/fazercards.env` (gitignore‌شده) است و هرگز در چت، commit یا لاگ
نمی‌آید. قرارداد از `https://api.fzr.cards/public/docs/openapi.json` استخراج شده است.

## API (راستی‌آزمایی‌شده از OpenAPI)

| قابلیت | Endpoint | جزئیات |
|---|---|---|
| نرخ‌ها | `GET /steam-topup/rates` | `{ok, base:"USD", rates:{USD,RUB,UAH,KZT,…}}` — فقط برای بررسی سلامت |
| بررسی ورود | `POST /steam-topup/check-login` | body `{steamLogin}` → `{ok, can_refill, unverified?}` |
| سفارش | `POST /steam-topup/order` | body `{steamLogin, currency, amount}` + هدر `Idempotency-Key` (≤۲۵۵) |
| وضعیت | `GET /orders/{orderId}` | الگوی `^ord-[0-9]+$` |

- USD حداکثر ۲ رقم اعشار می‌پذیرد.
- شکل داخلی `order` مستند نشده؛ adapter فیلد `status` را دفاعی می‌خواند و در نبودش، سفارش
  قابل‌پیگیری را `PENDING` (نه موفق) در نظر می‌گیرد.

## Idempotency

برخلاف Telegram، این مسیر **هدر واقعی `Idempotency-Key`** دارد: تکرار همان کلید، سفارش اصلی را
برمی‌گرداند و دوباره شارژ نمی‌کند. کلید ما `topup:${orderId}` است؛ پس restart یا چند نمونهٔ API
نمی‌تواند خرید دوباره بسازد و adapter به حافظهٔ process-local نیاز ندارد.

## بررسی شناسه پیش از شارژ

`purchase()` قبل از هر شارژ `check-login` را صدا می‌زند. شناسه‌ای که قابل شارژ نباشد
(`can_refill=false`) همان‌جا `FAILED` می‌شود — هنوز چیزی کسر نشده. پاسخ `unverified` رد نیست:
فازرکارتز می‌گوید شناسهٔ ناشناخته به‌صورت خودکار برگشت داده می‌شود.

## فضای SKU و مبلغ دلخواه

کاتالوگ فقط **یک آفر قالب** دارد: `steam:usd:custom` (`providerCategoryId=usd`، `providerOfferId=custom`).
مبلغ تایپ‌شده در `requestedAmountForeign` (فیلد موجود در `createQuoteRequestSchema`؛ بدون تغییر فایل frozen)
می‌آید و `QuotesService.resolveTarget` با `bindVariableTopUpAmount` آن را به `steam:usd:<amount>` تبدیل می‌کند.
این SKU در snapshot منجمد می‌شود و fulfillment همان را می‌خرد؛ یعنی مبلغ پرداخت‌شده = مبلغ خریداری‌شده.

```
steam:usd:<amount>     amount: عدد صحیح یا حداکثر ۲ رقم اعشار (محاسبهٔ integer-cents، بدون float)
```

حدود فعلی $0.15 تا $1000 است: **فقط از اسکرین‌شات رقیب** آمده و OpenAPI فازرکارتز عدد مینیمم/ماکسیمم
ندارد. ثابت‌ها: `STEAM_CUSTOM_MIN/MAX_USD_CENTS` (API) و `STEAM_MIN/MAX_USD_CENTS` (وب، فقط برای UX).

## قیمت و حاشیه سود

هزینهٔ تأمین‌کننده همان ارزش اسمی USD است، اما فازرکارتز می‌گوید مبلغ واقعی کسرشده «بسته به
پلن ریسِلر» است و API آن را نشان نمی‌دهد. حاشیه سود باید با ضریب پلن در نظر گرفته شود
(`PricingRuleScope.TOP_UP_GAME`) — این یک **human gate** قیمت‌گذاری است.

## قاعدهٔ صفر WorkItem

مثل Telegram: top-up مستقیم **هیچ WorkItem** برای اپراتور نمی‌سازد. فقط وقتی خرید واقعاً شکست
بخورد یا نتیجه مبهم باشد، تسک ساخته می‌شود.

## مراحل باقی‌مانده (تصمیم انسانی)

1. تأیید حداقل/حداکثر مجاز (عدد $0.15 / $1000 فقط از اسکرین‌شات رقیب است) و ضریب پلن.
2. تعیین حاشیه سود برای Steam.
3. فعال‌سازی دستی supplier، بازی و آفرها در پنل ادمین، و روشن کردن `FAZERCARDS_STEAM_ENABLED`.
4. **تأیید شکل واقعی `order` فقط با یک خرید واقعی کم‌مبلغ.**
5. تغییر `QuotesService.resolveTarget` یک تغییر مالی است و پیش از merge نیاز به بازبینی انسانی دارد.
