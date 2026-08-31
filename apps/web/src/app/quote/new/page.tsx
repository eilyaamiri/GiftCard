"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { positiveDecimalStringSchema } from "@barat/contracts";
import { createQuote, purchaseError } from "@/app/checkout/purchase";

/**
 * The entry point to the money path: it asks the server for a price and hands
 * the customer straight to the quote it created.
 *
 * Nothing about the price is computed here, and nothing about the item is read
 * from the URL beyond the identifiers — a title carried in a query string would
 * be attacker-controlled copy on a page about money.
 */
type QuoteParams = Readonly<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw !== undefined && raw !== "" ? raw : undefined;
}

function quantityFrom(value: string | string[] | undefined): number {
  const parsed = Number(single(value));
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 1;
}

export default function NewQuotePage({ searchParams }: { searchParams: Promise<QuoteParams> }) {
  const params = use(searchParams);
  const router = useRouter();
  const skuId = single(params["sku"]);
  const serviceId = single(params["service"]);
  const quantity = quantityFrom(params["quantity"]);
  /* The foreign amount comes off the URL, so it is validated against the shared
   * decimal-string schema before it can reach a pricing request. */
  const requestedAmountForeign = positiveDecimalStringSchema.safeParse(single(params["amount"])).data;
  const currency = single(params["currency"]) ?? "USD";

  const [error, setError] = useState<string | null>(null);
  /* React 19 Strict Mode runs effects twice in development. Quoting is not free
   * — it consumes an FX read and writes a row — so the request is fired once. */
  const requested = useRef(false);

  const request = useCallback(async () => {
    setError(null);
    if (Boolean(skuId) === Boolean(serviceId)) {
      setError("درخواست قیمت نامعتبر است. لطفاً از صفحهٔ محصول دوباره اقدام کنید.");
      return;
    }
    try {
      const result = await createQuote({
        ...(skuId === undefined ? {} : { skuId }),
        ...(serviceId === undefined ? {} : { serviceId }),
        ...(requestedAmountForeign === undefined ? {} : { requestedAmountForeign }),
        quantity,
        currency,
      });
      router.replace(`/quote/${result.quote.id}`);
    } catch (cause) {
      setError(purchaseError(cause).message);
    }
  }, [skuId, serviceId, requestedAmountForeign, quantity, currency, router]);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void request();
  }, [request]);

  return (
    <main className="page container" style={{ maxWidth: 520 }}>
      <div className="card pad" style={{ marginTop: 18, textAlign: "center" }}>
        {error === null ? (
          <>
            <Loader2 className="animate-spin" size={40} style={{ color: "var(--teal)", marginInline: "auto", marginBlockEnd: 16 }} aria-hidden="true" />
            <h1 className="h2">در حال دریافت قیمت روز</h1>
            <p className="muted">قیمت بر اساس نرخ لحظه‌ای ارز محاسبه می‌شود و مدت محدودی معتبر است.</p>
          </>
        ) : (
          <>
            <h1 className="h2">قیمت دریافت نشد</h1>
            <p className="muted">{error}</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBlockStart: 18 }}>
              <button type="button" className="btn btn-primary" onClick={() => void request()}>
                <RefreshCw size={16} aria-hidden="true" /> تلاش دوباره
              </button>
              <Link className="btn btn-outline" href="/gift-cards">
                بازگشت به محصولات
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
