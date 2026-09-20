"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toPersianDigits } from "@barat/ui";
import type { Brand } from "@/lib/catalog";
import { BrandMark } from "../gift-cards/_components/catalog-facets";

/**
 * Every brand with something on sale.
 *
 * The whole list arrives in one response — it is bounded by the catalog — so
 * the search filters in the browser and answers on each keystroke, with no
 * round trip. Sorting is `Intl.Collator("fa")`: a plain `<` puts «آ» after «ی»
 * and the A–Z reading order breaks.
 */
export function BrandDirectory({ brands }: { readonly brands: readonly Brand[] }) {
  const [term, setTerm] = useState("");

  const sorted = useMemo(() => {
    const collator = new Intl.Collator("fa");
    return [...brands].sort((a, b) => collator.compare(a.nameFa, b.nameFa));
  }, [brands]);

  const popular = useMemo(() => sorted.filter((brand) => brand.isPopular), [sorted]);

  const matching = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (needle === "") return sorted;
    return sorted.filter((brand) =>
      [brand.nameFa, brand.name, brand.slug].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [sorted, term]);

  const searching = term.trim() !== "";

  return (
    <>
      <div className="catalog-search" role="search">
        <Search size={19} aria-hidden="true" />
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="نام برند را بنویسید"
          aria-label="جست‌وجوی برند"
        />
      </div>

      {searching || popular.length === 0 ? null : (
        <section className="brand-section">
          <h2 className="catalog-facet-title">برندهای محبوب</h2>
          <div className="grid brand-grid">
            {popular.map((brand) => (
              <BrandTile key={brand.id} brand={brand} />
            ))}
          </div>
        </section>
      )}

      <section className="brand-section">
        <h2 className="catalog-facet-title">
          {searching ? "نتیجهٔ جست‌وجو" : "همهٔ برندها"}{" "}
          <span className="catalog-count">({toPersianDigits(matching.length)})</span>
        </h2>
        {matching.length === 0 ? (
          <p className="catalog-facet-empty">برندی با این نام پیدا نشد.</p>
        ) : (
          <div className="grid brand-grid">
            {matching.map((brand) => (
              <BrandTile key={brand.id} brand={brand} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function BrandTile({ brand }: { readonly brand: Brand }) {
  return (
    <Link className="card brand-tile" href={`/gift-cards?brand=${encodeURIComponent(brand.slug)}`}>
      <BrandMark brand={brand} size={40} />
      <span className="brand-tile-copy">
        <strong>{brand.nameFa}</strong>
        <small>{toPersianDigits(brand.productCount)} کارت</small>
      </span>
    </Link>
  );
}
