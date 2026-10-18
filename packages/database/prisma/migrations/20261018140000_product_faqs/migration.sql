-- Per-product FAQ
CREATE TABLE "ProductFaq" (
    "id"          TEXT         NOT NULL,
    "productId"   TEXT,
    "topUpGameId" TEXT,
    "serviceId"   TEXT,
    "question"    TEXT         NOT NULL,
    "answer"      TEXT         NOT NULL,
    "isEnabled"   BOOLEAN      NOT NULL DEFAULT true,
    "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFaq_pkey" PRIMARY KEY ("id")
);

-- Exactly one target must be set.
ALTER TABLE "ProductFaq" ADD CONSTRAINT "ProductFaq_one_target"
  CHECK (
    (CASE WHEN "productId"   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "topUpGameId" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "serviceId"   IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- FKs
ALTER TABLE "ProductFaq" ADD CONSTRAINT "ProductFaq_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductFaq" ADD CONSTRAINT "ProductFaq_topUpGameId_fkey"
  FOREIGN KEY ("topUpGameId") REFERENCES "TopUpGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductFaq" ADD CONSTRAINT "ProductFaq_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "InternationalService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "ProductFaq_productId_isEnabled_sortOrder_idx"   ON "ProductFaq"("productId", "isEnabled", "sortOrder");
CREATE INDEX "ProductFaq_topUpGameId_isEnabled_sortOrder_idx" ON "ProductFaq"("topUpGameId", "isEnabled", "sortOrder");
CREATE INDEX "ProductFaq_serviceId_isEnabled_sortOrder_idx"   ON "ProductFaq"("serviceId", "isEnabled", "sortOrder");
