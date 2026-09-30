-- Direct top-up: the foundation for automated game top-up orders.
--
-- A top-up is a separate storefront section with its own catalog tables
-- (TopUpGame / TopUpField / TopUpOffer), deliberately not Product/Sku: the Sku
-- unique constraint cannot represent offers that share a price with a sibling,
-- and keeping top-ups out of Product means no existing gift-card query, search
-- or brand filter can accidentally surface them.
--
-- Delivery is recorded in TopUpFulfillment + TopUpEvent instead of a WorkItem.
-- That is the product owner's rule: a direct top-up is fully automated and no
-- operator task is ever created for it on the happy path. The fulfillment row
-- is the status an operator reads while investigating, and the event table is
-- the append-only trace. A WorkItem is raised only when a purchase genuinely
-- failed or its outcome is ambiguous — never as the normal path.
--
-- Everything here is additive: no column or table is dropped or renamed, no
-- existing row changes. The two ADD VALUE statements add enum members that no
-- statement in this migration then uses, so the Postgres restriction on using a
-- new enum value in the same transaction does not apply. Rollback is dropping
-- the new tables and the nullable Quote column; only the two enum values stay,
-- which is harmless.
-- CreateEnum
CREATE TYPE "TopUpStatus" AS ENUM ('QUEUED', 'WAITING_FUNDS', 'PURCHASING', 'AWAITING_PROVIDER', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TopUpEventType" AS ENUM ('QUEUED', 'ELIGIBILITY_CHECKED', 'BALANCE_CHECKED', 'PURCHASE_REQUESTED', 'PURCHASE_RESPONDED', 'STATUS_POLLED', 'SUCCEEDED', 'FAILED', 'MARKED_UNKNOWN', 'REFUND_OPENED', 'CUSTOMER_NOTIFIED', 'OPERATOR_NOTE', 'OPERATOR_ACTION');

-- AlterEnum
ALTER TYPE "DeliveryAssetType" ADD VALUE 'DIRECT_TOPUP';

-- AlterEnum
ALTER TYPE "PricingRuleScope" ADD VALUE 'TOP_UP_GAME';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "topUpOfferId" TEXT;

-- CreateTable
CREATE TABLE "TopUpGame" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "providerCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFa" TEXT,
    "brandName" TEXT,
    "region" TEXT,
    "imageUrl" TEXT,
    "providerNote" TEXT,
    "descriptionFa" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "requiresCredentials" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpField" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelFa" TEXT,
    "fieldType" "ServiceFieldType" NOT NULL DEFAULT 'TEXT',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "validationRegex" TEXT,
    "helpTextFa" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpOffer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "providerOfferId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameFa" TEXT,
    "costAmount" DECIMAL(18,6) NOT NULL,
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isListed" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpFulfillment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "topUpOfferId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "providerSku" TEXT NOT NULL,
    "accountFields" JSONB NOT NULL,
    "accountReference" TEXT,
    "status" "TopUpStatus" NOT NULL DEFAULT 'QUEUED',
    "providerOrderNumber" TEXT,
    "providerStatus" TEXT,
    "failureCode" TEXT,
    "chargedAmount" DECIMAL(18,6),
    "chargedCurrency" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "purchaseAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextCheckAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopUpFulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopUpEvent" (
    "id" TEXT NOT NULL,
    "topUpFulfillmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "TopUpEventType" NOT NULL,
    "status" "TopUpStatus" NOT NULL,
    "providerStatus" TEXT,
    "failureCode" TEXT,
    "detail" JSONB,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "staffUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopUpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TopUpGame_slug_key" ON "TopUpGame"("slug");

-- CreateIndex
CREATE INDEX "TopUpGame_isActive_isListed_sortOrder_idx" ON "TopUpGame"("isActive", "isListed", "sortOrder");

-- CreateIndex
CREATE INDEX "TopUpGame_brandName_idx" ON "TopUpGame"("brandName");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpGame_supplierId_providerCategoryId_key" ON "TopUpGame"("supplierId", "providerCategoryId");

-- CreateIndex
CREATE INDEX "TopUpField_gameId_sortOrder_idx" ON "TopUpField"("gameId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpField_gameId_key_key" ON "TopUpField"("gameId", "key");

-- CreateIndex
CREATE INDEX "TopUpOffer_gameId_isActive_isListed_sortOrder_idx" ON "TopUpOffer"("gameId", "isActive", "isListed", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpOffer_gameId_providerOfferId_key" ON "TopUpOffer"("gameId", "providerOfferId");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpFulfillment_orderId_key" ON "TopUpFulfillment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "TopUpFulfillment_idempotencyKey_key" ON "TopUpFulfillment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TopUpFulfillment_status_nextCheckAt_idx" ON "TopUpFulfillment"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "TopUpFulfillment_supplierId_createdAt_idx" ON "TopUpFulfillment"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "TopUpEvent_topUpFulfillmentId_createdAt_idx" ON "TopUpEvent"("topUpFulfillmentId", "createdAt");

-- CreateIndex
CREATE INDEX "TopUpEvent_orderId_createdAt_idx" ON "TopUpEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "TopUpEvent_type_createdAt_idx" ON "TopUpEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_topUpOfferId_idx" ON "Quote"("topUpOfferId");

-- AddForeignKey
ALTER TABLE "TopUpGame" ADD CONSTRAINT "TopUpGame_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpField" ADD CONSTRAINT "TopUpField_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpOffer" ADD CONSTRAINT "TopUpOffer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpFulfillment" ADD CONSTRAINT "TopUpFulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpFulfillment" ADD CONSTRAINT "TopUpFulfillment_topUpOfferId_fkey" FOREIGN KEY ("topUpOfferId") REFERENCES "TopUpOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpFulfillment" ADD CONSTRAINT "TopUpFulfillment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpEvent" ADD CONSTRAINT "TopUpEvent_topUpFulfillmentId_fkey" FOREIGN KEY ("topUpFulfillmentId") REFERENCES "TopUpFulfillment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopUpEvent" ADD CONSTRAINT "TopUpEvent_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_topUpOfferId_fkey" FOREIGN KEY ("topUpOfferId") REFERENCES "TopUpOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

