import { toPersianDigits } from "@barat/ui";
import { REVIEWS_HASH, type ListReviewsResponse, type ReviewItemType } from "@/lib/reviews";
import type { ProductInfoTab } from "./product-info-tabs";
import { ProductReviews } from "./product-reviews";

/*
 * No "use client" on purpose: server pages call `productTabs` directly, and
 * Next refuses a server call into a function exported from a client file.
 * Rendering the client `ProductReviews` from here is fine; calling it is not.
 */

/**
 * Description text as the catalogue stores it: plain text, where a blank line
 * starts a new paragraph. Never rendered as HTML — the copy is typed in the
 * admin panel and must not become markup on the storefront.
 */
export function DescriptionText({ text }: { readonly text: string }) {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  return (
    <div className="product-info-description">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

/**
 * The tab set under a product's order form: its description when it has one,
 * then its reviews, which are always there — an empty reviews tab is where the
 * first review gets written.
 */
export function productTabs({
  description,
  reviews,
}: {
  readonly description: string | null | undefined;
  readonly reviews: { readonly itemType: ReviewItemType; readonly itemSlug: string; readonly initial: ListReviewsResponse | null };
}): ProductInfoTab[] {
  const text = description?.trim() ?? "";
  const count = reviews.initial?.summary.count ?? 0;
  return [
    ...(text === "" ? [] : [{ key: "description", label: "توضیحات محصول", content: <DescriptionText text={text} /> }]),
    {
      key: REVIEWS_HASH,
      label: count > 0 ? `دیدگاه کاربران (${toPersianDigits(count)})` : "دیدگاه کاربران",
      content: <ProductReviews itemType={reviews.itemType} itemSlug={reviews.itemSlug} initial={reviews.initial} />,
    },
  ];
}
