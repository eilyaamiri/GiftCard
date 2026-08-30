"use client";
import { useMemo, useState } from "react";
import { ProductCard, products as sample } from "@/components/marketing";

const categories = ["همه", "بازی و سرگرمی", "خرید و اپلیکیشن", "استریمینگ"];
const catalog = [...sample, { brand: "NETFLIX", title: "گیفت‌کارت نتفلیکس", region: "TR", price: "۹۸۰٬۰۰۰ تومان", tone: "steam" }, { brand: "XBOX", title: "گیفت‌کارت ایکس‌باکس", region: "US", price: "۱٬۴۲۰٬۰۰۰ تومان", tone: "play" }, { brand: "AMAZON", title: "گیفت‌کارت آمازون", region: "US", price: "۲٬۳۱۰٬۰۰۰ تومان", tone: "google" }];

export default function GiftCardsPage() {
  const [category, setCategory] = useState("همه");
  const [region, setRegion] = useState("همه");
  const regions = useMemo(() => ["همه", ...new Set(catalog.map((p) => p.region))], []);
  const filtered = catalog.filter((p) => region === "همه" || p.region === region);

  return (
    <main className="page container">
      <div className="eyebrow">کاتالوگ</div>
      <h1 className="h2">گیفت‌کارت‌های محبوب</h1>
      <p className="muted">پرتکرارترین کارت‌های دیجیتال جهان، با قیمت شفاف و تحویل مطمئن.</p>
      <div className="filterbar" role="group" aria-label="فیلتر دسته‌بندی">
        {categories.map((c) => (
          <button key={c} type="button" className={`chip ${category === c ? "active" : ""}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      <div className="filterbar" role="group" aria-label="فیلتر منطقه">
        {regions.map((r) => (
          <button key={r} type="button" className={`chip ${region === r ? "active" : ""}`} aria-pressed={region === r} onClick={() => setRegion(r)}>{r}</button>
        ))}
      </div>
      <div className="grid catalog-grid">
        {filtered.map((p) => <ProductCard key={p.brand} product={p} />)}
      </div>
    </main>
  );
}
