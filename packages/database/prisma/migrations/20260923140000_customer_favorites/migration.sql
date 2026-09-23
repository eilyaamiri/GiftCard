-- CreateEnum
CREATE TYPE "FavoriteItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateTable
CREATE TABLE "CustomerFavorite" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "itemType" "FavoriteItemType" NOT NULL,
    "itemSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFavorite_customerId_itemType_itemSlug_key" ON "CustomerFavorite"("customerId", "itemType", "itemSlug");

-- CreateIndex
CREATE INDEX "CustomerFavorite_customerId_createdAt_idx" ON "CustomerFavorite"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerFavorite" ADD CONSTRAINT "CustomerFavorite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
