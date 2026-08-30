import Link from "next/link";
import { mockPayments, formatExactAmount, PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL } from "@/lib/mock-payments";

export const metadata = { title: "پرداخت‌ها | پنل ادمین برات پی" };

export default function PaymentsPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات فروش</p>
          <h1>پرداخت‌ها</h1>
        </div>
        <p className="muted">تمام صحت‌سنجی‌ها سمت سرور انجام می‌شود — هیچ پارامتر بازگشتی درگاه مستقیماً پذیرفته نمی‌شود</p>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>سفارش</th>
                <th>Authority</th>
                <th>RefId</th>
                <th>مبلغ درگاه</th>
                <th>کارت (masked)</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {mockPayments.map((payment) => (
                <tr key={payment.id}>
                  <td className="order-id">{payment.orderNumber}</td>
                  <td>
                    <Link href={`/payments/${payment.id}`} className="bp-ltr" style={{ color: "var(--teal)", fontWeight: 700 }}>
                      {payment.authority.slice(0, 14)}…
                    </Link>
                  </td>
                  <td className="bp-ltr">{payment.refId ?? "—"}</td>
                  <td className="bp-ltr">
                    {formatExactAmount(payment.providerAmount)} {payment.providerAmountUnit}
                  </td>
                  <td className="bp-ltr">{payment.maskedCard ?? "—"}</td>
                  <td>
                    <span className={`badge ${PAYMENT_STATUS_BADGE[payment.status]}`}>{PAYMENT_STATUS_LABEL[payment.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
