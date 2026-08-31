"use client";
import { useMemo, useState } from "react";
import { EmptyState, Input } from "@barat/ui";
import { Search, SearchX } from "lucide-react";
import type { ProductDto } from "@barat/contracts";
import { ProductCard } from "@/components/marketing";

const ALL = "همه";

export function GiftCardsCatalog({ products }: { readonly products: readonly ProductDto[] }) {
  const [category, setCategory] = useState(ALL);
  const [region, setRegion] = useState(ALL);
  const [search, setSearch] = useState("");

  const categories = useMemo(() => [ALL, ...new Set(products.map((p) => p.category))], [products]);
  const regions = useMemo(() => [ALL, ...new Set(products.flatMap((p) => p.regions))], [products]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== ALL && p.category !== category) return false;
      if (region !== ALL && !p.regions.includes(region)) return false;
      if (query && !p.titleFa.includes(query) && !p.brand.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [products, category, region, search]);

  return (
    <>
      <div style={{ maxWidth: 360, marginTop: 22 }}>
        <Input
          type="search"
          placeholder="جستجوی برند یا نام گیفت‌کارت..."
          aria-label="جستجو در گیفت‌کارت‌ها"
          startAdornment={<Search size={16} />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="filterbar" role="group" aria-label="فیلتر دسته‌بندی">
        {categories.map((c) => (
          <button key={c} type="button" className={`chip ${category === c ? "active" : ""}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      {regions.length > 2 ? (
        <div className="filterbar" role="group" aria-label="فیلتر منطقه">
          {regions.map((r) => (
            <button key={r} type="button" className={`chip ${region === r ? "active" : ""}`} aria-pressed={region === r} onClick={() => setRegion(r)}>{r}</button>
          ))}
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="نتیجه‌ای پیدا نشد"
          description="فیلترها یا عبارت جستجو را تغییر دهید."
        />
      ) : (
        <div className="grid catalog-grid">
          {filtered.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </>
  );
}
