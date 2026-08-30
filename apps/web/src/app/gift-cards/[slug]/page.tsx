"use client";
import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ltr } from "@barat/ui";
import { ShieldCheck, Info } from "lucide-react";

const DENOMINATIONS = [
  { id: "d25", label: "۲۵ دلار", priceToman: "۳٬۲۵۰٬۰۰۰ تومان" },
  { id: "d50", label: "۵۰ دلار", priceToman: "۶٬۴۸۰٬۰۰۰ تومان" },
  { id: "d100", label: "۱۰۰ دلار", priceToman: "۱۲٬۹۰۰٬۰۰۰ تومان" },
] as const;
const DEFAULT_DENOMINATION = DENOMINATIONS[1];
const REGIONS = ["US", "TR", "AE"] as const;
const DEFAULT_REGION = REGIONS[0];

export default function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [region, setRegion] = useState<(typeof REGIONS)[number]>(DEFAULT_REGION);
  const [denomination, setDenomination] = useState<(typeof DENOMINATIONS)[number]["id"]>(DEFAULT_DENOMINATION.id);
  const [loading, setLoading] = useState(false);
  const selected = useMemo(() => DENOMINATIONS.find((d) => d.id === denomination) ?? DEFAULT_DENOMINATION, [denomination]);
  const title = slug.replaceAll("-", " ").toUpperCase();

  async function getPrice() {
    setLoading(true);
    // POC: quote creation would call POST /api/quotes with { skuId, quantity, currency }.
    // A fixed demo id is used here since no live backend is wired to this page yet.
    await new Promise((resolve) => setTimeout(resolve, 500));
    router.push(`/quote/demo-${slug}-${region}-${denomination}` as never);
  }

  return (
    <main className="page container">
      <div className="split">
        <div>
          <div className="eyebrow">گیفت‌کارت · <Ltr>{title}</Ltr></div>
          <h1 className="h2">گیفت‌کارت <Ltr>{title}</Ltr></h1>
          <p className="muted">این گیفت‌کارت مخصوص فروشگاه منطقه انتخابی شماست. پیش از خرید، منطقه حساب مقصد را با دقت بررسی کنید؛ گیفت‌کارت هر منطقه فقط در همان منطقه قابل استفاده است.</p>
          <div className="card pad" style={{ marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>منطقه</h3>
            <div className="filterbar" role="radiogroup" aria-label="انتخاب منطقه">
              {REGIONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={region === r} className={`chip ${region === r ? "active" : ""}`} onClick={() => setRegion(r)}>
                  <Ltr>{r}</Ltr>
                </button>
              ))}
            </div>
            <h3>مبلغ گیفت‌کارت</h3>
            <div className="filterbar" role="radiogroup" aria-label="انتخاب مبلغ">
              {DENOMINATIONS.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={denomination === d.id} className={`chip ${denomination === d.id ? "active" : ""}`} onClick={() => setDenomination(d.id)}>
                  {d.label}
                </button>
              ))}
            </div>
            <div className="alert" style={{ marginTop: 14 }}>
              <Info size={14} style={{ verticalAlign: "-2px" }} /> قیمت نهایی پس از «دریافت قیمت» و بر اساس نرخ لحظه‌ای محاسبه می‌شود.
            </div>
          </div>
        </div>
        <aside className="card pad" style={{ position: "sticky", top: 96 }}>
          <div className="summary-line"><span>محصول</span><strong><Ltr>{title}</Ltr></strong></div>
          <div className="summary-line"><span>منطقه</span><strong><Ltr>{region}</Ltr></strong></div>
          <div className="summary-line"><span>مبلغ</span><strong>{selected.label}</strong></div>
          <div className="summary-total"><span>قیمت تقریبی</span><Ltr>{selected.priceToman}</Ltr></div>
          <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={getPrice} disabled={loading}>
            {loading ? "در حال محاسبه..." : "دریافت قیمت نهایی"}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
            <ShieldCheck size={14} /> تحویل امن پس از تأیید پرداخت
          </p>
        </aside>
      </div>
    </main>
  );
}
