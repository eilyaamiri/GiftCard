"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toPersianDigits } from "@barat/ui";
import { ProductArtwork } from "@/components/catalog-artwork";
import { brandPath } from "@/lib/seo";

interface ShopBrand {
  readonly id: string;
  readonly name: string;
  readonly nameFa: string;
  readonly slug: string;
  readonly productCount: number;
}

export function ShopBrowser({ brands }: Readonly<{ brands: readonly ShopBrand[] }>) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (needle === "" ? brands : brands.filter((b) => b.nameFa.includes(needle) || b.name.toLowerCase().includes(needle))),
    [brands, needle],
  );

  return (
    <div className="shop">
      <div className="shop-head">
        <div>
          <h2 className="h2">گیفت‌کارت‌ها</h2>
          <p className="muted">برند را انتخاب کنید؛ قیمت نهایی پیش از پرداخت نمایش داده می‌شود.</p>
        </div>
        <label className="shop-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جستجوی برند"
            aria-label="جستجوی برند"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="muted shop-empty">برندی با این نام پیدا نشد.</p>
      ) : (
        <div className="brand-card-grid shop-grid">
          {shown.map((brand) => (
            <Link className="card product brand-card" href={brandPath(brand.slug)} key={brand.id}>
              <ProductArtwork brand={brand.name} brandSlug={brand.slug} label={brand.nameFa} />
              <span className="brand-card-body">
                <strong>{brand.nameFa}</strong>
                <small>{toPersianDigits(brand.productCount)} کارت</small>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
