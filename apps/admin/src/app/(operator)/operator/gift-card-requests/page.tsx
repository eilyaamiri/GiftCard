import Link from "next/link";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { giftCardRequests, GIFT_CARD_REQUEST_KIND_LABEL, GIFT_CARD_REQUEST_STATUS_LABEL } from "@/lib/gift-card-requests";
import { OPERATOR_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { ErrorNotice } from "../../_components/error-notice";

export const metadata = { title: "درخواست‌های کد من | میزکار اپراتور برات پی" };

export default async function OperatorGiftCardRequestsPage() {
  await requireRole(OPERATOR_ROLES);
  try {
    const requests = await giftCardRequests.mine();
    return <div>
      <div className="page-heading"><div><p className="eyebrow">میزکار</p><h1>درخواست‌های کد من</h1></div><p className="muted">پیگیری کد و پین‌های درخواستی بر اساس شماره سفارش و تسک</p></div>
      <div className="stat-strip"><div className="card stat-tile"><span>در انتظار ادمین</span><strong>{toPersianDigits(requests.filter((item) => item.status === "OPEN").length)}</strong></div><div className="card stat-tile"><span>آماده استفاده</span><strong>{toPersianDigits(requests.filter((item) => item.status === "FULFILLED").length)}</strong></div></div>
      <div className="card list-card">{requests.length === 0 ? <p className="empty-hint">هنوز درخواستی ندارید. درخواست را از صفحهٔ تسک گیفت‌کارت ثبت کنید.</p> : <div className="table-wrap"><table><thead><tr><th>پیگیری</th><th>سفارش</th><th>تسک</th><th>نوع</th><th>وضعیت</th><th>ثبت</th><th>اقدام</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td className="bp-ltr">{request.requestNumber}</td><td className="bp-ltr">{request.orderNumber}</td><td className="bp-ltr">{request.workItemCode}</td><td>{GIFT_CARD_REQUEST_KIND_LABEL[request.kind]}</td><td>{GIFT_CARD_REQUEST_STATUS_LABEL[request.status]}{request.maskedCode ? <><br /><span className="muted bp-ltr">{request.maskedCode}</span></> : null}</td><td className="bp-ltr">{formatJalaliDate(request.requestedAt)}</td><td><Link className="secondary-btn" href={`/operator/tasks/${request.workItemId}`}>{request.status === "FULFILLED" ? "مشاهده امن کد" : "مشاهده تسک"}</Link></td></tr>)}</tbody></table></div>}</div>
    </div>;
  } catch (error) { return <ErrorNotice error={error} title="درخواست‌های شما بارگذاری نشد" />; }
}
