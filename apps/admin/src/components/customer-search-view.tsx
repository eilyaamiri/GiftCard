import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import { ApiClientError } from "@/lib/api";
import { searchCustomers, type CustomerSearchHit } from "@/lib/customer-360";
import { formatDateTime } from "@/lib/order-format";

const MATCH_LABEL: Record<CustomerSearchHit["matchedOn"], string> = {
  CUSTOMER_CODE: "کد مشتری",
  MOBILE: "شماره تماس",
  EMAIL: "ایمیل",
  NAME: "نام مشتری",
  ORDER_NUMBER: "شماره سفارش",
  PAYMENT_REF: "مرجع پرداخت",
};

export async function CustomerSearchView({
  basePath,
  params,
}: {
  basePath: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const rawKind = single(params.kind);
  const kind = rawKind === "orderNumber" || rawKind === "paymentRef" ? rawKind : "query";
  const value = (single(params.q) ?? "").trim().slice(0, kind === "query" ? 254 : 128);
  let items: readonly CustomerSearchHit[] = [];
  let error: string | null = null;

  if (value.length >= 3) {
    try {
      items = (await searchCustomers(kind, value)).items;
    } catch (caught) {
      error = caught instanceof ApiClientError ? caught.message : "جست‌وجوی مشتری ممکن نشد.";
    }
  }

  return (
    <div>
      <div className="page-heading">
        <div><p className="eyebrow">CUSTOMER 360</p><h1>جست‌وجو و نمای ۳۶۰ مشتری</h1></div>
        <p className="muted">مشاهدهٔ این اطلاعات در سرور ثبت و ممیزی می‌شود.</p>
      </div>

      <form action={basePath} method="get" className="card panel customer-search-form">
        <div className="customer-search-grid">
          <label>نوع جست‌وجو<select name="kind" defaultValue={kind}><option value="query">نام، موبایل، ایمیل یا کد مشتری</option><option value="orderNumber">شماره سفارش</option><option value="paymentRef">مرجع پرداخت</option></select></label>
          <label>عبارت دقیق<input type="search" name="q" defaultValue={value} minLength={3} maxLength={254} required placeholder="حداقل ۳ نویسه" /></label>
          <button className="primary-btn" type="submit">جست‌وجوی مشتری</button>
        </div>
        <p className="panel-caption customer-search-note">نام با تطبیق بخشی جست‌وجو می‌شود؛ شناسه‌های تماس فقط با تطبیق دقیق بررسی و در نتیجه ماسک می‌شوند.</p>
      </form>

      {error ? <div className="card panel report-section"><p className="empty-hint">{error}</p></div> : null}
      {!error && value.length > 0 && value.length < 3 ? <div className="card panel report-section"><p className="empty-hint">عبارت جست‌وجو باید حداقل ۳ نویسه باشد.</p></div> : null}
      {!error && value.length >= 3 ? (
        <div className="card list-card report-section">
          <div className="panel-heading" style={{ padding: "15px 10px 0" }}><div><h2 className="panel-title">نتیجهٔ جست‌وجو</h2><p className="panel-caption">{toPersianDigits(String(items.length))} مشتری</p></div></div>
          {items.length === 0 ? <p className="empty-hint">مشتری منطبق پیدا نشد.</p> : (
            <div className="table-wrap"><table><thead><tr><th>کد مشتری</th><th>نام</th><th>راه تماس</th><th>وضعیت</th><th>تعداد سفارش</th><th>تطبیق با</th><th>عضویت</th></tr></thead><tbody>{items.map((customer) => <tr key={customer.customerId}><td><Link href={`${basePath}/${encodeURIComponent(customer.customerId)}`} className="order-id">{customer.customerCode}</Link></td><td>{customer.fullName ?? "—"}</td><td>{customer.maskedMobile ?? customer.maskedEmail ?? "—"}</td><td><span className="badge badge-info">{customer.status}</span></td><td>{toPersianDigits(String(customer.orderCount))}</td><td>{MATCH_LABEL[customer.matchedOn]}</td><td>{formatDateTime(customer.createdAt)}</td></tr>)}</tbody></table></div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
