export const metadata = { title: "گزارش رخدادها | پنل ادمین برات پی" };

const events = [
  { actor: "سارا احمدی", action: "FX_RATE_OVERRIDE_SET", target: "USD_IRR", time: "۱۰:۱۲", detail: "override به مدت ۳۰ دقیقه با دلیل ثبت‌شده" },
  { actor: "محمد رضایی", action: "GIFT_CARD_ASSET_SAVED", target: "WI-77410", time: "۱۰:۰۸", detail: "کد و پین ذخیره و رمزنگاری شد" },
  { actor: "سیستم", action: "AMOUNT_MISMATCH", target: "ORDER-BP-10429", time: "۰۹:۵۰", detail: "عدم تطابق مبلغ Quote و Payment — سفارش متوقف شد" },
  { actor: "نیلوفر کریمی", action: "PRICING_RULE_UPDATED", target: "targetMarginBps", time: "۰۹:۳۰", detail: "از ۷۵۰ به ۸۰۰ bps تغییر یافت" },
  { actor: "سیستم", action: "PAYMENT_VERIFIED", target: "PAY-55021", time: "۰۹:۲۲", detail: "صحت‌سنجی سمت سرور موفق" },
];

export default function AuditPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات و بازرسی</p>
          <h1>گزارش رخدادها</h1>
        </div>
        <p className="muted">Append-only — هیچ رکوردی ویرایش یا حذف نمی‌شود</p>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>زمان</th>
                <th>عامل</th>
                <th>رخداد</th>
                <th>هدف</th>
                <th>جزئیات</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, index) => (
                <tr key={index}>
                  <td className="bp-ltr muted">{event.time}</td>
                  <td>{event.actor}</td>
                  <td className="bp-ltr" style={{ color: "var(--teal)", fontWeight: 700 }}>{event.action}</td>
                  <td className="bp-ltr">{event.target}</td>
                  <td className="muted">{event.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
