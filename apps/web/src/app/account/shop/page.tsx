import type { Metadata } from "next";
import { api, ApiClientError } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { brandKey, hasBrandArt, visibleBrandsQuery } from "@/lib/brand-art";
import { ShopBrowser } from "./shop-browser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "فروشگاه", robots: { index: false } };

async function shopBrands() {
  try {
    const { items } = await api.brands(visibleBrandsQuery());
    const collator = new Intl.Collator("fa");
    return items
      .filter((brand) => brand.productCount > 0 && hasBrandArt(brandKey(brand.name, brand.slug)))
      .sort((a, b) => a.sortOrder - b.sortOrder || collator.compare(a.nameFa, b.nameFa))
      .map(({ id, name, nameFa, slug, productCount }) => ({ id, name, nameFa, slug, productCount }));
  } catch (error) {
    if (error instanceof ApiClientError) return [];
    throw error;
  }
}

export default async function AccountShopPage() {
  await requireSession("/account/shop");
  const brands = await shopBrands();

  return (
    <main className="page container">
      <ShopBrowser brands={brands} />
    </main>
  );
}
