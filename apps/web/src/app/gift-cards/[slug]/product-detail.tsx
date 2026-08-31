"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ltr } from "@barat/ui";
import { ShieldCheck, Info } from "lucide-react";
import type { ProductDetailDto, CreateQuoteResponse } from "@barat/contracts";
import { createQuoteResponseSchema } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { getCommerceSessionToken } from "@/lib/commerce-session";

export function ProductDetail({ product }: { readonly product: ProductDetailDto }) {
  const router = useRouter();
  const availableSkus = useMemo(() => product.skus.filter((sku) => sku.isActive), [product.skus]);
  const [region, setRegion] = useState(product.regions[0] ?? "");
  const skusForRegion = useMemo(() => availableSkus.filter((sku) => sku.region === region), [availableSkus, region]);
  const [skuId, setSkuId] = useState(skusForRegion[0]?.id ?? "");
  const selected = useMemo(() => skusForRegion.find((sku) => sku.id === skuId) ?? skusForRegion[0] ?? null, [skusForRegion, skuId]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectRegion(nextRegion: string) {
    setRegion(nextRegion);
    const first = availableSkus.find((sku) => sku.region === nextRegion);
    setSkuId(first?.id ?? "");
  }

  async function getPrice() {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const commerceSessionToken = getCommerceSessionToken();
      const { quote } = await api.post<CreateQuoteResponse>(
        "/api/quotes",
        { skuId: selected.id, quantity: 1, currency: selected.currency, commerceSessionToken },
        createQuoteResponseSchema,
      );
      router.push(`/quote/${quote.id}` as never);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید.");
    } finally {
      setLoading(false);
    }
  }

  if (!selected) {
    return (
      <main className="page container">
        <div className="eyebrow">گیفت‌کارت</div>
        <h1 className="h2">{product.titleFa}</h1>
        <div className="alert warn">در حال حاضر هیچ مبلغی برای این گیفت‌کارت موجود نیست.</div>
      </main>
    );
  }

  return (
    <main className="page container">
      <div className="split">
        <div>
          <div className="eyebrow">گیفت‌کارت · <Ltr>{product.brand}</Ltr></div>
          <h1 className="h2">{product.titleFa}</h1>
          <p className="muted">
            {product.descriptionFa ?? "این گیفت‌کارت مخصوص فروشگاه منطقه انتخابی شماست. پیش از خرید، منطقه حساب مقصد را با دقت بررسی کنید؛ گیفت‌کارت هر منطقه فقط در همان منطقه قابل استفاده است."}
          </p>
          <div className="card pad" style={{ marginTop: 20 }}>
            {product.regions.length > 1 ? (
              <>
                <h3 style={{ marginTop: 0 }}>منطقه</h3>
                <div className="filterbar" role="radiogroup" aria-label="انتخاب منطقه">
                  {product.regions.map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={region === r} className={`chip ${region === r ? "active" : ""}`} onClick={() => selectRegion(r)}>
                      <Ltr>{r}</Ltr>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <h3 style={{ marginTop: 0 }}>مبلغ گیفت‌کارت</h3>
            <div className="filterbar" role="radiogroup" aria-label="انتخاب مبلغ">
              {skusForRegion.map((sku) => (
                <button key={sku.id} type="button" role="radio" aria-checked={skuId === sku.id} disabled={!sku.isAvailable} className={`chip ${skuId === sku.id ? "active" : ""}`} onClick={() => setSkuId(sku.id)}>
                  <Ltr>{sku.denominationLabel}</Ltr>
                  {!sku.isAvailable ? " (ناموجود)" : ""}
                </button>
              ))}
            </div>
            {product.redemptionNotesFa ? (
              <div className="alert" style={{ marginTop: 14 }}>
                <Info size={14} style={{ verticalAlign: "-2px" }} /> {product.redemptionNotesFa}
              </div>
            ) : (
              <div className="alert" style={{ marginTop: 14 }}>
                <Info size={14} style={{ verticalAlign: "-2px" }} /> قیمت نهایی پس از «دریافت قیمت» و بر اساس نرخ لحظه‌ای محاسبه می‌شود.
              </div>
            )}
          </div>
        </div>
        <aside className="card pad" style={{ position: "sticky", top: 96 }}>
          <div className="summary-line"><span>محصول</span><strong>{product.titleFa}</strong></div>
          <div className="summary-line"><span>منطقه</span><strong><Ltr>{region}</Ltr></strong></div>
          <div className="summary-line"><span>مبلغ</span><strong><Ltr>{selected.denominationLabel}</Ltr></strong></div>
          <div className="summary-total">
            <span>قیمت نهایی</span>
            <span className="muted" style={{ fontSize: 13, fontWeight: 700 }}>پس از «دریافت قیمت» نمایش داده می‌شود</span>
          </div>
          {error ? <div className="alert warn" style={{ marginTop: 14 }}>{error}</div> : null}
          <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={getPrice} disabled={loading || !selected.isAvailable}>
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
