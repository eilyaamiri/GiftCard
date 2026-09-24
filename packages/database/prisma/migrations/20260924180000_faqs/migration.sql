-- CreateTable
CREATE TABLE "Faq" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Faq_isEnabled_sortOrder_idx" ON "Faq"("isEnabled", "sortOrder");

-- AddForeignKey
ALTER TABLE "Faq" ADD CONSTRAINT "Faq_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed with the questions the storefront already shows from static content, so
-- switching the page over to this table does not empty it. Unlike support
-- channels this set stays open afterward: an admin can add to, reorder or
-- remove any of these rows.
INSERT INTO "Faq" ("id", "question", "answer", "isEnabled", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('faq_delivery', 'بعد از پرداخت، گیفت‌کارت چه زمانی به دستم می‌رسد؟', 'بیشتر سفارش‌ها چند دقیقه پس از تأیید پرداخت آماده می‌شوند و کد را در پنل کاربری‌تان می‌بینید. اگر سفارشی به بررسی دستی نیاز داشته باشد، وضعیتش در همان صفحه مشخص است و بی‌خبر نمی‌مانید.', true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('faq_pricing', 'قیمت نهایی چطور محاسبه می‌شود؟', 'قیمت از نرخ لحظه‌ای ارز به‌علاوهٔ کارمزد مشخص ساخته می‌شود و پیش از پرداخت، کامل و بدون هزینهٔ پنهان به شما نشان داده می‌شود. تا وقتی تأیید نکنید، هیچ مبلغی قطعی نیست.', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('faq_failed_payment', 'اگر پرداختم ناموفق شد ولی مبلغ کسر شده بود چه کنم؟', 'اگر وجه کسر شود و سفارش تأیید نشود، مبلغ به‌صورت خودکار به حسابتان برمی‌گردد. در مواردی که برگشت خودکار انجام نشود، سفارش برای بررسی دستی ثبت می‌شود و می‌توانید آن را از پنل کاربری پیگیری کنید.', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('faq_region', 'کارت را برای کدام کشور انتخاب کنم؟', 'هر گیفت‌کارت فقط در منطقهٔ خودش فعال می‌شود و منطقهٔ هر کارت روی همان کارت نوشته شده است. اگر مطمئن نیستید حساب مقصدتان به کدام کشور تعلق دارد، پیش از خرید از پشتیبانی بپرسید.', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('faq_invalid_code', 'اگر کد فعال نشد چه اتفاقی می‌افتد؟', 'کدی که فعال نشود جایگزین می‌شود یا مبلغش بازمی‌گردد. کافی است از پنل کاربری برای همان سفارش تیکت بزنید تا بررسی شود.', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('faq_services', 'هزینهٔ سرویس‌های بین‌المللی را هم می‌توانم از اینجا پرداخت کنم؟', 'بله. برای فضای ابری، دامنه و هاستینگ، ابزارهای هوش مصنوعی، دوره‌های آموزشی و اشتراک‌های نرم‌افزاری درخواست پرداخت ثبت کنید؛ بقیهٔ کار با ماست.', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
