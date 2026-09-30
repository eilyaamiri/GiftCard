# طرح Foundation برای Game Top-up خودکار (پیش‌نویس، منتظر تأیید)

> وضعیت: **فقط طرح**. هنوز هیچ تغییری در `schema.prisma`، `packages/contracts`، migration یا
> `AGENTS.md` اعمال نشده است. اجرا فقط بعد از تأیید صریح این سند انجام می‌شود، روی branch
> جداگانه‌ای که از `origin/main` تازه ساخته می‌شود. migration در production هم مثل همیشه تأیید
> انسانی جداگانه لازم دارد (`AGENTS.md` بند ۱۱۱).

## قاعده‌ی اصلی (از طرف مالک محصول)

برای Direct Top-up **هیچ WorkItem/تسکی برای اپراتور ساخته نمی‌شود**. همه‌ی مراحل را سیستم انجام
می‌دهد. برای هر سفارش فقط **سابقه‌ی کامل** ثبت می‌شود تا اگر مشکلی پیش آمد، اپراتور بتواند آن را
trace کند، پیگیری کند و در صورت امکان حلش کند.

## داده‌ی واقعی که طرح بر اساس آن است (API زنده، ۲۰۲۶-۰۹-۲۸)

- ۳۰۶ بازی در لیست، ۸۱ تا حذف‌شده (offers آن‌ها ۴۰۴ می‌دهد)، پس **۲۲۵ بازی فعال** و
  **۳۹۲۲ آیتم قابل خرید**. بیشترین تعداد آیتم برای یک بازی ۲۸۶ است.
- قیمت‌ها از ۰٫۰۵ تا ۴۰۲۸ دلار است. ۱۵۷۸ آیتم با آیتم دیگری از همان بازی قیمت یکسان دارند.
- فیلدهای حساب در سطح **بازی** تعریف شده‌اند، نه آیتم: `{key, label, type: text|select, options?, required?}`.
- آیتم‌ها `stock` ندارند. هر آیتمی که در لیست باشد قابل خرید است.
- ۴ بازی ایمیل و رمز عبور حساب مشتری را می‌خواهند.

## چرا جدول‌های جدا، نه `Product`/`Sku`

1. **قید یکتایی:** `Sku @@unique([productId, region, faceValue, currency])` با ۱۵۷۸ آیتم هم‌قیمت
   تداخل دارد. آیتم تاپ‌آپ با شناسه‌ی آیتم شناخته می‌شود، نه با قیمت.
2. **جدا ماندن از گیفت‌کارت:** مالک محصول خواسته آیتم‌های تاپ‌آپ با آیتم‌های فعلی قاطی نشوند.
   جدول جدا یعنی هیچ صفحه‌ی گیفت‌کارت، جست‌وجو، brand filter یا quick-pick فعلی آن‌ها را به‌طور
   تصادفی نشان نمی‌دهد.
3. **مسیر تحویل:** مسیر فعلی گیفت‌کارت (`AutoFulfillmentService`) **همیشه** اول یک WorkItem
   می‌سازد (`auto-fulfillment.service.ts:98`) و `ingestAutomatedSupplierResult` بدون WorkItem کار
   نمی‌کند. تاپ‌آپ باید از همان ابتدا مسیر جدای خودش را داشته باشد.

## ۱. تغییرات `schema.prisma`

همه‌ی تغییرات **افزایشی** هستند: هیچ ستون یا جدولی حذف یا rename نمی‌شود و هیچ داده‌ی موجودی
تغییر نمی‌کند.

### ۱-۱. کاتالوگ

```prisma
/// One ReSellCodes top-up category (a game, per region). Never a Product:
/// top-ups are a separate storefront section and never share gift-card surfaces.
model TopUpGame {
  id                 String   @id @default(cuid())
  slug               String   @unique
  supplierId         String
  /// The venue's `category_id`, e.g. `pubg_mobile`. With the offer id it forms
  /// the providerSku, so no SUPPLIER_PROVIDER_SKU_MAP entry is ever needed.
  providerCategoryId String
  name               String
  nameFa             String?
  /// Venue brand grouping (`/top-ups/brands`), e.g. «PUBG Mobile».
  brandName          String?
  /// Raw venue region string (GLOBAL, SEA, ID, ...). Shown, not interpreted.
  region             String?
  imageUrl           String?
  /// Venue's own instructions, English, shown under the account form.
  providerNote       String?
  descriptionFa      String?
  /// Operator switch. A newly synced game starts inactive (see open question 2).
  isActive           Boolean  @default(false)
  /// Set by sync: false once the venue stops listing the game or answers 404.
  isListed           Boolean  @default(true)
  /// The venue wants the customer's login (email + password). Never sold in
  /// phase 1; the quote path refuses these games outright.
  requiresCredentials Boolean @default(false)
  sortOrder          Int      @default(0)
  lastSyncedAt       DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  supplier Supplier       @relation(fields: [supplierId], references: [id])
  fields   TopUpField[]
  offers   TopUpOffer[]

  @@unique([supplierId, providerCategoryId])
  @@index([isActive, isListed, sortOrder])
  @@index([brandName])
}

/// What the customer must type so the venue can credit their game account.
/// Mirrors ServiceFieldDefinition, but scoped to a game.
model TopUpField {
  id         String           @id @default(cuid())
  gameId     String
  /// Venue key, sent back verbatim in `account_fields` (player_id, server, ...).
  key        String
  label      String
  labelFa    String?
  /// Only TEXT and SELECT are produced by sync today.
  fieldType  ServiceFieldType @default(TEXT)
  isRequired Boolean          @default(true)
  /// `[{label, value}]` for SELECT, copied from the venue.
  options    Json?
  validationRegex String?
  helpTextFa String?
  sortOrder  Int              @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  game TopUpGame @relation(fields: [gameId], references: [id], onDelete: Cascade)

  @@unique([gameId, key])
  @@index([gameId, sortOrder])
}

/// One purchasable top-up (e.g. «60 UC»). Identified by the venue offer id,
/// never by price: 1578 live offers share a price with a sibling.
model TopUpOffer {
  id              String   @id @default(cuid())
  gameId          String
  providerOfferId String
  name            String
  nameFa          String?
  /// What we pay the venue for one unit.
  costAmount      Decimal  @db.Decimal(18, 6)
  costCurrency    String   @default("USD")
  isActive        Boolean  @default(true)
  /// Set by sync: false once the offer disappears from the venue list.
  isListed        Boolean  @default(true)
  sortOrder       Int      @default(0)
  lastSyncedAt    DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  game          TopUpGame          @relation(fields: [gameId], references: [id], onDelete: Cascade)
  quotes        Quote[]
  fulfillments  TopUpFulfillment[]

  @@unique([gameId, providerOfferId])
  @@index([gameId, isActive, isListed, sortOrder])
}
```

> `Cascade` فقط برای حذف دستی داده‌ی کاتالوگ است. sync هیچ‌وقت ردیفی را حذف نمی‌کند و فقط
> `isListed=false` می‌گذارد. `TopUpFulfillment` به `TopUpOffer` با `Restrict` وصل است، پس سابقه‌ی
> مالی هرگز با حذف کاتالوگ از بین نمی‌رود (`AGENTS.md` قاعده‌ی ۶).

### ۱-۲. Quote

```prisma
model Quote {
  // ... unchanged ...
  /// Third target kind. Exactly one of skuId / serviceId / topUpOfferId is set
  /// (enforced in QuotesService, as the existing two are today).
  topUpOfferId String?
  topUpOffer   TopUpOffer? @relation(fields: [topUpOfferId], references: [id])
  @@index([topUpOfferId])
}
```

مقادیری که مشتری وارد می‌کند (player id، server و...) طبق الگوی فعلی
`serviceFields`، در `Quote.snapshot.topUp` ذخیره می‌شوند و بعد از checkout تغییرناپذیرند
(`AGENTS.md` قاعده‌ی ۱۱):

```json
{ "kind": "TOP_UP",
  "game":  { "id", "providerCategoryId", "name", "region" },
  "offer": { "id", "providerOfferId", "name", "costAmount", "costCurrency" },
  "accountFields": { "player_id": "5001234567", "server": "asia" } }
```

این فیلدها راز نیستند (شناسه‌ی عمومی حساب بازی). بازی‌های `requiresCredentials` در فاز ۱ اصلاً
فروخته نمی‌شوند، پس هیچ رمزی ذخیره نمی‌شود.

### ۱-۳. سابقه‌ی تحویل: `TopUpFulfillment` + `TopUpEvent`

به‌جای WorkItem، هر سفارش تاپ‌آپ **یک** ردیف وضعیت و یک **لاگ رویداد append-only** دارد:

```prisma
enum TopUpStatus {
  QUEUED            // paid, waiting for the worker
  WAITING_FUNDS     // venue balance too low; retried automatically
  PURCHASING        // POST /top-ups/order in flight
  AWAITING_PROVIDER // venue accepted, still processing; polled automatically
  SUCCEEDED
  FAILED            // venue stated nothing was charged
  UNKNOWN           // venue may have charged; never re-bought automatically
}

enum TopUpEventType {
  QUEUED
  ELIGIBILITY_CHECKED
  BALANCE_CHECKED
  PURCHASE_REQUESTED
  PURCHASE_RESPONDED
  STATUS_POLLED
  SUCCEEDED
  FAILED
  MARKED_UNKNOWN
  REFUND_OPENED
  CUSTOMER_NOTIFIED
  OPERATOR_NOTE
  OPERATOR_ACTION
}

/// The system-driven delivery of one top-up order. Replaces the WorkItem that
/// gift cards use: nothing here is a task, it is the record an operator reads.
model TopUpFulfillment {
  id                 String      @id @default(cuid())
  orderId            String      @unique
  topUpOfferId       String
  supplierId         String
  /// `${providerCategoryId}:${providerOfferId}` as sent. Frozen at purchase.
  providerSku        String
  /// Exactly what was sent as `account_fields`. Copied from the quote snapshot.
  accountFields      Json
  /// What the venue confirms it credited, e.g. `player_id=5001234567`.
  accountReference   String?
  status             TopUpStatus @default(QUEUED)
  /// Venue order number from `POST /top-ups/order`; the handle for polling.
  providerOrderNumber String?
  /// Last venue status string (created/processing/completed/failed/refund).
  providerStatus     String?
  /// Normalised code, never raw venue text (e.g. account_not_found, RATE_LIMITED).
  failureCode        String?
  chargedAmount      Decimal?    @db.Decimal(18, 6)
  chargedCurrency    String?
  /// `topup:${orderId}` — the adapter's in-process duplicate-buy guard key.
  idempotencyKey     String      @unique
  purchaseAttempts   Int         @default(0)
  nextCheckAt        DateTime?
  startedAt          DateTime?
  completedAt        DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  order    Order        @relation(fields: [orderId], references: [id])
  offer    TopUpOffer   @relation(fields: [topUpOfferId], references: [id], onDelete: Restrict)
  supplier Supplier     @relation(fields: [supplierId], references: [id])
  events   TopUpEvent[]

  @@index([status, nextCheckAt])
  @@index([supplierId, createdAt])
}

/// Append-only history of one top-up. Never updated, never deleted.
model TopUpEvent {
  id                 String         @id @default(cuid())
  topUpFulfillmentId String
  orderId            String
  type               TopUpEventType
  /// Status of the fulfillment after this event.
  status             TopUpStatus
  providerStatus     String?
  failureCode        String?
  /// Redacted, structured detail (balances, cost, poll count). Never the API key
  /// or a raw venue body.
  detail             Json?
  /// SYSTEM | STAFF — same vocabulary as AuditLog.actorType.
  actorType          String         @default("SYSTEM")
  staffUserId        String?
  /// Required for OPERATOR_NOTE / OPERATOR_ACTION.
  note               String?
  createdAt          DateTime       @default(now())

  fulfillment TopUpFulfillment @relation(fields: [topUpFulfillmentId], references: [id], onDelete: Restrict)
  staffUser   StaffUser?       @relation("TopUpEventStaff", fields: [staffUserId], references: [id], onDelete: SetNull)

  @@index([topUpFulfillmentId, createdAt])
  @@index([orderId, createdAt])
  @@index([type, createdAt])
}
```

**چرا `Fulfillment` و `GiftCardAsset` دوباره استفاده نمی‌شوند:** کد هر دو به WorkItem گره خورده
(`ensureFulfillment` با `{orderId, workItemId}` پیدا می‌کند و `loadContextByOrder` از قدیمی‌ترین
WorkItem شروع می‌کند). `GiftCardAsset` هم برای کد رمزشده طراحی شده است. تاپ‌آپ کدی ندارد که
مشتری reveal کند؛ فقط تأیید «به این حساب شارژ شد» دارد.

**چرا جدول رویداد جدا، نه فقط `AuditLog`:** `AuditLog` در طول مسیر هم نوشته می‌شود (همان
`SUPPLIER_*`)، ولی هیچ reader یا endpointی برای اپراتور ندارد و با `entity/entityId` عمومی ایندکس
شده است. `TopUpEvent` مخصوص همین سفارش است و مستقیم در صفحه‌ی trace ادمین خوانده می‌شود.

### ۱-۴. enumهای موجود

| enum | تغییر | دلیل |
|---|---|---|
| `DeliveryAssetType` | `+ DIRECT_TOPUP` | GAP مستند در adapter برطرف می‌شود. `order.delivery.assetType` در DTO سفارش می‌تواند نوع تحویل تاپ‌آپ را بگوید. نوع موقت `SupplierAssetType` در `@barat/suppliers` حذف می‌شود. |
| `PricingRuleScope` | `+ TOP_UP_GAME` | margin جدا برای تاپ‌آپ (یا برای یک بازی خاص). بدون آن، قانون `GLOBAL` اعمال می‌شود. |
| `WorkItemType` | **بدون تغییر** | عمداً. هیچ نوع WorkItem جدیدی برای تاپ‌آپ اضافه نمی‌شود. |

## ۲. migration

یک migration افزایشی: `20260928120000_direct_topup` (timestamp بعد از آخرین migration،
`20260924190000_kb`):

1. `ALTER TYPE "DeliveryAssetType" ADD VALUE 'DIRECT_TOPUP';` و همین کار برای `PricingRuleScope`.
   اولین `ADD VALUE` این repo است. در همان migration از مقدار جدید استفاده نمی‌شود، پس محدودیت
   Postgres («مقدار جدید enum در همان transaction قابل استفاده نیست») مشکلی ایجاد نمی‌کند.
2. `CREATE TYPE "TopUpStatus"` و `"TopUpEventType"`.
3. `CREATE TABLE` برای `TopUpGame`، `TopUpField`، `TopUpOffer`، `TopUpFulfillment` و `TopUpEvent`،
   همراه با FKها و ایندکس‌ها.
4. `ALTER TABLE "Quote" ADD COLUMN "topUpOfferId" TEXT` (nullable)، همراه با FK و ایندکس.

SQL با `prisma migrate diff --from-schema <قبلی> --to-schema prisma/schema.prisma --script` تولید
می‌شود و طبق قرارداد repo یک توضیح دلیل در ابتدای آن می‌آید. CI (`migration-replay.yml`)
دوبار `migrate deploy` و `migrate diff --exit-code` را چک می‌کند. هیچ backfill یا تغییر روی
داده‌ی موجود لازم نیست. rollback یعنی drop کردن جدول‌های جدید و ستون nullable؛ فقط دو مقدار
enum قابل حذف نیستند که بی‌ضرر هستند.

## ۳. تغییرات `packages/contracts`

- `enums/operations.ts`: اضافه‌شدن `DIRECT_TOPUP` به `DELIVERY_ASSET_TYPE_VALUES`، و enumهای جدید
  `TOP_UP_STATUS_VALUES` و `TOP_UP_EVENT_TYPE_VALUES`.
- `dto/topup.ts` (جدید): `topUpGameSummary`، `topUpGameDetail` (fields + offers)، و DTOهای ادمین برای
  لیست و trace.
- `dto/quote.ts`: `createQuoteRequestSchema` هدف سوم (`topUpOfferId`) و `topUpFields` را
  می‌گیرد، با قید «دقیقاً یکی از skuId / serviceId / topUpOfferId».
- `dto/order.ts`: بخش اختیاری `topUp` در جزئیات سفارش مشتری، شامل بازی، آیتم، `accountReference`
  و وضعیت قابل‌نمایش. این بخش هیچ `failureCode` خام یا جزئیات داخلی را نشان نمی‌دهد.
- **تست parity جدید** (مثل `queue-names.spec.ts`): هر enum در contracts باید دقیقاً با enum
  Prisma هم‌نام خود برابر باشد. این تست الان وجود ندارد، و همین تغییر اولین جایی است که
  `DeliveryAssetType` در هر دو طرف عوض می‌شود.

## ۴. `AGENTS.md`

بند ۱۶۳ به این شکل درمی‌آید: `DeliveryAssetType` یکی از
`CODE | CODE_PIN | URL | PROVIDER_DIRECT_EMAIL | DIRECT_TOPUP` است. `DIRECT_TOPUP` یعنی
تأمین‌کننده مستقیماً حساب بازی مشتری را شارژ می‌کند و هیچ کدی وجود ندارد. سفارش تاپ‌آپ
**WorkItem نمی‌سازد** و سابقه‌اش در `TopUpFulfillment`/`TopUpEvent` است.

## ۵. جریان خودکار (کد بعد از Foundation، اینجا فقط برای روشن‌کردن اینکه schema چه چیزی را پشتیبانی می‌کند)

```
پرداخت تأیید شد
  └─ FULFILLMENT_TRIGGER: اگر quote.topUpOfferId دارد → TopUpFulfillmentService
       (هرگز workItems.onOrderPaid صدا زده نمی‌شود)
  └─ TopUpFulfillment(QUEUED) + event QUEUED؛ سفارش: PAID → FULFILLMENT_PENDING
  └─ worker (صف جدید `topup-fulfill`):
       eligibility → balance
         ├─ موجودی کم → WAITING_FUNDS، تلاش دوباره خودکار (هر ۱۰ دقیقه، تا N ساعت)
         └─ خرید: سفارش → FULFILLING، POST /top-ups/order با account_fields
              ├─ completed  → SUCCEEDED، سفارش FULFILLED، اطلاع به مشتری
              ├─ processing → AWAITING_PROVIDER، poll GET /orders/{n} با backoff
              ├─ failed/refund/4xx (هزینه‌ای کسر نشده) → FAILED
              │     → سفارش REFUND_PENDING + ردیف Refund(REQUESTED) + اطلاع به مشتری
              └─ 5xx/timeout (شاید کسر شده) → UNKNOWN
                    → اگر شماره‌ی سفارش هست: poll ادامه دارد تا نتیجه روشن شود
                    → اگر نیست: سفارش REVIEW_REQUIRED؛ هرگز خرید دوباره‌ی خودکار
```

- هر گام یک `TopUpEvent` می‌نویسد. همه‌ی تغییر وضعیت‌های سفارش از `order-state-machine` عبور
  می‌کنند، پس timeline مشتری هم پر می‌شود. امروز مسیر گیفت‌کارت PAID و FULFILLED را با update
  مستقیم می‌نویسد و timeline خالی می‌ماند.
- تغییر کوچک در state machine (کد، فریز نیست): اضافه‌شدن `FULFILLING → REFUND_PENDING` برای
  شکست قطعی بعد از شروع خرید.
- **اپراتور تسک نمی‌گیرد.** در ادمین یک صفحه‌ی «سفارش‌های تاپ‌آپ» با فیلتر وضعیت
  (مخصوصاً `UNKNOWN`، `WAITING_FUNDS` و `REFUND_PENDING`) وجود دارد، به‌همراه صفحه‌ی trace هر
  سفارش (همه‌ی eventها). اپراتور می‌تواند اقدام‌های ثبت‌شده انجام دهد: یادداشت، «بررسی دوباره
  وضعیت از تأمین‌کننده»، «علامت‌گذاری موفق با شماره‌ی سفارش تأمین‌کننده»، «خرید دوباره» (فقط
  برای FAILED)، و «بازپرداخت». هر اقدام یک `OPERATOR_ACTION` با نام و یادداشت اپراتور ثبت می‌کند.
- تست اجباری: برای **همه‌ی** نتیجه‌ها (موفق، pending، failed، unknown، کمبود موجودی، بدون adapter)
  تعداد WorkItemهای سفارش تاپ‌آپ باید صفر باشد.

## ۶. پرسش‌های باز (تصمیم مالک محصول)

1. **بازپرداخت پول مشتری:** درگاه فعلی (زرین‌پال) API بازپرداخت ندارد
   (`refund()` → `NOT_SUPPORTED`). پس وقتی تاپ‌آپ قطعاً شکست بخورد، سیستم می‌تواند خودکار ردیف
   `Refund` بسازد، سفارش را `REFUND_PENDING` کند و به مشتری اطلاع دهد. اما **واریز واقعی پول** را
   باید یک نفر انجام دهد (کارت‌به‌کارت یا شبا به حساب ثبت‌شده‌ی مشتری). این یک WorkItem نیست و در
   لیست بازپرداخت‌ها دیده می‌شود، ولی کار انسانی است. پیشنهاد: فعلاً همین روش. کیف پول/اعتبار
   داخلی بعداً می‌تواند این مرحله را کاملاً خودکار کند.
2. **بازی‌های تازه‌ی sync شده:** پیشنهاد این است که غیرفعال بیایند و اپراتور مجموعه‌ی منتخبی را
   (همراه با نام فارسی) روشن کند. گزینه‌ی دیگر این است که هر ۲۲۵ بازی خودکار فعال شوند.
3. **۴ بازی ایمیل/رمز:** پیشنهاد این است که در فاز ۱ فروخته نشوند (`requiresCredentials`).
4. **اصلاح شناسه توسط مشتری:** اگر خرید با `account_not_found` شکست بخورد، مشتری می‌تواند به‌جای
   بازپرداخت، شناسه را اصلاح کند و سیستم دوباره بخرد؟ پیشنهاد: فاز ۲.

## ۷. ترتیب اجرا بعد از تأیید

1. Foundation (یک PR): schema، migration، contracts، تست parity و `AGENTS.md`.
2. sync کاتالوگ (worker job، روزی یک بار. یک sync کامل حدود ۳۰۸ درخواست است، یعنی حدود ۱۱ دقیقه
   با سقف ۳۰ درخواست در دقیقه) و ادمین کاتالوگ تاپ‌آپ.
3. quote و checkout تاپ‌آپ: اعتبارسنجی فیلدها و گرفتن قیمت تازه‌ی همان بازی (۱ درخواست) موقع ساخت quote.
4. `TopUpFulfillmentService`، صف worker، polling، و صفحه‌ی trace ادمین.
5. بخش جدای «شارژ بازی» در سایت (`/top-up` و `/top-up/[slug]`) با لینک مستقل در header، footer و
   منوی موبایل.

`RESELLCODES_TOPUP_ENABLED` در تمام این مراحل خاموش می‌ماند. روشن‌کردنش (خرید واقعی) یک تصمیم
انسانی جداست، و اولین خرید باید با یک آیتم ارزان و زیر نظر انجام شود.
