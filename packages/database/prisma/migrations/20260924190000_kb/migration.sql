-- CreateTable
CREATE TABLE "KbCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'book-open',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KbArticle" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isPromoted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KbCategory_slug_key" ON "KbCategory"("slug");

-- CreateIndex
CREATE INDEX "KbCategory_isEnabled_sortOrder_idx" ON "KbCategory"("isEnabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "KbArticle_categoryId_slug_key" ON "KbArticle"("categoryId", "slug");

-- CreateIndex
CREATE INDEX "KbArticle_isEnabled_sortOrder_idx" ON "KbArticle"("isEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "KbArticle_isPromoted_idx" ON "KbArticle"("isPromoted");

-- AddForeignKey
ALTER TABLE "KbCategory" ADD CONSTRAINT "KbCategory_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KbCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KbArticle" ADD CONSTRAINT "KbArticle_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed a starter knowledge base, mirroring the Faq migration's approach, so
-- `/help` is never empty on first deploy. An admin can freely add, reorder or
-- remove any of these rows afterward — nothing here is a fixed set.
INSERT INTO "KbCategory" ("id", "slug", "name", "description", "icon", "isEnabled", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('kb_cat_getting_started', 'getting-started', 'شروع کار', 'با برات آشنا شوید و اولین خریدتان را در چند دقیقه انجام دهید.', 'book-open', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_cat_orders', 'orders-and-payments', 'سفارش و پرداخت', 'روش‌های پرداخت، قیمت‌گذاری و پیگیری سفارش‌ها را اینجا بخوانید.', 'credit-card', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_cat_gift_cards', 'gift-cards', 'گیفت‌کارت‌ها', 'نحوه استفاده از گیفت‌کارت‌ها و رفع مشکلات رایج کدها.', 'gift', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_cat_support', 'support-and-refunds', 'پشتیبانی و مرجوعی', 'چطور با پشتیبانی تماس بگیرید و شرایط مرجوعی وجه را بدانید.', 'life-buoy', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "KbArticle" ("id", "categoryId", "slug", "title", "excerpt", "content", "isEnabled", "isPromoted", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('kb_art_what_is_barat', 'kb_cat_getting_started', 'what-is-barat', 'برات چیست و چطور کار می‌کند؟', 'با چهار قدم ساده اولین خریدتان را از برات انجام دهید.', 'برات یک فروشگاه آنلاین گیفت‌کارت و پرداخت سرویس‌های بین‌المللی است.

## چطور خرید کنیم؟

1. محصول یا سرویس مورد نظر را انتخاب کنید.
2. جزئیات سفارش را وارد کنید.
3. قیمت نهایی را ببینید و پرداخت را انجام دهید.
4. کد یا نتیجه سفارش را در پنل کاربری خود دریافت کنید.

همه چیز شفاف است: پیش از پرداخت، قیمت نهایی و زمان تقریبی تحویل را می‌بینید.', true, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_art_create_account', 'kb_cat_getting_started', 'create-account', 'چطور حساب کاربری بسازم؟', 'ساخت حساب کاربری در برات فقط چند ثانیه طول می‌کشد.', 'برای ساخت حساب کاربری کافی است:

- روی دکمه **ورود / ثبت‌نام** در بالای صفحه بزنید.
- شماره موبایل یا ایمیل خود را وارد کنید.
- کد تأیید را وارد کنید تا حساب شما فعال شود.

بعد از ساخت حساب می‌توانید سفارش‌های خود را در پنل کاربری دنبال کنید.', true, false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_art_payment_methods', 'kb_cat_orders', 'payment-methods', 'چه روش‌های پرداختی پشتیبانی می‌شود؟', 'روش‌های پرداخت داخلی موجود برای تسویه سفارش‌ها.', 'برات چند روش پرداخت داخلی را پشتیبانی می‌کند.

## روش‌های موجود

- کارت‌های بانکی عضو شتاب
- درگاه‌های پرداخت آنلاین معتبر

روش‌های موجود بسته به نوع سفارش شما در صفحه پرداخت نمایش داده می‌شود.', true, true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_art_failed_order', 'kb_cat_orders', 'failed-order', 'چرا سفارشم ناموفق شد؟', 'دلایل رایج ناموفق ماندن سفارش و مسیر بازگشت وجه.', 'چند دلیل رایج برای ناموفق ماندن سفارش وجود دارد:

1. موجودی محصول در لحظه پرداخت به پایان رسیده باشد.
2. اطلاعات وارد شده برای حساب مقصد نادرست باشد.
3. تراکنش بانکی توسط بانک شما رد شده باشد.

در همه این موارد مبلغ کسر شده به حساب شما بازمی‌گردد یا سفارش برای بررسی دستی ثبت می‌شود؛ وضعیت را از پنل کاربری پیگیری کنید.', true, false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_art_how_to_redeem', 'kb_cat_gift_cards', 'how-to-redeem', 'چطور از گیفت‌کارت استفاده کنم؟', 'مراحل کلی فعال‌سازی یک گیفت‌کارت در حساب مقصد.', 'هر گیفت‌کارت یک کد فعال‌سازی دارد که باید در حساب مربوط به همان فروشگاه وارد شود.

## مراحل کلی

1. وارد حساب کاربری خود در فروشگاه مقصد شوید.
2. بخش «افزودن موجودی» یا Redeem را پیدا کنید.
3. کد گیفت‌کارت را وارد کنید.

راهنمای دقیق هر برند را می‌توانید از صفحه همان محصول ببینید.', true, false, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_art_invalid_code', 'kb_cat_gift_cards', 'invalid-code', 'کد گیفت‌کارت فعال نشد، چه کنم؟', 'راه‌حل‌های سریع و مسیر پیگیری برای کدهای فعال‌نشده.', 'اگر کد فعال نشد:

- مطمئن شوید کد را بدون فاصله اضافه وارد کرده‌اید.
- منطقه حساب مقصد را با منطقه کارت مطابقت دهید.
- در صورت ادامه مشکل، از پنل کاربری برای همان سفارش تیکت ثبت کنید تا بررسی شود.

کدهای فعال‌نشده جایگزین می‌شوند یا مبلغشان بازمی‌گردد.', true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_art_contact_support', 'kb_cat_support', 'contact-support', 'چطور با پشتیبانی تماس بگیرم؟', 'راه‌های ارتباط با تیم پشتیبانی برات.', 'برای تماس با پشتیبانی چند راه دارید:

- ثبت تیکت از پنل کاربری، بخش پشتیبانی.
- استفاده از راه‌های ارتباطی نمایش داده شده در بخش تماس با ما.

تیم پشتیبانی معمولاً در کوتاه‌ترین زمان ممکن پاسخ می‌دهد.', true, false, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('kb_art_refund_policy', 'kb_cat_support', 'refund-policy', 'شرایط مرجوعی وجه چیست؟', 'مواردی که شامل بازگشت وجه می‌شوند و نحوه پیگیری آن‌ها.', 'اگر سفارشی انجام نشود یا مشکلی در تحویل پیش بیاید، مبلغ پرداختی طبق بررسی تیم پشتیبانی به حساب شما بازمی‌گردد.

## مواردی که شامل مرجوعی می‌شود

- کد فعال نشده و جایگزین هم ممکن نباشد.
- سفارش قبل از تحویل توسط سیستم لغو شود.

برای پیگیری مرجوعی، از پنل کاربری تیکت ثبت کنید.', true, false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
