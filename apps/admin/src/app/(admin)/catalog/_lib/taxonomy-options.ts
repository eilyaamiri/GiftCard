import { api } from "@/lib/api";
import { adminBrandOptionListSchema, adminCategoryListSchema } from "./catalog-contracts";

/**
 * The brand and category lists a product form picks from.
 *
 * Both requests go out together: they are independent, and the product form
 * cannot render without either of them. Brands come from the unpaged picker
 * route — there are ~330 of them and the paged list stops at 100.
 */
export async function fetchTaxonomyOptions() {
  const [brands, categories] = await Promise.all([
    api.get("/api/admin/catalog/brands/options", adminBrandOptionListSchema),
    api.get("/api/admin/catalog/categories", adminCategoryListSchema),
  ]);
  return { brands: brands.items, categories: categories.items };
}
