import { toPersianDigits } from "@barat/ui";
import { FAQS_HASH, type FaqItemType, type ProductFaq } from "@/lib/faqs";
import { REVIEWS_HASH, type ListReviewsResponse, type ReviewItemType } from "@/lib/reviews";
import type { ProductInfoTab } from "./product-info-tabs";
import { ProductFaqs } from "./product-faqs";
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
 * a usage guide when the supplier provides one, then its reviews (always there —
 * an empty reviews tab is where the first review gets written), and its FAQs
 * when the product has any.
 */
export function productTabs({
  description,
  guide,
  reviews,
  faqs,
}: {
  readonly description: string | null | undefined;
  /** Supplier usage guide: redemptionNotesFa for gift cards, providerNote for top-ups. */
  readonly guide: string | null | undefined;
  readonly reviews: { readonly itemType: ReviewItemType; readonly itemSlug: string; readonly initial: ListReviewsResponse | null };
  readonly faqs: { readonly itemType: FaqItemType; readonly itemSlug: string; readonly initial: readonly ProductFaq[] | null };
}): ProductInfoTab[] {
  const text = description?.trim() ?? "";
  const guideText = guide?.trim() ?? "";
  const reviewCount = reviews.initial?.summary.count ?? 0;
  const faqCount = faqs.initial?.length ?? 0;
  return [
    ...(text === "" ? [] : [{ key: "description", label: "توضیحات محصول", content: <DescriptionText text={text} /> }]),
    ...(guideText === "" ? [] : [{ key: "guide", label: "راهنمای استفاده", content: <DescriptionText text={guideText} /> }]),
    {
      key: REVIEWS_HASH,
      label: reviewCount > 0 ? `دیدگاه کاربران (${toPersianDigits(reviewCount)})` : "دیدگاه کاربران",
      content: <ProductReviews itemType={reviews.itemType} itemSlug={reviews.itemSlug} initial={reviews.initial} />,
    },
    ...(faqCount > 0
      ? [
          {
            key: FAQS_HASH,
            label: `سوالات متداول (${toPersianDigits(faqCount)})`,
            content: <ProductFaqs itemType={faqs.itemType} itemSlug={faqs.itemSlug} initial={faqs.initial} />,
          },
        ]
      : []),
  ];
}
