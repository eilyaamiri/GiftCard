-- Product reviews.
--
-- A customer's 1–5 star rating of a gift-card product, a direct top-up game or
-- an international service, with an optional plain-text comment. Reviews are
-- moderated: a new or edited review is PENDING, and only APPROVED reviews are
-- shown or counted toward a product's average.
--
-- Purely additive: one new enum, one new table, no existing row touched.
--
-- The three nullable target columns follow `CategoryLink`: real foreign keys,
-- so a review cannot point at nothing, with a CHECK that exactly one is set.
-- Postgres treats NULLs as distinct in a unique index, so the three
-- (customerId, target) uniques each constrain only the rows of their own kind:
-- one review per customer per product, per game and per service.

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "topUpGameId" TEXT,
    "serviceId" TEXT,
    "rating" INTEGER NOT NULL,
    "body" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "isVerifiedBuyer" BOOLEAN NOT NULL DEFAULT false,
    "moderatedAt" TIMESTAMP(3),
    "moderatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id"),
    -- A review rates exactly one thing.
    CONSTRAINT "ProductReview_one_target_chk" CHECK (
        (("productId" IS NOT NULL)::int + ("topUpGameId" IS NOT NULL)::int + ("serviceId" IS NOT NULL)::int) = 1
    ),
    -- Stars, not a score: whole numbers from one to five.
    CONSTRAINT "ProductReview_rating_chk" CHECK ("rating" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE INDEX "ProductReview_productId_status_createdAt_idx" ON "ProductReview"("productId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReview_topUpGameId_status_createdAt_idx" ON "ProductReview"("topUpGameId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReview_serviceId_status_createdAt_idx" ON "ProductReview"("serviceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReview_status_createdAt_idx" ON "ProductReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_customerId_productId_key" ON "ProductReview"("customerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_customerId_topUpGameId_key" ON "ProductReview"("customerId", "topUpGameId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_customerId_serviceId_key" ON "ProductReview"("customerId", "serviceId");

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_topUpGameId_fkey" FOREIGN KEY ("topUpGameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "InternationalService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
