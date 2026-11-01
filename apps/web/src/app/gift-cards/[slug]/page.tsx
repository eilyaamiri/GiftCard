import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorState } from "@barat/ui";
import { JsonLd } from "@/components/json-ld";
import { api, ApiClientError } from "@/lib/api";
import type { CatalogProductDetail } from "@/lib/catalog";
import { brandPath, breadcrumbJsonLd, faqJsonLd, pageMetadata, productJsonLd, productSeo, type Crumb } from "@/lib/seo";
import { ProductDetail } from "./product-detail";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

/* The page and `generateMetadata` both need the product; `cache` makes them
 * share one request instead of asking the API twice per view. */
const loadProduct = cache(async (slug: string) => (await api.product(slug)).product);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  try {
    const product = await loadProduct(slug);
    const { title, description } = productSeo(product);
    /* The canonical drops `?region=`: every region of a product is the same
     * page, and the query must not become a second copy of it in the index. */
    return pageMetadata({
      title,
      description,
      path: `/gift-cards/${encodeURIComponent(product.slug)}`,
      imageUrl: product.imageUrl,
    });
  } catch (error) {
    /* A product that does not exist must not be indexed under a made-up title. */
    if (error instanceof ApiClientError && error.isNotFound) return { title: "گیفت‌کارت پیدا نشد", robots: { index: false } };
    return {};
  }
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: Params & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const requestedRegion = (await searchParams).region;
  const initialRegion = typeof requestedRegion === "string" ? requestedRegion : undefined;

  let product: CatalogProductDetail;
  /* Fetched alongside the product, not after it: the reviews summary sits under
   * the title. A failure here costs only the reviews/FAQs, never the page. */
  const reviewsPromise = api.reviews("PRODUCT", slug).catch(() => null);
  const faqsPromise = api.faqs("PRODUCT", slug).catch(() => null);
  try {
    product = await loadProduct(slug);
  } catch (error) {
    if (error instanceof ApiClientError && error.isNotFound) notFound();
    return (
      <main className="page container">
        <ErrorState
          title="این گیفت‌کارت در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href="/gift-cards">بازگشت به کاتالوگ</Link>}
        />
      </main>
    );
  }

  const reviews = await reviewsPromise;
  const faqs = await faqsPromise;
  const path = `/gift-cards/${encodeURIComponent(product.slug)}`;
  const crumbs: Crumb[] = [
    { name: "خانه", path: "/" },
    { name: "گیفت‌کارت‌ها", path: "/gift-cards" },
    ...(product.brandSlug !== null && product.brandNameFa !== null
      ? [{ name: product.brandNameFa, path: brandPath(product.brandSlug) }]
      : []),
    { name: product.titleFa, path },
  ];

  return (
    <>
      <JsonLd
        data={productJsonLd({
          name: product.titleFa,
          description: productSeo(product).description,
          path,
          imageUrl: product.imageUrl,
          brand: product.brand,
          summary: reviews?.summary ?? null,
        })}
      />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqJsonLd(faqs)} />
      <ProductDetail product={product} initialRegion={initialRegion} reviews={reviews} faqs={faqs} />
    </>
  );
}
