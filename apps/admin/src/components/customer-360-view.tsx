import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import type { Customer360 } from "@/lib/customer-360";
import { formatDateTime, tomanFromIrr } from "@/lib/order-format";

const CUSTOMER_STATUS: Record<string, string> = {
  ACTIVE: "فعال", BLOCKED: "مسدود", MERGED: "ادغام‌شده", DELETED: "حذف‌شده",
};

export function Customer360View({
  data,
  basePath,
  canAddNote,
  addNoteAction,
  saved,
}: {
  data: Customer360;
  basePath: string;
  canAddNote: boolean;
  addNoteAction: (formData: FormData) => Promise<void>;
  saved: boolean;
}) {
  const customer = data.customer;
  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "بدون نام ثبت‌شده";
  const ticketBasePath = basePath.startsWith("/operator") ? "/operator/support" : "/support";

  return (
    <div>
      <div className="breadcrumb"><Link href={basePath}>نمای ۳۶۰ مشتری</Link><span>/</span><span>{customer.customerCode}</span></div>
      <div className="page-heading">
        <div><p className="eyebrow">CUSTOMER 360 · READ AUDITED</p><h1>{fullName}</h1></div>
        <span className="tag-pill">{CUSTOMER_STATUS[customer.status] ?? customer.status}</span>
      </div>

      <div className="stat-strip customer-kpis">
        <Stat label="ارزش طول عمر پرداخت‌شده" value={tomanFromIrr(data.totals.lifetimePaidIrr)} />
        <Stat label="تعداد سفارش" value={number(data.totals.orderCount)} />
        <Stat label="سفارش پرداخت‌شده" value={number(data.totals.paidOrderCount)} />
        <Stat label="بازگشت وجه" value={number(data.refunds.length)} />
      </div>

      <div className="two-col">
        <div className="workspace-main">
          <Section title="سفارش‌ها" caption={`${number(data.orders.length)} رکورد`}>
            {data.orders.length === 0 ? <Empty text="سفارشی ثبت نشده است." /> : <div className="table-wrap"><table><thead><tr><th>شماره سفارش</th><th>وضعیت</th><th>مبلغ</th><th>ثبت</th><th>پرداخت</th><th>تحویل</th></tr></thead><tbody>{data.orders.map((order) => <tr key={order.id}><td><span className="order-id">{order.orderNumber}</span></td><td>{order.status}</td><td>{tomanFromIrr(order.totalAmountIrr)}</td><td>{formatDateTime(order.createdAt)}</td><td>{order.paidAt ? formatDateTime(order.paidAt) : "—"}</td><td>{order.fulfilledAt ? formatDateTime(order.fulfilledAt) : "—"}</td></tr>)}</tbody></table></div>}
          </Section>
          <Section title="تیکت‌های پشتیبانی" caption={`${number(data.tickets.length)} تیکت`}>
            {data.tickets.length === 0 ? <Empty text="تیکتی ثبت نشده است." /> : <div className="table-wrap"><table><thead><tr><th>شماره تیکت</th><th>موضوع</th><th>وضعیت</th><th>سفارش</th><th>مالک فعلی</th><th>مهلت پاسخ</th></tr></thead><tbody>{data.tickets.map((ticket) => <tr key={ticket.id}><td><Link href={`${ticketBasePath}/${encodeURIComponent(ticket.id)}`} className="order-id">{ticket.code}</Link></td><td>{ticket.subject}</td><td>{ticket.status}</td><td>{ticket.orderNumber ?? "—"}</td><td>{ticket.ownerStaffName ?? "بدون مالک"}</td><td>{formatDateTime(ticket.nextResponseDueAt)}</td></tr>)}</tbody></table></div>}
          </Section>
          <Section title="پرداخت‌ها" caption={`${number(data.payments.length)} رکورد`}>
            {data.payments.length === 0 ? <Empty text="پرداختی ثبت نشده است." /> : <div className="table-wrap"><table><thead><tr><th>سفارش</th><th>درگاه</th><th>وضعیت</th><th>مبلغ</th><th>کارت ماسک‌شده</th><th>مرجع</th><th>تأیید</th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td>{payment.orderNumber}</td><td>{payment.provider}</td><td>{payment.status}</td><td>{tomanFromIrr(payment.amountIrr)}</td><td>{payment.maskedCard ?? "—"}</td><td>{payment.providerRefId ?? "—"}</td><td>{payment.verifiedAt ? formatDateTime(payment.verifiedAt) : "—"}</td></tr>)}</tbody></table></div>}
          </Section>
          <Section title="بازگشت وجه" caption={`${number(data.refunds.length)} رکورد`}>
            {data.refunds.length === 0 ? <Empty text="بازگشت وجهی ثبت نشده است." /> : <div className="table-wrap"><table><thead><tr><th>سفارش</th><th>مبلغ</th><th>وضعیت</th><th>درخواست</th><th>پردازش</th></tr></thead><tbody>{data.refunds.map((refund) => <tr key={refund.id}><td>{refund.orderNumber}</td><td>{tomanFromIrr(refund.amountIrr)}</td><td>{refund.status}</td><td>{formatDateTime(refund.requestedAt)}</td><td>{refund.processedAt ? formatDateTime(refund.processedAt) : "—"}</td></tr>)}</tbody></table></div>}
          </Section>
        </div>

        <aside className="workspace-control">
          <Section title="هویت و تماس" caption={customer.customerCode}>
            <div className="kv-list">
              <Kv label="موبایل" value={customer.maskedMobile ?? "ثبت نشده"} verified={customer.isMobileVerified} />
              <Kv label="ایمیل" value={customer.maskedEmail ?? "ثبت نشده"} verified={customer.isEmailVerified} />
              <Kv label="زبان" value={data.profile.preferredLanguage === "fa" ? "فارسی" : data.profile.preferredLanguage} />
              <Kv label="بازاریابی" value={data.profile.marketingOptIn ? "مجاز" : "غیرفعال"} />
              <Kv label="عضویت" value={formatDateTime(customer.createdAt)} />
            </div>
          </Section>
          <Section title="پرچم‌های بررسی" caption={`${number(data.flags.length)} فعال`}>
            {data.flags.length === 0 ? <Empty text="پرچم فعالی وجود ندارد." /> : <div className="attention-list">{data.flags.map((flag) => <div className="warning customer-flag" key={flag.key}><strong>{flag.key}</strong><span>{flag.reason ?? "بدون توضیح"}</span><small>{formatDateTime(flag.createdAt)}</small></div>)}</div>}
          </Section>
          <Section title="یادداشت‌های داخلی" caption={`${number(data.notes.length)} یادداشت`}>
            {saved ? <p className="customer-save-success">یادداشت ثبت شد.</p> : null}
            {canAddNote ? <form action={addNoteAction} className="customer-note-form"><label>یادداشت<textarea name="body" minLength={1} maxLength={2000} required placeholder="اطلاعات پیگیری داخلی؛ بدون دادهٔ حساس" /></label><label className="customer-pin"><input type="checkbox" name="isPinned" value="true" /> سنجاق شود</label><p className="warning">کد یا PIN گیفت‌کارت، توکن پرداخت، اطلاعات ورود و دادهٔ احراز هویت را هرگز در یادداشت وارد نکنید.</p><button className="primary-btn" type="submit">ثبت یادداشت</button></form> : <p className="panel-caption">نقش فعلی فقط دسترسی مشاهده دارد.</p>}
            <div className="customer-note-list">{data.notes.map((note) => <article key={note.id} className="customer-note"><strong>{note.isPinned ? "سنجاق‌شده" : "یادداشت"}</strong><p>{note.body}</p><small>{formatDateTime(note.createdAt)}</small></article>)}</div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return <section className="card panel"><div className="section-label"><h2>{title}</h2><span>{caption}</span></div>{children}</section>;
}
function Stat({ label, value }: { label: string; value: string }) { return <div className="card stat-tile"><span>{label}</span><strong>{value}</strong></div>; }
function Kv({ label, value, verified }: { label: string; value: string; verified?: boolean }) { return <div className="kv-row"><span>{label}</span><span>{value}{verified === undefined ? "" : verified ? " · تأییدشده" : " · تأییدنشده"}</span></div>; }
function Empty({ text }: { text: string }) { return <p className="empty-hint">{text}</p>; }
function number(value: number): string { return toPersianDigits(value.toLocaleString("en-US")); }
