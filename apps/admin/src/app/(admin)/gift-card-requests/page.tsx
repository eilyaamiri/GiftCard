import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { giftCardRequests, GIFT_CARD_REQUEST_KIND_LABEL, GIFT_CARD_REQUEST_STATUS_LABEL } from "@/lib/gift-card-requests";
import { requireRole } from "@/lib/session";
import { GIFT_CARD_REQUEST_ADMIN_ROLES } from "@/lib/gift-card-requests";
import { FulfillGiftCardRequestForm } from "./fulfill-form";
import { ErrorNotice } from "../../(operator)/_components/error-notice";

export const metadata = { title: "درخواست‌های کد گیفت‌کارت | پنل ادمین برات پی" };

export default async function GiftCardRequestsPage() {
  await requireRole(GIFT_CARD_REQUEST_ADMIN_ROLES);
  try {
    const requests = await giftCardRequests.list();
    return <div>
      <div className="page-heading"><div><p className="eyebrow">عملیات و بازرسی</p><h1>درخواست‌های کد گیفت‌کارت</h1></div><p className="muted">درخواست‌های متصل به تسک و سفارش را بررسی و تکمیل کنید.</p></div>
      <div className="card list-card"><div className="panel-heading"><h2 className="panel-title">صف درخواست‌ها</h2><span className="panel-caption">{toPersianDigits(requests.filter((item) => item.status === "OPEN").length)} مورد باز</span></div>
        {requests.length === 0 ? <p className="empty-hint">درخواستی ثبت نشده است.</p> : <div className="table-wrap"><table><thead><tr><th>پیگیری</th><th>سفارش / تسک</th><th>درخواست‌کننده</th><th>نوع</th><th>وضعیت</th><th>زمان</th><th>اقدام</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
          <td className="bp-ltr">{request.requestNumber}</td><td><span className="bp-ltr">{request.orderNumber}</span><br /><span className="muted bp-ltr">{request.workItemCode}</span></td><td>{request.requestedByStaffName}</td><td>{GIFT_CARD_REQUEST_KIND_LABEL[request.kind]}</td><td>{GIFT_CARD_REQUEST_STATUS_LABEL[request.status]}{request.maskedCode ? <><br /><span className="muted bp-ltr">{request.maskedCode}</span></> : null}</td><td className="bp-ltr">{formatJalaliDate(request.requestedAt)}</td><td>{request.status === "OPEN" ? <FulfillGiftCardRequestForm requestId={request.id} needsPin={request.kind === "CODE_PIN"} /> : <span className="muted">تکمیل‌شده</span>}</td>
        </tr>)}</tbody></table></div>}
      </div>
    </div>;
  } catch (error) { return <ErrorNotice error={error} title="درخواست‌های کد بارگذاری نشد" />; }
}
