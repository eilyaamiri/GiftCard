-- Service-list categories.
--
-- A `Category` used to mean one thing: a grouping of gift-card products. It can
-- now also be a hand-curated list of links to services sold elsewhere on the
-- site (a direct top-up, a gift-card product, an international service).
--
-- Purely additive. Every existing category takes the default `PRODUCTS`, so no
-- row changes meaning and no existing query is affected.

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('PRODUCTS', 'SERVICES');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "kind" "CategoryKind" NOT NULL DEFAULT 'PRODUCTS';

-- CreateTable
CREATE TABLE "CategoryLink" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "topUpGameId" TEXT,
    "productId" TEXT,
    "serviceId" TEXT,
    "titleFa" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryLink_pkey" PRIMARY KEY ("id"),
    -- A link points at exactly one thing.
    CONSTRAINT "CategoryLink_one_target_chk" CHECK (
        (("topUpGameId" IS NOT NULL)::int + ("productId" IS NOT NULL)::int + ("serviceId" IS NOT NULL)::int) = 1
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryLink_categoryId_topUpGameId_key" ON "CategoryLink"("categoryId", "topUpGameId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryLink_categoryId_productId_key" ON "CategoryLink"("categoryId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryLink_categoryId_serviceId_key" ON "CategoryLink"("categoryId", "serviceId");

-- CreateIndex
CREATE INDEX "CategoryLink_categoryId_sortOrder_idx" ON "CategoryLink"("categoryId", "sortOrder");

-- AddForeignKey
ALTER TABLE "CategoryLink" ADD CONSTRAINT "CategoryLink_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryLink" ADD CONSTRAINT "CategoryLink_topUpGameId_fkey" FOREIGN KEY ("topUpGameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryLink" ADD CONSTRAINT "CategoryLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryLink" ADD CONSTRAINT "CategoryLink_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "InternationalService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: the two service-list categories. They start with no links, and a
-- SERVICES category with no visible link is never shown to customers, so these
-- rows are invisible until an operator adds something to them.
INSERT INTO "Category" ("id", "slug", "name", "nameFa", "iconKey", "kind", "isActive", "sortOrder", "updatedAt")
VALUES ('cat_utility_software', 'utility-software', 'Utility Software', 'نرم‌افزارهای کاربردی', 'app-window', 'SERVICES', true, 900, CURRENT_TIMESTAMP),
       ('cat_games', 'games', 'Games', 'بازی‌ها', 'gamepad-2', 'SERVICES', true, 901, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
