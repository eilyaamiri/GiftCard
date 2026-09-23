/**
 * The six payment-service categories the storefront navigates by.
 *
 * `InternationalService.category` is a free-text column (see
 * `apps/api/src/modules/catalog/catalog.schemas.ts`), not a foreign key into a
 * `Category` table the way gift cards have — so, unlike brands and gift-card
 * categories, there is no `nameFa` to read off the row itself. This is the one
 * place that Persian label is defined; every screen that groups or labels a
 * service by category should read it from here rather than printing the slug.
 */
export const SERVICE_CATEGORIES: readonly { slug: string; labelFa: string }[] = [
  { slug: "ai-tools", labelFa: "ابزارهای هوش مصنوعی" },
  { slug: "saas", labelFa: "اشتراک و لایسنس نرم‌افزار" },
  { slug: "domain-hosting", labelFa: "دامنه و هاستینگ" },
  { slug: "courses", labelFa: "دوره‌های آموزشی خارجی" },
  { slug: "exam-fees", labelFa: "هزینه آزمون‌های بین‌المللی" },
  { slug: "cloud", labelFa: "میزبانی ابری" },
];

export function serviceCategoryLabelFa(category: string): string {
  return SERVICE_CATEGORIES.find((entry) => entry.slug === category)?.labelFa ?? category;
}

/**
 * The category-level services every environment seeds (see `seed.ts`'s
 * `SERVICE_DEFS`) — one generic, orderable fallback per category, for a
 * service the specific list below it doesn't itemize. Grouped listings sort
 * these last within their category rather than mixing them in by name.
 */
export const GENERIC_SERVICE_SLUGS: readonly string[] = [
  "ai-tools",
  "saas-subscriptions",
  "domain-hosting",
  "online-courses",
  "exam-fees",
  "cloud-hosting",
];
