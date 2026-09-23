-- Give InternationalService a customer-facing Persian description, the same
-- shape Brand and Product already have. Nullable: existing rows keep working
-- with no copy until an operator (or the population script) fills one in.

-- AlterTable
ALTER TABLE "InternationalService" ADD COLUMN     "descriptionFa" TEXT;
