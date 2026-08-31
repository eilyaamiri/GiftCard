-- CreateEnum
CREATE TYPE "GiftCardRequestKind" AS ENUM ('CODE', 'CODE_PIN');

-- CreateEnum
CREATE TYPE "GiftCardRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GiftCardCodeRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "GiftCardRequestKind" NOT NULL,
    "status" "GiftCardRequestStatus" NOT NULL DEFAULT 'OPEN',
    "openWorkItemKey" TEXT,
    "requestedByStaffId" TEXT NOT NULL,
    "fulfilledByStaffId" TEXT,
    "giftCardAssetId" TEXT,
    "requestReason" TEXT,
    "responseNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardCodeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardCodeRequest_requestNumber_key" ON "GiftCardCodeRequest"("requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardCodeRequest_openWorkItemKey_key" ON "GiftCardCodeRequest"("openWorkItemKey");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardCodeRequest_giftCardAssetId_key" ON "GiftCardCodeRequest"("giftCardAssetId");

-- CreateIndex
CREATE INDEX "GiftCardCodeRequest_status_requestedAt_idx" ON "GiftCardCodeRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "GiftCardCodeRequest_requestedByStaffId_requestedAt_idx" ON "GiftCardCodeRequest"("requestedByStaffId", "requestedAt");

-- CreateIndex
CREATE INDEX "GiftCardCodeRequest_orderId_idx" ON "GiftCardCodeRequest"("orderId");

-- CreateIndex
CREATE INDEX "GiftCardCodeRequest_workItemId_idx" ON "GiftCardCodeRequest"("workItemId");

-- AddForeignKey
ALTER TABLE "GiftCardCodeRequest" ADD CONSTRAINT "GiftCardCodeRequest_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCodeRequest" ADD CONSTRAINT "GiftCardCodeRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCodeRequest" ADD CONSTRAINT "GiftCardCodeRequest_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCodeRequest" ADD CONSTRAINT "GiftCardCodeRequest_fulfilledByStaffId_fkey" FOREIGN KEY ("fulfilledByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCodeRequest" ADD CONSTRAINT "GiftCardCodeRequest_giftCardAssetId_fkey" FOREIGN KEY ("giftCardAssetId") REFERENCES "GiftCardAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
