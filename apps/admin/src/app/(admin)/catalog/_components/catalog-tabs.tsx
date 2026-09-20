import Link from "next/link";

/**
 * Products, categories and brands are three views of one catalog, so they share
 * a strip rather than three sidebar entries. The sidebar keeps one «کاتالوگ»
 * link; everything below it is this.
 */
const TABS = [
  { key: "products", href: "/catalog", label: "محصول‌ها" },
  { key: "categories", href: "/catalog/categories", label: "دسته‌بندی‌ها" },
  { key: "brands", href: "/catalog/brands", label: "برندها" },
] as const;

export type CatalogTab = (typeof TABS)[number]["key"];

export function CatalogTabs({ active }: { active: CatalogTab }) {
  return (
    <nav className="tab-strip" aria-label="بخش‌های کاتالوگ">
      {TABS.map((tab) =>
        tab.key === active ? (
          <span key={tab.key} className="tab-btn active" aria-current="page">
            {tab.label}
          </span>
        ) : (
          <Link key={tab.key} href={tab.href} className="tab-btn">
            {tab.label}
          </Link>
        ),
      )}
    </nav>
  );
}
