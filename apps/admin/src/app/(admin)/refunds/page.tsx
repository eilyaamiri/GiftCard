import Link from "next/link";
import { REFUND_STATUS_VALUES, type RefundStatus } from "@barat/contracts";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { tomanFromIrr } from "@/lib/order-format";
import { REFUND_QUEUE_ROLES, REFUND_REASON_LABEL, REFUND_STATUS_LABEL, refundQueue } from "@/lib/refunds";
import { requireRole } from "@/lib/session";
import { ErrorNotice } from "../../(operator)/_components/error-notice";
import { RefundActions } from "./refund-actions";

export const metadata = { title: "بازگشت وجه | پنل ادمین سنتو" };

/**
 * The refund queue (PAY-10).
 *
 * No gateway refund API is connected, so money goes back by bank transfer. Each
 * refund takes two people — the requester cannot approve it — and is closed only
 * when finance records the transfer's bank reference.
 */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(REFUND_QUEUE_ROLES);
  const raw = (await searchParams)["status"];
  const status = REFUND_STATUS_VALUES.find((value) => value === raw) as RefundStatus | undefined;

  try {
    const refunds = await refundQueue.list(status);
    return (
      <div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">عملیات فروش</p>
            <h1>بازگشت وجه</h1>
          </div>
          <p className="muted">
            هر بازگشت وجه را فردی غیر از درخواست‌دهنده تأیید می‌کند و پس از واریز بانکی، با شمارهٔ پیگیری بسته می‌شود.
          </p>
        </div>

        <div className="filter-bar" style={{ marginBlockEnd: 14 }}>
          <Link href="/refunds" className={`filter${status === undefined ? " active" : ""}`}>
            باز
          </Link>
          {(["COMPLETED", "REJECTED"] as const).map((value) => (
            <Link key={value} href={`/refunds?status=${value}`} className={`filter${status === value ? " active" : ""}`}>
              {REFUND_STATUS_LABEL[value]}
            </Link>
          ))}
        </div>

        <div className="card list-card">
          <div className="panel-heading">
            <h2 className="panel-title">درخواست‌ها</h2>
            <span className="panel-caption">{toPersianDigits(refunds.length)} مورد</span>
          </div>
          {refunds.length === 0 ? (
            <p className="empty-hint">موردی وجود ندارد.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>سفارش</th>
                    <th>مبلغ</th>
                    <th>دلیل</th>
                    <th>درخواست / تأیید</th>
                    <th>وضعیت</th>
                    <th>زمان</th>
                    <th>اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((refund) => (
                    <tr key={refund.id}>
                      <td>
                        <Link className="bp-ltr" href={`/orders/${encodeURIComponent(refund.orderNumber)}`}>
                          {refund.orderNumber}
                        </Link>
                        {refund.provider ? (
                          <>
                            <br />
                            <span className="muted bp-ltr">{refund.provider}</span>
                          </>
                        ) : null}
                      </td>
                      <td className="bp-ltr">{tomanFromIrr(refund.amountIrr)}</td>
                      <td>{REFUND_REASON_LABEL[refund.reason] ?? refund.reason}</td>
                      <td>
                        {refund.requestedByName ?? "سیستم"}
                        <br />
                        <span className="muted">{refund.approvedByName ?? "—"}</span>
                      </td>
                      <td>
                        {REFUND_STATUS_LABEL[refund.status]}
                        {refund.bankReference ? (
                          <>
                            <br />
                            <span className="muted bp-ltr">{refund.bankReference}</span>
                          </>
                        ) : null}
                      </td>
                      <td className="bp-ltr">{formatJalaliDate(refund.requestedAt)}</td>
                      <td>
                        <RefundActions refund={refund} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  } catch (error) {
    return <ErrorNotice error={error} title="صف بازگشت وجه بارگذاری نشد" />;
  }
}
