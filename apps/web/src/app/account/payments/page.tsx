import Link from "next/link";
import { Badge, EmptyState, Ltr, formatJalaliDate, toPersianDigits } from "@barat/ui";
import { Receipt } from "lucide-react";
import { AccountNav } from "@/components/account-nav";
import { api } from "@/lib/api";
import { tomanFromIrr } from "@/app/checkout/purchase";
import { paymentStatusView, refundStatusView } from "@/lib/status";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

function pageFrom(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

export default async function AccountPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const page = pageFrom(params["page"]);
  const [payments, refunds] = await Promise.all([
    api.accountPayments({ page, pageSize: PAGE_SIZE }),
    api.accountRefunds({ pageSize: PAGE_SIZE }),
  ]);

  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">پرداخت‌ها</h1>
      <AccountNav />

      {payments.items.length === 0 ? (
        <EmptyState icon={<Receipt />} title="پرداختی ثبت نشده است" description="پس از اولین خرید، تراکنش‌های شما اینجا نمایش داده می‌شود." />
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          {payments.items.map((payment) => {
            const view = paymentStatusView(payment.status);
            return (
              <div key={payment.id} className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <Link href={`/account/orders/${payment.orderId}`} style={{ fontWeight: 800 }}><Ltr>{payment.orderNumber}</Ltr></Link>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                    {payment.providerRefId ? <>شماره پیگیری بانک: <Ltr>{payment.providerRefId}</Ltr></> : "در انتظار تأیید"}
                    {payment.maskedCard ? <> · <Ltr>{payment.maskedCard}</Ltr></> : null}
                  </p>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{formatJalaliDate(payment.createdAt)}</p>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Ltr className="price">{tomanFromIrr(payment.amountIrr)}</Ltr>
                  <Badge tone={view.tone}>{view.label}</Badge>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {payments.meta.totalPages > 1 ? (
        <nav className="filterbar" aria-label="صفحه‌بندی پرداخت‌ها" style={{ justifyContent: "space-between" }}>
          {page > 1 ? <Link className="btn btn-outline" href={`/account/payments?page=${page - 1}`}>صفحهٔ قبل</Link> : <span />}
          <span className="muted" style={{ fontSize: 13 }}>
            صفحهٔ {toPersianDigits(payments.meta.page)} از {toPersianDigits(payments.meta.totalPages)}
          </span>
          {page < payments.meta.totalPages ? <Link className="btn btn-outline" href={`/account/payments?page=${page + 1}`}>صفحهٔ بعد</Link> : <span />}
        </nav>
      ) : null}

      {refunds.items.length > 0 ? (
        <>
          <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 26 }}>بازگشت وجه</h2>
          <div className="grid" style={{ gap: 12 }}>
            {refunds.items.map((refund) => {
              const view = refundStatusView(refund.status);
              return (
                <div key={refund.id} className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <Link href={`/account/orders/${refund.orderId}`} style={{ fontWeight: 800 }}><Ltr>{refund.orderNumber}</Ltr></Link>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      درخواست: {formatJalaliDate(refund.requestedAt)}
                      {refund.processedAt ? <> · انجام: {formatJalaliDate(refund.processedAt)}</> : null}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <Ltr className="price">{tomanFromIrr(refund.amountIrr)}</Ltr>
                    <Badge tone={view.tone}>{view.label}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </main>
  );
}
