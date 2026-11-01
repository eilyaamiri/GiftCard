import type { Metadata } from "next";
import { BRAND, TITLE_TEMPLATE, absoluteUrl } from "./brand";
import { regionLabel } from "./regions";
import type { ReviewSummary } from "./reviews";

/**
 * What search engines are told about a page, in one place.
 *
 * Everything here is pure: titles, descriptions, canonical paths and the
 * schema.org objects are built from data the page already has, so they can be
 * tested without a server. Nothing is user-supplied HTML — the objects go out
 * through `jsonForInlineScript` (see `components/json-ld.tsx`).
 */

export type Crumb = { readonly name: string; readonly path: string };

/** A path or an absolute URL as an absolute URL on the public origin. */
export function absoluteAsset(urlOrPath: string): string {
  return /^https?:\/\//iu.test(urlOrPath) ? urlOrPath : absoluteUrl(urlOrPath);
}

/**
 * A description that fits a search snippet: markdown marks and line breaks
 * flattened, cut at a word boundary with an ellipsis when it runs long.
 */
export function truncateForMeta(text: string, max = 160): string {
  const flat = text.replace(/[#*_`>]+/gu, "").replace(/\s+/gu, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  const cut = chars.slice(0, max - 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s،,.؛:\-–]+$/u, "")}…`;
}

export interface ProductSeoInput {
  readonly titleFa: string;
  readonly descriptionFa: string | null;
  readonly regions: readonly string[];
}

/** The most regions named in a description before it would stop reading well. */
const MAX_REGIONS_IN_DESCRIPTION = 5;
/** A product's own description is used only when it is long enough to say something. */
const MIN_OWN_DESCRIPTION = 40;

/**
 * The title carries the words people search for («خرید … با قیمت روز»); the
 * template adds «| سنتو». The description is the product's own text when it
 * has one, which is unique per product, and a plain sentence otherwise. It
 * makes no claim about price or delivery: the price is live and is shown on
 * the page, the delivery time differs by product.
 */
export function productSeo(input: ProductSeoInput): { readonly title: string; readonly description: string } {
  const title = `خرید ${input.titleFa} با قیمت روز`;
  const own = input.descriptionFa?.trim() ?? "";
  if (Array.from(own).length >= MIN_OWN_DESCRIPTION) return { title, description: truncateForMeta(own) };
  const regions = input.regions
    .slice(0, MAX_REGIONS_IN_DESCRIPTION)
    .map((region) => regionLabel(region) ?? region);
  const regionPart = regions.length > 0 ? `؛ منطقه‌های موجود: ${regions.join("، ")}` : "";
  return {
    title,
    description: `خرید ${input.titleFa} با ریال و پرداخت امن؛ قیمت نهایی را پیش از پرداخت می‌بینید${regionPart}.`,
  };
}

export interface PageMetadataInput {
  readonly title: string;
  readonly description?: string | undefined;
  /** The canonical path, without the origin. */
  readonly path: string;
  readonly imageUrl?: string | null | undefined;
  readonly noindex?: boolean | undefined;
}

/**
 * Title, description, canonical, OpenGraph and Twitter for one page.
 *
 * `openGraph` and `twitter` are written out in full on purpose: a page that
 * sets either one replaces the root layout's object wholesale rather than
 * merging with it, so `siteName` and `locale` would otherwise be lost.
 */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const image = input.imageUrl ? absoluteAsset(input.imageUrl) : absoluteUrl(BRAND.assets.ogImage);
  const socialTitle = TITLE_TEMPLATE.replace("%s", input.title);
  return {
    title: input.title,
    ...(input.description !== undefined ? { description: input.description } : {}),
    alternates: { canonical: input.path },
    openGraph: {
      type: "website",
      siteName: BRAND.name,
      locale: BRAND.seo.locale,
      url: input.path,
      title: socialTitle,
      ...(input.description !== undefined ? { description: input.description } : {}),
      images: [{ url: image, alt: input.title }],
    },
    twitter: {
      card: input.imageUrl ? "summary_large_image" : "summary",
      title: socialTitle,
      ...(input.description !== undefined ? { description: input.description } : {}),
      images: [image],
    },
    ...(input.noindex === true ? { robots: { index: false, follow: true } } : {}),
  };
}

/** `noindex` for a page that must be reachable but should not be a search result. */
export const NOINDEX: Metadata = { robots: { index: false, follow: false } };

export function breadcrumbJsonLd(crumbs: readonly Crumb[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** `null` for no entries, so the caller renders nothing rather than an empty FAQPage. */
export function faqJsonLd(
  entries: readonly { readonly question: string; readonly answer: string }[] | null | undefined,
): Record<string, unknown> | null {
  if (entries === null || entries === undefined || entries.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export interface ProductStructuredDataInput {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly imageUrl: string | null;
  readonly brand: string | null | undefined;
  readonly summary: ReviewSummary | null;
}

/**
 * A schema.org `Product` for a page.
 *
 * There is deliberately no `offers`: the price is a live quote built from the
 * current exchange rate, and a figure frozen into the markup could disagree
 * with the one the customer pays — a pricing question that needs a person's
 * decision (AGENTS.md §4.2). `aggregateRating` appears only when approved
 * reviews exist, since a rating of nothing is invalid markup.
 */
export function productJsonLd(input: ProductStructuredDataInput): Record<string, unknown> {
  const rated = input.summary !== null && input.summary.average !== null && input.summary.count > 0;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    ...(input.imageUrl !== null ? { image: absoluteAsset(input.imageUrl) } : {}),
    ...(input.brand !== null && input.brand !== undefined && input.brand !== "" ? { brand: { "@type": "Brand", name: input.brand } } : {}),
    ...(rated && input.summary !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: input.summary.average,
            reviewCount: input.summary.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/** A brand's own page. */
export function brandPath(slug: string): string {
  return `/brands/${encodeURIComponent(slug)}`;
}

/** An `ItemList` of pages, for a page whose job is to list them. */
export function itemListJsonLd(items: readonly Crumb[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  };
}

export interface CatalogFilterSeo {
  readonly category?: string | undefined;
  readonly brand?: string | undefined;
  readonly page?: number | undefined;
}

/**
 * The canonical path of a catalogue view. A brand alone has a page of its own
 * (`/brands/<slug>`), so that view points there; a category keeps its own
 * address; search and region are views of the same list and fold into it. A
 * later page keeps its own address too — pointing page 2 at page 1 would tell
 * a search engine the products on page 2 are not there.
 */
export function catalogCanonicalPath(filters: CatalogFilterSeo): string {
  if (filters.brand && !filters.category) {
    return filters.page !== undefined && filters.page > 1
      ? `${brandPath(filters.brand)}?page=${filters.page}`
      : brandPath(filters.brand);
  }
  const query = new URLSearchParams();
  if (filters.category) query.set("category", filters.category);
  if (filters.brand) query.set("brand", filters.brand);
  if (filters.page !== undefined && filters.page > 1) query.set("page", String(filters.page));
  const text = query.toString();
  return text === "" ? "/gift-cards" : `/gift-cards?${text}`;
}
