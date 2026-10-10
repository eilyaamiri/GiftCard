import Link from "next/link";
import { cookies } from "next/headers";
import { Ltr, toPersianDigits } from "@barat/ui";
import type { QuoteSnapshot } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { COMMERCE_SESSION_COOKIE } from "@/lib/commerce-session";
import { getSession } from "@/lib/session";
import { tomanFromIrr } from "@/app/checkout/purchase";
import { QuoteActions } from "./quote-actions";

export const dynamic = "force-dynamic";

/**
 * The quoted price, exactly as the server froze it.
 *
 * Every figure on this page is a field of the snapshot. Nothing is added up in
 * the browser: `finalAmountIrr` is the number the customer will be charged and
 * the number they acknowledge, so recomputing it here could only ever introduce
 * a disagreement with the row the API will check the acknowledgement against.
 */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  /* A quote made before login belongs to the browser's commerce session, not to
   * a customer. The token lives in a cookie precisely so this server render can
   * present it — without it, every anonymous quote reads as "not found". */
  const commerceToken = (await cookies()).get(COMMERCE_SESSION_COOKIE)?.value;
  const customer = await getSession();

  let quote: QuoteSnapshot;
  try {
    quote = (await api.quote(id, commerceToken)).quote;
  } catch (error) {
    return <QuoteUnavailable quoteId={id} error={error} />;
  }

  return (
    <main className="page container" style={{ maxWidth: 640 }}>
      <div className="eyebrow">پیش‌فاکتور</div>
      <h1 className="h2">بررسی قیمت</h1>
      <p className="muted">
        شماره پیش‌فاکتور <Ltr>{quote.quoteNumber}</Ltr>
      </p>

      <div className="card pad" style={{ marginBlockStart: 18 }}>
        <QuoteActions quote={quote} isSignedIn={customer !== null}>
          {quote.components.map((component) => (
            <div className="summary-line" key={`${component.kind}-${component.sortOrder}`}>
              <span>{component.labelFa}</span>
              <strong>
                <Ltr>{tomanFromIrr(component.amountIrr)}</Ltr>
              </strong>
            </div>
          ))}
          {/* No separate discount line: a discount is already one of the
              components above, carried as a negative amount so the column sums
              to the payable total. Rendering `discountAmount` as well showed it
              twice, the second time with the wrong sign. */}
          <div className="summary-total">
            <span>مبلغ قابل پرداخت</span>
            <Ltr>{tomanFromIrr(quote.finalAmountIrr)}</Ltr>
          </div>
          <p className="muted" style={{ fontSize: 12, marginBlockStart: 10 }}>
            تعداد {toPersianDigits(quote.quantity)} · نرخ ارز این پیش‌فاکتور تا پایان مهلت ثابت می‌ماند.
          </p>
        </QuoteActions>
      </div>

      <p className="muted" style={{ fontSize: 12, marginBlockStart: 14 }}>
        اگر مهلت تمام شود، قیمت جدیدی با نرخ روز محاسبه و پیش از پرداخت به شما نشان داده می‌شود.
      </p>
    </main>
  );
}

function QuoteUnavailable({ quoteId, error }: { quoteId: string; error: unknown }) {
  const notFound = error instanceof ApiClientError && (error.isNotFound || error.isUnauthenticated);
  if (!notFound) throw error;

  return (
    <main className="page container" style={{ maxWidth: 520 }}>
      <div className="card pad" style={{ textAlign: "center" }}>
        <h1 className="h2">این پیش‌فاکتور در دسترس نیست</h1>
        <p className="muted">
          ممکن است مهلت آن تمام شده باشد یا با حساب دیگری ساخته شده باشد. برای دیدن قیمت روز، دوباره از صفحهٔ محصول اقدام کنید.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBlockStart: 18 }}>
          <Link className="btn btn-primary" href="/gift-cards">
            انتخاب محصول
          </Link>
          {/* Back to THIS quote after login — a quote made under the customer's
              account becomes readable the moment the session cookie is set. */}
          <Link className="btn btn-outline" href={`/login?next=${encodeURIComponent(`/quote/${quoteId}`)}`}>
            ورود به حساب
          </Link>
        </div>
      </div>
    </main>
  );
}
