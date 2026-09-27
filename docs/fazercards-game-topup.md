# FazerCards Game Top-up

## وضعیت

این سند فقط طراحی و دستورالعمل پیاده‌سازی است؛ هنوز هیچ اتصال FazerCards، تغییری در دیتابیس، یا تغییر UI انجام نشده است.

هدف، اضافه‌کردن FazerCards به‌عنوان سرویس‌دهنده‌ی Game Top-up است؛ به‌صورتی که کاربر پس از پرداخت پیش‌فاکتور، اطلاعات حساب بازی را وارد کند و سپس شارژ مستقیم روی همان حساب انجام شود.

پنل ادمین و پنل اپراتور در این مرحله تغییر نمی‌کنند، مگر برای نمایش وضعیت یا رسیدگی به سفارش ناموفق.

## چرا فرم جداگانه لازم است؟

گیفت‌کارت بعد از خرید یک کد، PIN یا لینک دارد و مقصد آن مستقل از سفارش است. در Game Top-up، FazerCards باید بداند شارژ روی کدام حساب بازی انجام شود؛ بنابراین داده‌ی مقصد بخشی از سفارش است و باید بعد از پرداخت از کاربر دریافت شود.

فیلدها برای همه‌ی بازی‌ها یکسان نیستند:

- بعضی بازی‌ها فقط `playerId` می‌خواهند.
- بعضی بازی‌ها `playerId` و `zoneId` یا `serverId` می‌خواهند.
- بعضی بازی‌ها ممکن است شناسه یا اطلاعات تکمیلی اختصاصی داشته باشند.

فرم باید بر اساس متادیتای offer یا بازی به‌صورت داینامیک ساخته شود، نه با یک فرم ثابت برای همه‌ی بازی‌ها.

## جریان کامل سفارش

1. کاربر بازی و offer را انتخاب می‌کند.
2. سیستم یک پیش‌فاکتور با supplier، offer و مبلغ نهایی ایجاد می‌کند.
3. کاربر پیش‌فاکتور را پرداخت می‌کند.
4. سیستم فقط پس از تأیید قطعی پرداخت، سفارش را به وضعیت «نیازمند اطلاعات مقصد» می‌برد.
5. صفحه‌ی سفارش یا صفحه‌ی تکمیل سفارش، فرم اطلاعات حساب بازی را نمایش می‌دهد.
6. اطلاعات مقصد در یک endpoint احراز‌شده ثبت می‌شود و به همان سفارش پرداخت‌شده متصل می‌ماند.
7. در صورت پشتیبانی FazerCards، شناسه با endpoint اعتبارسنجی بررسی می‌شود.
8. پس از اعتبارسنجی، API سفارش FazerCards با `Idempotency-Key` ارسال می‌شود.
9. وضعیت سفارش با پاسخ اولیه و سپس polling یا webhook پیگیری می‌شود.
10. نتیجه‌ی نهایی در سفارش نمایش داده می‌شود:
    - شارژ موفق
    - در حال پردازش
    - ناموفق و نیازمند بررسی یا بازپرداخت

کاربر باید بتواند فرم را بعداً تکمیل کند؛ بستن مرورگر نباید باعث از بین رفتن سفارش یا نیاز به پرداخت دوباره شود.

## تغییرات دامنه و API داخلی

### نوع تحویل

در قرارداد supplier، یک نوع تحویل جدید لازم است:

```ts
{
  assetType: 'DIRECT_TOPUP',
  recipient: {
    gameId: string,
    fields: Record<string, string>
  },
  amount: {
    amount: string,
    currency: string
  }
}
```

نام و شکل نهایی باید با مدل فعلی fulfillment و دیتابیس هماهنگ شود. اطلاعات خام حساس نباید در لاگ، ایمیل، یا پاسخ عمومی API قرار گیرد.

### درخواست خرید supplier

`SupplierPurchaseRequest` باید بتواند مقصد Game Top-up را منتقل کند، بدون اینکه قرارداد گیفت‌کارت خراب شود. گزینه‌ی پیشنهادی افزودن یک فیلد اختیاری است:

```ts
interface SupplierTopupRecipient {
  readonly gameId: string;
  readonly fields: Readonly<Record<string, string>>;
}

interface SupplierPurchaseRequest {
  // existing fields remain unchanged
  readonly topupRecipient?: SupplierTopupRecipient;
}
```

برای گیفت‌کارت، این فیلد ارسال نمی‌شود. برای Top-up، adapter فقط فیلدهایی را به FazerCards می‌فرستد که offer همان بازی اعلام کرده است.

### endpointهای داخلی پیشنهادی

نام endpointها باید با conventions فعلی API نهایی شود، اما تفکیک مسئولیت باید این باشد:

- `GET /api/orders/:orderId/topup-form` — دریافت schema فیلدهای لازم برای offer.
- `PUT /api/orders/:orderId/topup-recipient` — ثبت یا اصلاح اطلاعات مقصد، فقط برای صاحب سفارش و فقط پیش از شروع fulfillment.
- `POST /api/orders/:orderId/topup-submit` — اجرای اعتبارسنجی مقصد و شروع خرید supplier، با idempotency داخلی.
- `GET /api/orders/:orderId` — نمایش وضعیت سفارش و نتیجه‌ی نهایی.

ثبت اطلاعات مقصد و شروع خرید باید دو عملیات جدا باشند تا کاربر بتواند خطای شناسه را اصلاح کند، بدون اینکه دوباره خرید supplier ایجاد شود.

### وضعیت‌های سفارش

حداقل وضعیت‌های قابل تشخیص:

- `PAYMENT_CONFIRMED`
- `AWAITING_TOPUP_DETAILS`
- `TOPUP_DETAILS_SUBMITTED`
- `TOPUP_VALIDATING`
- `FULFILLMENT_PENDING`
- `FULFILLED`
- `FULFILLMENT_FAILED`
- `OPERATOR_REVIEW`

اگر مدل فعلی نام‌های دیگری دارد، وضعیت‌های جدید باید به همان state machine موجود اضافه شوند و مسیر پرداخت گیفت‌کارت تغییر نکند.

## adapter FazerCards

یک adapter مستقل در `integrations/suppliers` ساخته می‌شود؛ domain نباید مستقیماً به endpointهای FazerCards یا نام فیلدهای آن وابسته شود.

اطلاعاتی که adapter باید پوشش دهد:

- کاتالوگ و offerهای Game Top-up
- قیمت و currency
- availability
- اعتبارسنجی شناسه‌ی بازی، در صورت پشتیبانی offer
- ایجاد سفارش Top-up
- دریافت وضعیت سفارش
- موجودی حساب reseller
- نگاشت خطاهای FazerCards به کدهای داخلی و بدون انتشار متن خام provider

Endpointهای FazerCards که در بررسی اولیه شناسایی شدند:

- `GET /topups`
- `GET /topups/offers?category_id=...`
- `GET /topups/validate-id`
- `POST /topups/validate-id`
- `POST /topups/order`
- `GET /orders/:orderId`
- `GET /balance`

قبل از نوشتن adapter باید schema دقیق request/response هر endpoint از OpenAPI یا مستندات رسمی همان حساب FazerCards دوباره تطبیق داده شود؛ خلاصه‌ی اولیه‌ی docs به‌تنهایی برای ارسال سفارش live کافی نیست.

هر درخواست خرید باید هدر idempotency داشته باشد:

```http
X-API-Key: <server-side secret>
Idempotency-Key: <stable internal purchase key>
```

کلید idempotency باید در تمام retryهای یک سفارش ثابت بماند و با retry جدید عوض نشود.

## نگهداری اطلاعات مقصد

- اطلاعات مقصد به `orderId` متصل و فقط توسط صاحب سفارش قابل مشاهده و ویرایش باشد.
- پس از شروع درخواست supplier، ویرایش مقصد قفل شود.
- مقدارهای واردشده trim و از نظر طول، کاراکتر و فرمت در مرز API اعتبارسنجی شوند.
- در لاگ‌ها مقدار کامل شناسه‌ها چاپ نشود؛ در صورت نیاز فقط نسخه‌ی mask‌شده ثبت شود.
- پاسخ عمومی API نباید raw response یا tokenهای FazerCards را برگرداند.
- در صورت نیاز به نگهداری بلندمدت، داده‌های مقصد باید با سیاست محرمانگی داده‌ی سفارش ذخیره شوند؛ در غیر این صورت فقط مقدار لازم برای fulfillment نگهداری شود.

## ملاحظات پرداخت

پرداخت باید قبل از ثبت سفارش supplier قطعی شده باشد. endpoint ثبت مقصد نباید به‌تنهایی باعث خرید شود.

برای جلوگیری از دوباره‌خریدن:

- سفارش داخلی باید قفل یا idempotent باشد.
- یک سفارش supplier برای هر order داخلی مجاز باشد.
- retry شبکه از همان idempotency key استفاده کند.
- اگر وضعیت provider نامشخص است، قبل از ایجاد سفارش جدید `GET /orders/:orderId` provider فراخوانی شود.
- refund یا operator review برای payment موفق ولی fulfillment ناموفق از مسیر فعلی سفارش‌ها استفاده کند.

## UI موردنیاز

### صفحه‌ی انتخاب

در کنار کارت‌های گیفت‌کارت، دسته یا صفحه‌ی جداگانه‌ی Game Top-up لازم است. هر offer باید مشخص کند:

- نام بازی
- نام پکیج
- قیمت فروش
- ارز یا واحد شارژ
- کشور/منطقه‌ی پشتیبانی‌شده
- فیلدهای موردنیاز مقصد

### صفحه‌ی بعد از پرداخت

پس از تأیید پرداخت، به جای نمایش موفقیت نهایی، اگر اطلاعات مقصد ثبت نشده باشد کاربر باید CTA واضحی مثل «تکمیل اطلاعات شارژ» ببیند.

فرم باید شامل این موارد باشد:

- توضیح اینکه شارژ مستقیم و غیرقابل برگشت است.
- نمایش نام بازی و پکیج انتخاب‌شده.
- فیلدهای داینامیک با label و مثال مناسب.
- نمایش خلاصه‌ی اطلاعات قبل از تأیید.
- تأیید نهایی کاربر برای صحت شناسه.
- وضعیت اعتبارسنجی و خطای قابل فهم.

بعد از ثبت موفق، همان صفحه وضعیت پردازش را نشان دهد و نیاز به refresh دستی نداشته باشد؛ polling باید محدود، قابل توقف، و مطابق rate limit provider باشد.

## API key FazerCards: روش امن تحویل

**کلید API را در چت، تیکت، commit، فایل مستندات، screenshot یا پیام Slack ارسال نکنید.** حتی اگر این چت خصوصی باشد، محل مناسبی برای نگهداری secret نیست.

روش پیشنهادی:

1. کلید را در password manager یا secret manager تیم نگه دارید.
2. برای محیط توسعه، آن را فقط در فایل env محلیِ ignore‌شده قرار دهید؛ فایل نمونه فقط نام متغیر را داشته باشد:

```dotenv
FAZERCARDS_ENABLED=false
FAZERCARDS_API_KEY=
FAZERCARDS_BASE_URL=https://api.fzr.cards/api/v2
FAZERCARDS_TIMEOUT_MS=20000
```

3. برای staging/production، کلید را به‌عنوان secret سمت سرور یا secret محیط deploy ثبت کنید؛ هرگز `NEXT_PUBLIC_` نباشد و هرگز به bundle مرورگر نرسد.
4. به من فقط اطلاع دهید که secret در محیط موردنظر با نام `FAZERCARDS_API_KEY` قرار گرفته است؛ لازم نیست مقدار آن را بفرستید.
5. اگر کلید قبلاً در چت، repository یا log ارسال شده است، ابتدا آن را revoke/rotate کنید و فقط کلید جدید را در secret manager قرار دهید.

در زمان پیاده‌سازی، adapter از env سمت API خوانده می‌شود و کلید فقط در header درخواست server-to-server استفاده خواهد شد. UI و browser نباید مستقیماً به FazerCards وصل شوند.

## فعال‌سازی ایمن

- مقدار `FAZERCARDS_ENABLED` پیش‌فرض `false` باشد.
- deploy اولیه با provider خاموش انجام شود.
- ابتدا catalog و balance read-only آزمایش شود.
- خرید live فقط بعد از تطبیق schema، mapping offerها، تست validate-id و تأیید انسانی فعال شود.
- هیچ تستی نباید ناخواسته endpoint خرید live را صدا بزند.
- محیط sandbox در بررسی اولیه پیدا نشد؛ بنابراین تست خرید واقعی باید با یک offer کم‌ریسک و سقف مالی مشخص انجام شود.

## مراحل اجرایی پیشنهادی

1. تطبیق schema رسمی FazerCards و تعیین مدل دقیق هر بازی.
2. اضافه‌کردن مدل offer و recipient به قرارداد داخلی.
3. اضافه‌کردن migration و stateهای لازم برای سفارش.
4. ساخت adapter FazerCards با تست‌های mocked برای پاسخ‌های موفق، خطا، timeout، rate limit و retry.
5. ساخت endpointهای داخلی ثبت/اعتبارسنجی recipient.
6. ساخت UI انتخاب offer و فرم داینامیک بعد از پرداخت.
7. اتصال fulfillment و polling/webhook وضعیت.
8. اجرای تست read-only با کلید staging یا production محدودشده.
9. فعال‌سازی خرید فقط پس از تأیید دستی و بررسی log/monitoring.
