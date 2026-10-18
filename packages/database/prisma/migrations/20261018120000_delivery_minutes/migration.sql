-- Advertised delivery time per product.
--
-- One nullable integer column, in minutes, on each of the three things a
-- customer can buy: gift-card products, direct top-up games and international
-- services. 0 reads as «آنی»; NULL shows nothing on the storefront.
--
-- Purely additive. Every existing row gets NULL, which is exactly today's
-- behaviour (no delivery line shown), so no row changes meaning and no
-- existing query is affected. The admin panel only offers the preset values in
-- DELIVERY_TIME_PRESETS (@barat/contracts); the CHECK below keeps the column to
-- a non-negative number of minutes no longer than a week, so a bad write
-- through some other path cannot advertise a negative or absurd promise.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "deliveryMinutes" INTEGER;
ALTER TABLE "Product" ADD CONSTRAINT "Product_deliveryMinutes_chk"
  CHECK ("deliveryMinutes" IS NULL OR ("deliveryMinutes" >= 0 AND "deliveryMinutes" <= 10080));

-- AlterTable
ALTER TABLE "TopUpGame" ADD COLUMN "deliveryMinutes" INTEGER;
ALTER TABLE "TopUpGame" ADD CONSTRAINT "TopUpGame_deliveryMinutes_chk"
  CHECK ("deliveryMinutes" IS NULL OR ("deliveryMinutes" >= 0 AND "deliveryMinutes" <= 10080));

-- AlterTable
ALTER TABLE "InternationalService" ADD COLUMN "deliveryMinutes" INTEGER;
ALTER TABLE "InternationalService" ADD CONSTRAINT "InternationalService_deliveryMinutes_chk"
  CHECK ("deliveryMinutes" IS NULL OR ("deliveryMinutes" >= 0 AND "deliveryMinutes" <= 10080));
