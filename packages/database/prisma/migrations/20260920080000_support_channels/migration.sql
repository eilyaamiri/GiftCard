-- CreateEnum
CREATE TYPE "SupportChannelKind" AS ENUM ('PHONE', 'TELEGRAM', 'WHATSAPP', 'TICKET');

-- CreateTable
CREATE TABLE "SupportChannel" (
    "id" TEXT NOT NULL,
    "kind" "SupportChannelKind" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportChannel_kind_key" ON "SupportChannel"("kind");

-- CreateIndex
CREATE INDEX "SupportChannel_isEnabled_sortOrder_idx" ON "SupportChannel"("isEnabled", "sortOrder");

-- AddForeignKey
ALTER TABLE "SupportChannel" ADD CONSTRAINT "SupportChannel_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the four rows the panel edits. They are created here rather than by the
-- panel so that the set of channels stays closed, and they start disabled with
-- an empty value so nothing reaches the storefront until an admin fills one in.
INSERT INTO "SupportChannel" ("id", "kind", "isEnabled", "title", "description", "value", "sortOrder", "createdAt", "updatedAt")
VALUES
    ('spch_phone', 'PHONE', false, 'تماس تلفنی', 'پاسخ‌گویی در ساعات کاری', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('spch_telegram', 'TELEGRAM', false, 'تلگرام', 'گفت‌وگو با پشتیبانی در تلگرام', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('spch_whatsapp', 'WHATSAPP', false, 'واتساپ', 'گفت‌وگو با پشتیبانی در واتساپ', '', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('spch_ticket', 'TICKET', false, 'ثبت تیکت', 'پیگیری کتبی با شمارهٔ رهگیری', '/account/support', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
