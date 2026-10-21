-- Money invariants (security proposals wave 1).
--
-- Turns application-level "only one" rules into database guarantees, using the
-- same pattern as WorkItem.activeOrderKey: a key column that holds the order id
-- only while the row is live, under a UNIQUE index.
--
-- The pre-flight block refuses to run on data that already breaks one of the
-- new invariants, naming which one, instead of failing on an anonymous unique
-- violation or silently picking a winner. Run ops/sql/money-invariants-precheck.sql
-- (read-only) on production first.

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (SELECT 1 FROM "Order" GROUP BY "quoteId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'money_invariants: % quote(s) anchor more than one order', n; END IF;

  SELECT count(*) INTO n FROM (SELECT 1 FROM "Payment" WHERE status = 'PAID' GROUP BY "orderId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'money_invariants: % order(s) have more than one PAID payment', n; END IF;

  SELECT count(*) INTO n FROM (SELECT 1 FROM "GiftCardAsset" GROUP BY "orderId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'money_invariants: % order(s) have more than one gift-card asset', n; END IF;

  SELECT count(*) INTO n FROM (SELECT 1 FROM "Fulfillment" WHERE "supplierId" IS NOT NULL AND "supplierOrderId" IS NOT NULL GROUP BY "supplierId", "supplierOrderId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'money_invariants: % supplier order(s) are recorded on more than one fulfillment', n; END IF;

  SELECT count(*) INTO n FROM (SELECT 1 FROM "AbandonmentRecord" WHERE "quoteId" IS NOT NULL GROUP BY type, "quoteId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'money_invariants: % duplicate abandonment record(s) per quote', n; END IF;

  SELECT count(*) INTO n FROM (SELECT 1 FROM "AbandonmentRecord" WHERE "cartId" IS NOT NULL GROUP BY type, "cartId" HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'money_invariants: % duplicate abandonment record(s) per cart', n; END IF;
END $$;

-- AlterEnum
ALTER TYPE "ReconciliationIssueType" ADD VALUE 'provider_already_verified_mismatch';
ALTER TYPE "ReconciliationIssueType" ADD VALUE 'gateway_verified_local_closed';

-- DropForeignKey
ALTER TABLE "QuoteComponent" DROP CONSTRAINT "QuoteComponent_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentAttempt" DROP CONSTRAINT "PaymentAttempt_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicket" DROP CONSTRAINT "SupportTicket_workItemId_fkey";

-- DropForeignKey
ALTER TABLE "FulfillmentChecklist" DROP CONSTRAINT "FulfillmentChecklist_workItemId_fkey";

-- DropForeignKey
ALTER TABLE "GiftCardCodeRequest" DROP CONSTRAINT "GiftCardCodeRequest_workItemId_fkey";

-- DropIndex
DROP INDEX "Order_quoteId_idx";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "liveOrderKey" TEXT,
ADD COLUMN     "paidOrderKey" TEXT;

-- AlterTable
ALTER TABLE "Fulfillment" ADD COLUMN     "activeOrderKey" TEXT;

-- AlterTable
ALTER TABLE "GiftCardAsset" ADD COLUMN     "liveOrderKey" TEXT,
ADD COLUMN     "replacementApprovedByStaffId" TEXT,
ADD COLUMN     "replacementReason" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededByAssetId" TEXT;

-- AlterTable
ALTER TABLE "DeliveryAttempt" ADD COLUMN     "initiatedByStaffId" TEXT;

-- AlterTable
ALTER TABLE "ReconciliationIssue" ADD COLUMN     "openDedupeKey" TEXT;

-- CreateTable
CREATE TABLE "SupplierPurchaseAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "offerId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'IN_FLIGHT',
    "openOrderKey" TEXT,
    "providerReference" TEXT,
    "errorCode" TEXT,
    "requestedByStaffId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPurchaseAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPurchaseAttempt_idempotencyKey_key" ON "SupplierPurchaseAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPurchaseAttempt_openOrderKey_key" ON "SupplierPurchaseAttempt"("openOrderKey");

-- CreateIndex
CREATE INDEX "SupplierPurchaseAttempt_status_startedAt_idx" ON "SupplierPurchaseAttempt"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPurchaseAttempt_orderId_generation_key" ON "SupplierPurchaseAttempt"("orderId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_liveOrderKey_key" ON "Payment"("liveOrderKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paidOrderKey_key" ON "Payment"("paidOrderKey");

-- CreateIndex
CREATE UNIQUE INDEX "Fulfillment_activeOrderKey_key" ON "Fulfillment"("activeOrderKey");

-- CreateIndex
CREATE UNIQUE INDEX "Fulfillment_supplierId_supplierOrderId_key" ON "Fulfillment"("supplierId", "supplierOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardAsset_liveOrderKey_key" ON "GiftCardAsset"("liveOrderKey");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardAsset_supersededByAssetId_key" ON "GiftCardAsset"("supersededByAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "AbandonmentRecord_type_quoteId_key" ON "AbandonmentRecord"("type", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "AbandonmentRecord_type_cartId_key" ON "AbandonmentRecord"("type", "cartId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationIssue_openDedupeKey_key" ON "ReconciliationIssue"("openDedupeKey");

-- AddForeignKey
ALTER TABLE "QuoteComponent" ADD CONSTRAINT "QuoteComponent_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentChecklist" ADD CONSTRAINT "FulfillmentChecklist_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardCodeRequest" ADD CONSTRAINT "GiftCardCodeRequest_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardAsset" ADD CONSTRAINT "GiftCardAsset_supersededByAssetId_fkey" FOREIGN KEY ("supersededByAssetId") REFERENCES "GiftCardAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardAsset" ADD CONSTRAINT "GiftCardAsset_replacementApprovedByStaffId_fkey" FOREIGN KEY ("replacementApprovedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_initiatedByStaffId_fkey" FOREIGN KEY ("initiatedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPurchaseAttempt" ADD CONSTRAINT "SupplierPurchaseAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPurchaseAttempt" ADD CONSTRAINT "SupplierPurchaseAttempt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPurchaseAttempt" ADD CONSTRAINT "SupplierPurchaseAttempt_requestedByStaffId_fkey" FOREIGN KEY ("requestedByStaffId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the live-row keys. Where several rows are live for one order (only
-- possible for open gateway sessions and non-terminal fulfillments, which the
-- old code allowed), the newest keeps the key; older open sessions are closed by
-- the abandoned-session scanner rather than by this migration.
UPDATE "Payment" p SET "liveOrderKey" = p."orderId"
FROM (
  SELECT DISTINCT ON ("orderId") id FROM "Payment"
  WHERE status IN ('CREATED', 'REDIRECTED', 'PENDING')
  ORDER BY "orderId", "createdAt" DESC
) live
WHERE p.id = live.id;

UPDATE "Payment" SET "paidOrderKey" = "orderId" WHERE status = 'PAID';

UPDATE "Fulfillment" f SET "activeOrderKey" = f."orderId"
FROM (
  SELECT DISTINCT ON ("orderId") id FROM "Fulfillment"
  WHERE status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL')
  ORDER BY "orderId", "createdAt" DESC
) active
WHERE f.id = active.id;

UPDATE "GiftCardAsset" SET "liveOrderKey" = "orderId";
