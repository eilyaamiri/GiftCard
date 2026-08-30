# برنامهٔ اجرایی پروژهٔ Barat Pay — International Commerce POC

> نسخه ۱ — تاریخ تدوین: ۱۴۰۵/۰۶/۰۸ (2026-08-30)
> مبنا: کل مستندات موجود در `_extract/Barat Pay/` (۹ سند Prompt، ۳ سند Provider، ۲ سند آموزش اپراتور، ۳ سند تحلیل رقیب، ۲ ست پروتوتایپ UI، مدل مالی XLSX، دو دک استراتژی)

---

## ۱. خلاصهٔ پروژه

**Barat Pay** یک پلتفرم تجارت دیجیتال بین‌المللی است که با پرداخت ریالی به کاربر ایرانی دسترسی به ارزش دیجیتال جهانی می‌دهد. POC دو خط سرویس دارد:

1. **Gift Card** — ۱۰ تا ۲۰ SKU پرتکرار (Apple، Google Play، PlayStation، Steam، Netflix، Xbox، Amazon) در Regionهای کنترل‌شده، با **Fulfillment دستی توسط اپراتور**.
2. **International Payment** — پرداخت سرویس‌های خارجی: SaaS، ابزارهای AI، Cloud، Domain/Hosting، دوره‌های آموزشی، هزینهٔ آزمون.

**خارج از دامنه:** حواله‌های بزرگ، نقد کردن درآمد ارزی، افتتاح حساب خارجی، کارت بانکی، اتوماسیون کامل Supplier.

### اهداف اقتصادی (از مدل مالی و دک هیئت‌مدیره)
| شاخص | مقدار مبنا |
|---|---|
| مدت POC | ۶–۸ هفته، پایلوت زنده از هفتهٔ ۴ |
| GMV ماهانهٔ اولیهٔ هدف | ۱۰٬۰۰۰–۲۵٬۰۰۰ دلار |
| Net Take Rate (نمونه) | ۸٪ از GMV |
| Variable Cost | ۲.۲٪ از GMV |
| AOV (نمونه) | ۲٬۰۰۰٬۰۰۰ تومان |
| Contribution/Order | ~۱۱۶٬۰۰۰ تومان |
| نرخ برنامه‌ریزی USD/IRT | ۱۹۲٬۰۰۰ تومان (قابل ویرایش) |
| بودجهٔ توسعهٔ POC | ~۰.۹–۱.۱ میلیارد تومان |
| سرمایه در گردش اولیه | ~۰.۱–۰.۳ میلیارد تومان (جدا از بودجهٔ نرم‌افزار) |
| SLA تحویل هدف | P50 < 10s، P95 < 30s پس از تأیید پرداخت (برای مسیر خودکار؛ در POC دستی SLA دقیقه‌ای است) |

### دروازهٔ GO / NO-GO (هفتهٔ ۷–۸)
- **GO**: Contribution مثبت و تکرارپذیر + تأمین پایدار + سیگنال Repeat قابل قبول + صفر خطای بحرانی پرداخت/تطبیق.
- **NO-GO / بازطراحی**: حاشیه فقط با اسپرد غیررقابتی مثبت شود، هزینهٔ پشتیبانی بالا، تأمین ناپایدار، نرخ تبدیل پایین بدون مسیر بازیابی.

---

## ۲. معماری نهایی

### تصمیم معماری: Modular Monolith
میکروسرویس **نداریم**. یک `apps/api` با ماژول‌های دامنه‌ای مرزبندی‌شده. دلیل: POC باید سریع و ارزان باشد و اقتصاد را اثبات کند، نه مقیاس را.

### ساختار مخزن (طبق `POC Repository.docx` — غیرقابل تغییر)

```
GiftCard/                          ← ریشهٔ گیت (github.com/eilyaamiri/GiftCard)
├── apps/
│   ├── web/                       # Next.js — سایت مشتری (RTL فارسی، mobile-first 320px+)
│   ├── admin/                     # Next.js — پنل ادمین + میزکار اپراتور (RBAC)
│   ├── api/                       # NestJS — Modular Monolith
│   └── worker/                    # NestJS standalone + BullMQ — jobهای async
├── packages/
│   ├── database/                  # Prisma schema + migrations + seed
│   ├── contracts/                 # Zod schemas + typeهای مشترک + enumها + DTO
│   ├── ui/                        # @barat/ui — design system + Vazirmatn
│   ├── config/                    # tsconfig / eslint / tailwind preset مشترک
│   └── test-utils/                # factory، fixture، deterministic seed
├── integrations/
│   ├── fx/                        # FxRateProvider + Mock + Primary/Secondary
│   ├── payments/                  # RialPaymentProvider + Mock + zarinpal/
│   ├── suppliers/                 # SupplierProvider + Mock + tillo/reloadly/runa/giftbit
│   └── notifications/             # SmsProvider / EmailProvider + Mock
├── docs/                          # product / architecture / operations / security / integrations
├── tests/                         # e2e / payment / pricing / reconciliation
├── .claude/agents/                # تعریف ایجنت‌های موازی (Opus / Sonnet)
├── AGENTS.md
├── README.md
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

> **نکته:** سند اصلی نام پوشه را `international-commerce/` گفته، ولی مخزن گیت شما `GiftCard` است. مونوریپو را در **ریشهٔ همان مخزن** می‌سازیم و نام `international-commerce` را در `package.json` ریشه به‌عنوان `name` می‌گذاریم. ساخت پوشهٔ تودرتو ارزش افزوده ندارد.

### قانون طلایی وابستگی (قابل تست خودکار)
```
apps/*  →  packages/contracts  →  (هیچ)
apps/api  →  packages/database, integrations/*  (فقط از طریق interface)
integrations/*  →  packages/contracts  (هرگز نه برعکس)
```
هستهٔ دامنه (`pricing`, `quotes`, `orders`) **هرگز** حق `import` مستقیم از `zarinpal`، `tillo`، `reloadly` و … را ندارد. این را با یک قانون ESLint (`no-restricted-imports`) در فاز ۰ قفل می‌کنیم تا ایجنت‌های موازی نتوانند تصادفی نقضش کنند.

### ۱۵ ماژول دامنه در `apps/api/src/modules/`
`identity` · `catalog` · `pricing` · `fx` · `quotes` · `orders` · `payments` · `suppliers` · `fulfillment` · `customers` · `notifications` · `finance` · `reconciliation` · `admin` · `audit`
(+ دو ماژول افزوده بر اساس اسناد اپراتور: `workitems` و `reporting`)

---

## ۳. استک فنی — نسخه‌های دقیق و راستی‌آزمایی‌شده

نسخه‌ها همین امروز از `registry.npmjs.org` استعلام شدند (نه از حافظه):

### هسته
| پکیج | نسخه | یادداشت |
|---|---|---|
| `node` | **24.x LTS** | نصب فعلی شما `v24.18.0` ✅ (آخرین انتشار ۲۶.۸.۱ است ولی Next/Nest حداقل ۲۰ می‌خواهند؛ روی ۲۴ می‌مانیم) |
| `pnpm` | **11.24.0** | ⚠️ روی این سیستم نصب نیست — `corepack enable && corepack prepare pnpm@11.24.0 --activate` |
| `turbo` | **2.10.12** | |
| `typescript` | **7.0.2** | ⚠️ TS 7 کامپایلر native (Go) است. تصمیم باز — بخش ۹ |

### Frontend (`apps/web`, `apps/admin`)
| پکیج | نسخه |
|---|---|
| `next` | **16.3.3** |
| `react` / `react-dom` | **19.2.8** |
| `tailwindcss` + `@tailwindcss/postcss` | **4.3.3** |
| `@tanstack/react-query` | **5.102.8** |
| `react-hook-form` | **7.87.0** |
| `@hookform/resolvers` | **5.9.1** |
| `lucide-react` | **1.37.0** |
| `clsx` / `tailwind-merge` | **2.1.1** / **3.6.0** |
| `date-fns-jalali` | **4.4.0-0** (تقویم شمسی) |

### Backend (`apps/api`, `apps/worker`)
| پکیج | نسخه |
|---|---|
| `@nestjs/core` / `@nestjs/common` | **12.0.1** |
| `@nestjs/config` | **12.0.0** |
| `@nestjs/swagger` | **12.0.1** |
| `@nestjs/throttler` | **6.5.0** (rate limiting) |
| `helmet` | **8.3.0** |
| `nestjs-pino` + `pino` | **4.6.1** + **10.3.1** |
| `class-validator` / `class-transformer` | **0.15.1** / **0.5.1** |
| `zod` | **4.5.4** |
| `bullmq` + `ioredis` | **6.3.2** + **6.0.0** |
| `argon2` | **0.45.1** (هش OTP) |
| `jose` | **6.2.10** (JWT session) |
| `nanoid` | **6.0.1** (customerCode / idempotency key) |
| `decimal.js` | **10.6.0** (محاسبات مالی) |

### دیتابیس
| پکیج | نسخه | یادداشت |
|---|---|---|
| `prisma` / `@prisma/client` | **7.10.0** | ⚠️ تگ `latest` روی `8.0.0-rc.12` است. **RC را در پروژهٔ مالی استفاده نمی‌کنیم.** ۷.۱۰.۰ آخرین پایدار (تگ `prev`) است. |
| `@prisma/adapter-pg` + `pg` | **7.10.0** + **8.23.0** |
| PostgreSQL (Docker) | **17-alpine** |
| Redis (Docker) | **8-alpine** |

### فونت
| پکیج | نسخه |
|---|---|
| `vazirmatn` | **33.0.3** ← ترجیح (فایل خام WOFF2 + variable) |
| `@fontsource/vazirmatn` | 5.3.0 (جایگزین) |

### تست و کیفیت
| پکیج | نسخه |
|---|---|
| `vitest` | **4.1.11** |
| `@playwright/test` | **1.62.1** |
| `supertest` | **7.2.2** |
| `@faker-js/faker` | **10.6.0** |
| `eslint` | **10.9.1** |
| `@typescript-eslint/eslint-plugin` | **8.68.0** |
| `prettier` | **3.9.6** |
| `husky` / `lint-staged` | **9.1.7** / **17.4.1** |

> **سیاست نسخه:** همه با `pin` دقیق (بدون `^`) در `package.json` تا ایجنت‌های موازی همگی روی یک نسخه بسازند. ارتقا فقط با تصمیم انسانی و یک PR جدا.

---

## ۴. مدل داده

### گروه ۱ — هویت و مشتری
`Customer` · `CustomerIdentity` (unique: `type + valueNormalized`) · `CustomerProfile` · `OtpChallenge` (فقط hash) · `AuthSession` · `CommerceSession` · `CustomerNote` · `CustomerFlag` · `RewardAccount` *(آماده ولی پیاده‌سازی‌نشده)*

### گروه ۲ — کاتالوگ و تأمین
`Product` · `Sku` · `Supplier` · `SupplierOffer` (چند offer برای یک SKU) · `InternationalService` · `ServiceFieldDefinition`

### گروه ۳ — قیمت‌گذاری و ارز
`FxRate` (pair, buyRate, sellRate, source, provider, receivedAt, effectiveAt, expiresAt, isManualOverride) · `PricingRule` · `Quote` · `QuoteComponent`

### گروه ۴ — سفارش و پرداخت
`Order` · `Payment` (+ فیلدهای ZarinPal: providerAuthority, providerRefId, providerAmount, providerAmountUnit, maskedCard, …) · `PaymentAttempt` · `Refund`

### گروه ۵ — عملیات
`WorkItem` · `Queue` · `FulfillmentChecklist` · `FulfillmentChecklistItem` · `TaskChecklistTemplate` · `Fulfillment` · `GiftCardAsset` (رمزنگاری‌شده) · `DeliveryAttempt`

### گروه ۶ — تحلیل و مالی
`Cart` · `CartItem` · `FunnelEvent` · `AbandonmentRecord` · `ReconciliationIssue` · `AuditLog` · `FeatureFlag` · `User` (کارکنان) · `Role` · `Team`

### قواعد آهنین مدل داده
1. همهٔ مبالغ ریالی `BigInt` (IRR صحیح). **هیچ `Float` مالی وجود ندارد.**
2. مبالغ ارزی `Decimal(18,6)`.
3. درصدها **basis point** صحیح‌اند (`100 bps = 1٪`).
4. `Quote` پس از شروع پرداخت **immutable** است — snapshot کامل، نه reference.
5. `GiftCardAsset.encryptedCode` / `encryptedPin` — رمزنگاری در سطح اپلیکیشن (AES-256-GCM)، کلید از env/secret manager. هیچ‌جا plaintext ذخیره یا لاگ نمی‌شود.
6. هیچ حذف فیزیکی سابقهٔ مالی — فقط status تغییر می‌کند.
7. `Delivery Asset Type` روی `GiftCardAsset`: `CODE` | `CODE_PIN` | `URL` | `PROVIDER_DIRECT_EMAIL` — چون Reloadly/Runa/Giftbit اصلاً کد خام به اپراتور نمی‌دهند و فقط Tillo می‌دهد. **این یک یافتهٔ مهم از اسناد Provider است که مدل ساده‌سازی‌شدهٔ «اپراتور همیشه کد وارد می‌کند» را باطل می‌کند.**

---

## ۵. موتور قیمت‌گذاری

### فرمول (تک منبع حقیقت)
```
effectiveFxRate   = marketFxRate + fxSpread(bps) + fxRiskBuffer(bps)
supplierCostIrr   = supplierCostUsd × effectiveFxRate
subtotal          = supplierCostIrr
                  + paymentFee(bps + fixed)
                  + serviceFee(bps + fixed)
                  + operationalFee(fixed)
                  + margin(targetMarginBps, حداقل minimumMarginIrr)
                  − discount
finalAmountIrr    = roundUp(subtotal, roundingStepIrr)
displayAmountToman = finalAmountIrr / 10
```

### `PricingRule` — همه پیکربندی‌پذیر، هیچ مقدار hardcode
`fxSpreadBps` · `fxRiskBufferBps` · `serviceFeeBps` · `serviceFeeFixedIrr` · `operationalFeeIrr` · `targetMarginBps` · `minimumMarginIrr` · `paymentFeeBps` · `paymentFeeFixedIrr` · `quoteTtlSeconds` · `roundingStepIrr` · `maxSupplierCostToleranceBps`

### سیاست FX Aggregator (به ترتیب)
1. Primary provider اگر healthy و fresh
2. Secondary اگر primary کهنه (stale)
3. Manual override ادمین (auditable، با هشدار «override فعال است»)
4. اگر همه کهنه‌تر از آستانه → **ساخت Quote رد می‌شود** (خطای صریح، نه تخمین)
5. در هر Quote ثبت می‌شود کدام نرخ/provider استفاده شده

### قواعد Quote
- TTL پیش‌فرض ۵–۱۰ دقیقه، پیکربندی‌پذیر؛ شمارنده در فرانت.
- وضعیت: `ACTIVE` · `EXPIRED` · `ACCEPTED` · `CANCELLED`
- اگر FX بیش از آستانه حرکت کرد → Requote اجباری.
- Quote منقضی **هرگز** برای بازیابی سبد خرید استفاده نمی‌شود — Quote جدید با نرخ روز.
- `Quote.finalAmountIrr` باید با `Order.totalAmountIrr` و `Payment.amountIrr` یکی باشد؛ عدم تطابق ⇒ رویداد امنیتی `AMOUNT_MISMATCH` و توقف.

### Quote Simulator (ادمین)
ورودی: SKU، Supplier، Supplier Cost، USD Rate، Spread، Risk Buffer، Gateway Fee، Service Fee، Margin
خروجی: Supplier Cost، FX Cost، Fees، Margin، Customer Price، Margin ٪، Contribution
**همان تابع خالص هسته را صدا می‌زند** — نه یک کپی دوم از فرمول.

---

## ۶. تقسیم‌بندی کار برای ایجنت‌های موازی

### اصل جداسازی
هر workstream **مالکیت انحصاری مجموعه‌ای از دایرکتوری‌ها** را دارد. دو ایجنت هرگز همزمان روی یک فایل نمی‌نویسند. هماهنگی فقط از طریق `packages/contracts` که در فاز ۰ **قفل** می‌شود.

### ۷ ایجنت Opus — بخش‌های بحرانی

| کد | Workstream | مالکیت دایرکتوری | چرا Opus |
|---|---|---|---|
| **O1** | Core Platform | ریشه، `packages/config`, `packages/contracts`, `packages/database/schema.prisma`, `AGENTS.md` | قراردادها و اسکیما ریشهٔ همه چیزند؛ خطا اینجا کل موازی‌کاری را خراب می‌کند |
| **O2** | Money & Pricing Engine | `apps/api/src/modules/pricing`, `packages/contracts/money` | صحت مالی؛ Decimal/BigInt؛ basis point |
| **O3** | FX Aggregator | `apps/api/src/modules/fx`, `integrations/fx` | سیاست stale/override؛ خطا اینجا = ضرر مستقیم |
| **O4** | Payments & ZarinPal | `apps/api/src/modules/payments`, `integrations/payments` | verify سمت سرور، idempotency، code 100/101، amount unit |
| **O5** | Orders, Fulfillment & Asset Security | `apps/api/src/modules/orders`, `fulfillment`, `workitems` | ماشین حالت، رمزنگاری GiftCardAsset، gating چک‌لیست |
| **O6** | Identity, RBAC & Security | `apps/api/src/modules/identity`, `audit`, `apps/api/src/common/security` | OTP، session، RBAC سمت سرور، rate limit، secret handling |
| **O7** | Finance & Reconciliation | `apps/api/src/modules/finance`, `reconciliation`, `reporting/aggregates` | تعریف GMV/Revenue/Contribution؛ خطا = گزارش غلط به هیئت‌مدیره |

### ۸ ایجنت Sonnet 5 — کارهای ساده‌تر

| کد | Workstream | مالکیت دایرکتوری |
|---|---|---|
| **S1** | Design System + Vazirmatn | `packages/ui`, `packages/config/tailwind` |
| **S2** | Customer Web | `apps/web` |
| **S3** | Admin Panel | `apps/admin/src/app/(admin)` |
| **S4** | Operator Workspace | `apps/admin/src/app/(operator)` |
| **S5** | Reporting UI + Analytics Events | `apps/admin/src/app/(reports)`, `apps/api/src/modules/analytics` |
| **S6** | QA / E2E / Seed | `tests`, `packages/test-utils` |
| **S7** | Documentation | `docs` |
| **S8** | DevOps & CI | `docker-compose.yml`, `.github/workflows`, `apps/*/Dockerfile` |

### گراف همروندی

```
فاز ۰ ─┬─ O1  (قفل قراردادها + اسکیما)     ← مسدودکننده
       ├─ S1  (توکن‌ها + Vazirmatn)         ← موازی، وابستگی ندارد
       ├─ S8  (docker + CI)                 ← موازی
       └─ S7  (AGENTS.md + docs اسکلت)      ← موازی

        ▼ (پس از O1)
فاز ۱ ─┬─ O2 ─┐
       ├─ O3 ─┤
       ├─ O6  │                    S2 (اسکلت صفحات)
       └──────┘                    S3 (اسکلت صفحات)
        ▼ (O2+O3 ⇒ Quote آماده)
فاز ۲ ─┬─ O4 ──────┐
       └─ O5 ◄─────┘ (O5 روی Mock کار می‌کند تا O4 برسد)
        ▼
فاز ۳ ─┬─ S4 (Operator UI)   ← نیاز به O5
       ├─ S3 (تکمیل Admin)
       └─ S2 (تکمیل Web)     ← نیاز به O4 برای checkout
        ▼
فاز ۴ ─┬─ O7 (Finance/Reconciliation)
       ├─ S5 (داشبوردها)
       └─ S6 (E2E کامل)
        ▼
فاز ۵ ─── پایلوت زنده + GO/NO-GO
```

### تنظیمات `.claude/agents/` (خروجی فاز ۰)
هر workstream یک فایل `.md` می‌گیرد با: `model` (opus / sonnet)، `scope`، `allowed directories`، `forbidden directories`، `dependencies`، `required tests`، `definition of done`.

نمونهٔ frontmatter:
```yaml
---
name: pricing-engine
description: موتور قیمت‌گذاری، ابزارهای پول، basis point
model: opus
tools: Read, Write, Edit, Bash, Grep, Glob
---
```

### دروازه‌های انسانی (غیرقابل عبور توسط ایجنت)
هیچ ایجنتی حق merge خودکار در این حوزه‌ها را ندارد:
**Payment · Pricing rules · FX policy · Security & secrets · Production release · Manager approval برای انحراف هزینه**

---

## ۷. فازبندی اجرا (۸ هفته)

### فاز ۰ — پی‌ریزی (روز ۱–۳)
- [ ] مونوریپو pnpm + Turborepo با نسخه‌های pin‌شده
- [ ] `AGENTS.md` ریشه با ۱۳ قانون مهندسی
- [ ] `packages/contracts` — همهٔ enumها، Zod schemaها، DTOها **(قفل می‌شود)**
- [ ] `packages/database` — اسکیمای کامل Prisma برای ۶ گروه موجودیت
- [ ] `docker-compose.yml` — PostgreSQL 17 + Redis 8
- [ ] `.env.example` + اعتبارسنجی config با Zod (fail-fast)
- [ ] اسکافولد ۴ اپ
- [ ] قانون ESLint مرز import (هسته ⇏ integration)
- [ ] `.claude/agents/*.md` برای ۱۵ workstream
- [ ] Vazirmatn + توکن‌های طراحی در Tailwind preset

### فاز ۱ — هستهٔ مالی (هفتهٔ ۱–۲)
- [ ] ابزارهای پول: IRR/Toman، Decimal، basis point، rounding — **۱۰۰٪ پوشش تست**
- [ ] Pricing Engine + `PricingRule` + تست واحد کامل (شامل edge caseها)
- [ ] `MockFxRateProvider` + Aggregator + سیاست stale
- [ ] Quote API + TTL + snapshot immutable
- [ ] Identity: OTP (mobile/email)، AuthSession، RBAC سمت سرور
- [ ] Quote Simulator در Admin
- [ ] صفحهٔ محصول + Quote در Web (ریسپانسیو تا 320px)

### فاز ۲ — سفارش و پرداخت (هفتهٔ ۳)
- [ ] ماشین حالت Order (۱۲ حالت، بدون رشتهٔ دلخواه)
- [ ] `MockRialPaymentProvider` → سپس `ZarinPalPaymentProvider`
- [ ] Callback + **verify سمت سرور** + idempotency (تست: ۵ بار callback ⇒ ۱ Payment)
- [ ] سیاست `ZARINPAL_AMOUNT_UNIT` (IRR/IRT) با تست هر دو حالت
- [ ] ساخت `WorkItem` دقیقاً یک‌بار پس از commit تراکنش
- [ ] `GiftCardAsset` با رمزنگاری + ماسک + audit دسترسی

### فاز ۳ — عملیات (هفتهٔ ۳–۴)
- [ ] `OperatorTaskShell` + `TaskWorkspaceRegistry` (۷ نوع task)
- [ ] `FulfillmentChecklist` سمت backend + gating `SEND_TO_CUSTOMER`
- [ ] Manager Approval برای انحراف هزینه
- [ ] پشتیبانی از ۴ نوع Delivery Asset (CODE / CODE+PIN / URL / PROVIDER_DIRECT_EMAIL)
- [ ] Customer 360 برای اپراتور
- [ ] Admin: کاتالوگ، SKU، Supplier، PricingRule، FeatureFlag، تنظیمات

### فاز ۴ — گزارش، تطبیق و تست (هفتهٔ ۵–۶)
- [ ] `docs/product/metrics.md` — تعریف ۲۱ متریک با فرمول و منبع
- [ ] ماژول `reporting/` با ۱۱ زیرماژول + DTO تایپ‌دار
- [ ] داشبوردها: Executive، Profitability، Operations، Finance، Exceptions
- [ ] قواعد Reconciliation (۱۴ نوع mismatch)
- [ ] رویدادهای Funnel + تحلیل رها‌شدن سبد
- [ ] E2E Playwright: seed دترمینیستیک (۱۰۰ Quote → ۸۰ Checkout → ۶۵ Paid → ۶۰ Fulfilled) و تطابق دقیق اعداد داشبورد

### فاز ۵ — پایلوت و تصمیم (هفتهٔ ۷–۸)
- [ ] چک‌لیست آمادگی ZarinPal production (۱۱ بند) — بدون فعال‌سازی خودکار
- [ ] تراکنش‌های واقعی محدود
- [ ] تحلیل Unit Economics، Repeat، Failure
- [ ] گزارش GO/NO-GO

---

## ۸. سیستم طراحی

### فونت — Vazirmatn (طبق درخواست شما)
پروتوتایپ‌ها `IRANSans` / `IRANSansX` / `InterLocal` / `NotoArabic` استفاده کرده‌اند. همه با **Vazirmatn** جایگزین می‌شوند:

```ts
// packages/ui/src/fonts.ts
import localFont from 'next/font/local'

export const vazirmatn = localFont({
  src: '../fonts/Vazirmatn[wght].woff2',   // variable، 100–900
  variable: '--font-vazirmatn',
  display: 'swap',
  preload: true,
})
```
- منبع: پکیج `vazirmatn@33.0.3` (فایل‌های WOFF2 variable + `Vazirmatn-FD` برای ارقام فارسی)
- برای ارقام: کلاس `.fa-num` با `font-feature-settings` یا نسخهٔ `Vazirmatn-FD`
- مبالغ و کدها همچنان `direction: ltr; unicode-bidi: isolate` می‌مانند (وگرنه کد گیفت‌کارت برعکس رندر می‌شود)

### توکن‌های رنگ (استخراج‌شده از پروتوتایپ‌ها — یکسان در هر دو ست)
```js
// packages/config/tailwind-preset.js
colors: {
  brand:   { navy:'#0B1D33', navy2:'#102A46', ink:'#13243A', teal:'#21B4B0', teal2:'#46D0CB', slate:'#6B7C93' },
  surface: { paper:'#FFFFFF', soft:'#F6F8FA', mint:'#DFF7F5', line:'#DCE4EA', line2:'#E6EBF0' },
  status:  {
    green:'#18A66A', red:'#D94A4A', amber:'#D98B19', purple:'#7157D9',
    okBg:'#E7F7F0', okFg:'#12835D',
    waitBg:'#FFF5DC', waitFg:'#9D6B00',
    infoBg:'#EAF4FF', infoFg:'#2B69A0',
  },
}
```

### سایر توکن‌ها
- **Radius**: `sm 8` · `md 12` · `lg 18` · `xl 22` · `2xl 28` · `full 999`
- **Shadow**: `card 0 8px 24px rgba(11,29,51,.08)` · `modal 0 30px 90px rgba(0,0,0,.25)`
- **Focus ring**: `outline 3px solid rgba(33,180,176,.25); offset 2px`
- **Breakpoints**: `sm 560px` · `md 900px` · `lg 1440px` (دقیقاً همان‌هایی که پروتوتایپ موبایل دارد)
- **Container**: marketing `max-w-[1440px]` · admin `max-w-[1600px]`

### قواعد RTL
- `<html dir="rtl" lang="fa">`
- الگوی دوزبانه: `.fa[dir=rtl]` برای فارسی، `.en[dir=ltr]` برای لاتین/عدد
- فلش «ادامه» = `←` نه `→`
- OTP و Gift Card Code همیشه LTR
- **بدون overflow افقی تا 320px** · دکمه ≥ 44px · فونت input ≥ 16px در موبایل

### موجودی صفحات
- **Web (مشتری)**: ۲۵ route از پروتوتایپ — اما در POC فقط زیرمجموعهٔ در دامنه ساخته می‌شود: Home، Services، Gift Cards، Product Detail، Region Select، International Payment، Quote Review، Checkout، Payment Result، Login/OTP، Account (profile/orders/payments/refunds/support)، Tracking، Help.
  *(Barat Card، Virtual Cards، Transfer، Cash، Wallet، Business خارج از دامنهٔ POC هستند — فقط صفحهٔ «به‌زودی».)*
- **Admin**: ۱۵ صفحه از پروتوتایپ Backoffice + بخش‌های Reports/Operations/Administration
- **Operator**: میزکار + لیست task + `/operator/tasks/:id` با ۷ workspace

---

## ۹. تصمیمات باز — نیاز به نظر شما

| # | موضوع | گزینه‌ها | پیشنهاد من |
|---|---|---|---|
| **۱** | **TypeScript 7 vs 5.9** | TS 7.0.2 کامپایلر native است (سریع)، ولی اکوسیستم (typescript-eslint، برخی پلاگین‌ها) ممکن است هنوز کامل پشتیبانی نکند | **با TS 7 شروع کنیم**؛ اگر در فاز ۰ به مشکل tooling خوردیم، fallback به 5.9.x. تصمیم در ۲ ساعت مشخص می‌شود، نه بلوکه‌کننده |
| **۲** | **Prisma 8 RC vs 7.10 stable** | تگ `latest` روی RC است | **7.10.0 پایدار.** برای پروژهٔ مالی RC استفاده نمی‌کنیم. |
| **۳** | **Supplier اول** | Tillo / Reloadly / Runa / Giftbit | **Tillo** — تنها Provider که طبق مستندات رسمی کد خام را به اپراتور نشان می‌دهد (CSV/Excel). بقیه فقط Link یا ایمیل مستقیم به مشتری می‌دهند. اگر مدل «اپراتور کد را وارد می‌کند» الزامی است، Tillo تنها گزینه است. |
| **۴** | **`ZARINPAL_AMOUNT_UNIT`** | IRR یا IRT | **باید از قرارداد merchant واقعی تأیید شود.** کد هر دو را پشتیبانی می‌کند و تبدیل غیربخش‌پذیر را رد می‌کند، ولی مقدار درست را فقط شما می‌دانید. |
| **۵** | **نقش CEO/MANAGEMENT** | سند گزارش‌ها این نقش را فرض کرده ولی در RBAC اصلی نیست | افزودن نقش `MANAGEMENT` به ۵ نقش اصلی (⇒ ADMIN, OPS_MANAGER, OPERATOR, FINANCE, SUPPORT, VIEWER, MANAGEMENT) |
| **۶** | **دامنهٔ Barat Card / Transfer / Cash** | پروتوتایپ ۲۵ صفحه دارد ولی POC فقط Gift Card + International Payment است | صفحات خارج از دامنه فقط «به‌زودی» — کد بک‌اند برایشان نوشته نمی‌شود |
| **۷** | **نصب pnpm** | روی این سیستم نیست | `corepack enable && corepack prepare pnpm@11.24.0 --activate` |

---

## ۱۰. ۱۳ قانون مهندسی (محتوای `AGENTS.md` ریشه)

1. صحت مالی بر سرعت توسعه مقدم است.
2. هرگز از float جاوااسکریپت برای محاسبات مالی استفاده نشود — عدد صحیح یا Decimal.
3. پول ایرانی داخلی به IRR ذخیره می‌شود؛ UI ممکن است تومان نشان دهد؛ هرگز ضمنی مخلوط نشوند — تابع تبدیل صریح.
4. هر محاسبهٔ مالی باید auditable باشد.
5. Order هرگز مستقیماً provider پرداخت خاصی را صدا نمی‌زند.
6. Order هرگز مستقیماً provider ارز خاصی را صدا نمی‌زند.
7. Order هرگز مستقیماً SDK تأمین‌کننده را صدا نمی‌زند — همه از طریق interface/adapter.
8. Callback پرداخت همیشه سمت سرور verify می‌شود.
9. Idempotency الزامی است برای: پرداخت، پذیرش Quote، ساخت Order، Fulfillment.
10. **هرگز لاگ نشود**: توکن پرداخت، secret‌های API، کد گیفت‌کارت، کلید خصوصی، دادهٔ حساس احراز هویت.
11. Quote پس از شروع checkout/پرداخت immutable است.
12. هر تغییر مالی production نیازمند تست است.
13. Payment، Pricing، FX، Security و Production Release نیازمند بازبینی انسانی‌اند.

---

## ۱۱. وضعیت محیط

| مورد | وضعیت |
|---|---|
| Git 2.39.3 | ✅ |
| Node v24.18.0 | ✅ |
| npm 11.16.0 | ✅ |
| gh 2.98.0، احراز هویت‌شده به‌عنوان `eilyaamiri` | ✅ |
| هویت گیت (`155731368+eilyaamiri@users.noreply.github.com`) | ✅ |
| مخزن `origin` → `github.com/eilyaamiri/GiftCard`، شاخهٔ `main`، بدون commit | ✅ |
| Full Disk Access (نوشتن در `.git`) | ✅ |
| دسترسی شبکه (npm registry، github) | ✅ (sandbox باز شد) |
| **pnpm** | ❌ **باید نصب شود** |
| Docker 29.6.1 + Compose v5.2.0 | ✅ |

دستور نصب pnpm:
```bash
corepack enable && corepack prepare pnpm@11.24.0 --activate && pnpm -v
```
