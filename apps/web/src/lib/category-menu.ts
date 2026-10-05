import {
  categoryHref,
  categoryLinkHref,
  type Category,
  type CategoryIconKey,
} from "./catalog";

/** One entry under a top-level section of the categories menu. */
export interface CategoryMenuEntry {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly iconKey: CategoryIconKey;
}

/** A top-level category and the list that opens beside it. */
export interface CategoryMenuSection {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly iconKey: CategoryIconKey;
  readonly entries: readonly CategoryMenuEntry[];
}

/** The service-list category whose items also sit in the home category strip. */
export const UTILITY_SOFTWARE_SLUG = "utility-software";

/**
 * «گیفت‌کارت‌ها» is not a row in the database: it is the umbrella the existing
 * product categories live under, so it is built here and its children are the
 * `PRODUCTS` categories exactly as they were before. Every other section is a
 * `SERVICES` category an operator curated, in their sort order.
 *
 * A section with nothing under it is dropped; the API already withholds empty
 * service lists, and the gift-card umbrella is the only one this adds.
 */
export function buildCategoryMenu(categories: readonly Category[]): readonly CategoryMenuSection[] {
  const sections: CategoryMenuSection[] = [];

  const productCategories = categories.filter((category) => category.kind === "PRODUCTS");
  if (productCategories.length > 0) {
    sections.push({
      key: "gift-cards",
      label: "گیفت‌کارت‌ها",
      href: "/gift-cards",
      iconKey: "gift",
      entries: productCategories.map((category) => ({
        key: category.id,
        label: category.nameFa,
        href: categoryHref(category),
        iconKey: category.iconKey,
      })),
    });
  }

  for (const category of categories) {
    if (category.kind !== "SERVICES" || category.links.length === 0) continue;
    sections.push({
      key: category.id,
      label: category.nameFa,
      href: categoryHref(category),
      iconKey: category.iconKey,
      entries: category.links.map((link) => ({
        key: link.id,
        label: link.title,
        href: categoryLinkHref(link),
        iconKey: category.iconKey,
      })),
    });
  }

  return sections;
}

/**
 * The home category strip: the gift-card categories, then what sits under
 * «نرم‌افزارهای کاربردی». «بازی‌ها» is deliberately not flattened into it.
 */
export function buildCategoryStrip(categories: readonly Category[]): readonly CategoryMenuEntry[] {
  const sections = buildCategoryMenu(categories);
  const giftCards = sections.find((section) => section.key === "gift-cards");
  const utility = categories.find((category) => category.slug === UTILITY_SOFTWARE_SLUG);
  const utilitySection = sections.find((section) => section.key === utility?.id);
  return [...(giftCards?.entries ?? []), ...(utilitySection?.entries ?? [])];
}
