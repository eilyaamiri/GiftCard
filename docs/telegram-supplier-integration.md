# Telegram (Stars و Premium) — از طریق FazerCards

## وضعیت

طرح توسعه تأیید شده و روی branch `feat/telegram-topup` (ساخته‌شده از `origin/main`) در حال
اجراست. این سند **منبع حقیقت** برای ایجنت‌های بعدی است: هر چیزی که اینجا «تأییدشده» علامت خورده،
با تماس زنده یا OpenAPI راستی‌آزمایی شده و نباید دوباره کشف شود.

- `FAZERCARDS_TELEGRAM_ENABLED=false` — پیش‌فرض خاموش، مستقل از دو flag دیگر FazerCards.
- **هیچ خرید واقعی‌ای مجاز نیست.** تست‌ها فقط mocked.

## منبع داده

کلید API در `secrets/fazercards/fazercards.env` (mode 600، gitignore‌شده). کلید هرگز در چت،
commit یا لاگ نمی‌آید.

**مهم:** تمام مسیرهای API از روی spec عمومی OpenAPI استخراج شده‌اند، نه حدس:
`https://api.fzr.cards/public/docs/openapi.json` (حدود ۱۲۷ کیلوبایت، ماشین‌خوان). این فایل
تنها منبع معتبر قرارداد است؛ صفحات HTML بازاریابی (`reseller.fazercards.com`) هیچ‌کدام از این
جزئیات را ندارند.

## API (راستی‌آزمایی‌شده: OpenAPI + تماس زنده GET، ۲۰۲۶-۰۹-۲۹)

| قابلیت | Endpoint | جزئیات |
|---|---|---|
| نرخ استارز | `GET /telegram/stars` | `{ok, kind:"telegram_stars", price_per_star:"0.0152625", min_amount:50, max_amount:10000, rates_updated_at}` |
| پلن‌های پرمیوم | `GET /telegram/premium` | `{ok, kind:"telegram_premium", plans:[{months:3,price_usd:"12.1999"},{months:6,price_usd:"16.2699"},{months:12,price_usd:"29.4974"}], rates_updated_at}` |
| خرید استارز | `POST /telegram/stars/buy` | body `{telegram_username, quantity}` — `quantity` عدد صحیح ۵۰ تا ۱۰۰۰۰ → **201** |
| خرید پرمیوم | `POST /telegram/premium/buy` | body `{telegram_username, months}` — `months` ∈ {3,6,12} → **201** |
| وضعیت سفارش | `GET /orders/{orderId}` | مسیر با الگوی `^ord-[0-9]+$` محدود شده |
| موجودی | `GET /balance` | زنده چک شد: `{"ok":true,"balance":"1.0200","currency":"USD"}` |

پاسخ خرید: `{ok:true, order:{…}}`. در spec، خودِ `order` با `additionalProperties:true` تعریف شده —
یعنی **شکل داخلی آن مستند نشده است**. تا یک خرید واقعی انجام نشود، شکل دقیق آن قابل تأیید نیست؛
adapter باید `status`/`reason` را دفاعی بخواند و در نبودشان fallback مستند داشته باشد.

### تفاوت‌های مهم با top-up

- **مسیر خرید `.../buy` است، نه `.../order`.** بقیه خانواده‌های محصول FazerCards از
  `/xxx/order` استفاده می‌کنند؛ تلگرام نه. (روی مسیر اشتباه، `GET` خطای ۴۰۴ می‌دهد — که البته
  دربارهٔ متد `POST` چیزی ثابت نمی‌کند، پس مبنای قطعی همان spec است.)
- **بدون `Idempotency-Key`.** spec هدر idempotency را فقط برای این مسیرها اعلام کرده:
  `/giftcards/order`، `/topups/order`، `/gamekeys/order`، `/steam-gifts/order`،
  `/steam-topup/order`، `/manual-services/order`. **تلگرام در آن لیست نیست.**
- username می‌تواند `@` ابتدایی داشته باشد؛ spec فقط `{type:string, minLength:1}` می‌گوید و
  **هیچ قاعده اعتبارسنجی یا endpoint اعتبارسنجی‌ای مستند نشده**.
- خطاها: ۴۰۰ / ۴۰۱ / ۴۰۳ / ۵۰۰ / ۵۰۲ / ۵۰۳.

## ریسک اصلی: نبود idempotency

این دقیقاً همان ریسکی است که در [سند ReSellCodes](resellcodes-supplier-integration.md) به‌عنوان
مهم‌ترین ریسک آن تأمین‌کننده مستند شده — و **عکس** وضعیت adapter top-up خود FazerCards، که به
هدر واقعی `Idempotency-Key` تکیه می‌کند. پس خرید تلگرام **نباید** الگوی idempotency آن adapter را
کپی کند؛ باید الگوی ReSellCodes را بگیرد:

1. `Map` تماس‌های هم‌زمان با یک کلید را روی یک Promise جمع می‌کند (adopt، نه خرید دوم).
2. `Map` دوم نتیجه‌ی نهایی هر کلید را با TTL ۲۴ ساعته نگه می‌دارد، تا retry ترتیبی بعد از timeout
   بدون خرید دوباره پاسخ بگیرد.
3. این حافظه فقط در سطح یک process است — محدودیتی صریح، نه یک راه‌حل کامل. بین چند نمونه API
   مشترک نیست.
4. هر نتیجه‌ای که adapter با قطعیت نمی‌داند (شبکه، ۵xx، پاسخ ناخوانا) → `UNKNOWN`، هرگز `FAILED`.

## پکیج‌های استارز (تعیین‌شده توسط مالک محصول)

دقیقاً ۱۲ بسته، همان‌هایی که در پنل FazerCards نمایش داده می‌شوند. **هیچ عددی ساخته‌ی ما نیست.**

| استارز | قیمت نمایش‌داده‌شده |
|---|---|
| 50 | $0.7632 |
| 100 | $1.5263 |
| 200 | $3.0525 |
| 250 | $3.8157 |
| 500 | $7.6313 |
| 750 | $11.4469 |
| 1000 | $15.2625 |
| 1500 | $22.8938 |
| 2000 | $30.525 |
| 3000 | $45.7875 |
| 5000 | $76.3125 |
| 10000 | $152.625 |

**نکته‌ی طراحی حیاتی:** این قیمت‌ها ثابت نیستند. بررسی شد که همه‌ی آن‌ها دقیقاً
`price_per_star × quantity` هستند (با اختلاف کمتر از یک سنت در چند مورد، که همان رُند کردن است).
پس قیمت باید **در لحظه** از نرخ زنده محاسبه شود و هرگز به‌عنوان عدد ثابت در کاتالوگ ذخیره نشود.
بازه‌ی پله‌ها دقیقاً همان `min_amount`/`max_amount` خود API (۵۰ تا ۱۰۰۰۰) را پوشش می‌دهد.

پلن‌های پرمیوم مستقیماً از پاسخ API می‌آیند و قیمتشان هم از همان‌جا خوانده می‌شود.

## حاشیه سود

**۵ درصد**، و باید در پنل ادمین قابل تنظیم باشد تا بعداً تغییر کند (نه یک عدد hardcode).
از `PricingRuleScope.TOP_UP_GAME` استفاده می‌شود.

## فضای SKU

```
telegram:stars:<quantity>     quantity ∈ {50,100,200,250,500,750,1000,1500,2000,3000,5000,10000}
telegram:premium:<months>     months ∈ {3,6,12}
```

هر بخش سوم ناشناخته → `INVALID_PROVIDER_SKU`. adapter هرگز حدس نمی‌زند.

## قاعده‌ی اصلی: صفر WorkItem

طبق قاعده‌ی مالک محصول، برای تاپ‌آپ مستقیم **هیچ WorkItem/تسکی برای اپراتور ساخته نمی‌شود**؛
فقط سابقه‌ی کامل ثبت می‌شود تا اپراتور بتواند trace کند. اگر در فرآیند خرید یا برگرداندن پاسخ
API مشکلی پیش بیاید، آن‌وقت باید یک تسک برای همان سفارش ساخته شود و نتیجه‌ی بررسی از همان مسیر
به کاربر توسط اپراتور اعلام شود. جزئیات schema در
[topup-foundation-design.md](topup-foundation-design.md).

**گلوگاه شناسایی‌شده:** `WorkItemsService.onOrderPaid` نوع کار را از `findOrderQuoteTarget`
می‌گیرد، که برای هر چیزی جز SERVICE مقدار `'SKU'` برمی‌گرداند
([prisma-workitem.store.ts:97](../apps/api/src/modules/workitems/prisma-workitem.store.ts#L97)).
یعنی سفارش تلگرام در صف گیفت‌کارت به‌عنوان `MANUAL_GIFT_CARD_FULFILLMENT` می‌افتد — دقیقاً همان
چیزی که ممنوع است. پس trigger تلگرام باید `FULFILLMENT_TRIGGER` را برای سفارش‌های تاپ‌آپ
**جایگزین** کند، نه اینکه فقط یک adapter اضافه شود.

## مراحل باقی‌مانده

1. ~~Recon: استخراج قرارداد از OpenAPI و راستی‌آزمایی مسیرهای read-only~~ — انجام شد.
2. ~~تعیین پکیج‌های استارز و حاشیه سود~~ — انجام شد (بالا).
3. adapter + وایرینگ env/factory با تست mocked.
4. Foundation pass (schema، contracts، migration) + `TopUpFulfillmentService` و مسیر صفر-WorkItem.
5. UI بخش مستقل `/telegram` (منو، صفحه اصلی، فوتر — دسکتاپ و موبایل).
6. تست end-to-end mocked برای هر دو محصول (استارز و پرمیوم).
7. **تأیید شکل واقعی `order` فقط با یک خرید واقعی کم‌مبلغ** — تصمیم انسانی جدا، خارج از این مرحله.
