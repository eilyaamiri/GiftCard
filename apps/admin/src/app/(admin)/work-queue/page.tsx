export const metadata = { title: "صف کارها | پنل ادمین برات پی" };

const queues = [
  { name: "تحویل دستی گیفت‌کارت", key: "GIFT_CARD_MANUAL", total: 14, unassigned: 4, overdue: 1, slaMinutes: 15 },
  { name: "پرداخت SaaS", key: "SAAS_PAYMENT", total: 6, unassigned: 1, overdue: 0, slaMinutes: 30 },
  { name: "ابزارهای AI", key: "AI_TOOLS", total: 5, unassigned: 2, overdue: 0, slaMinutes: 30 },
  { name: "دامنه و هاستینگ", key: "DOMAIN_HOSTING", total: 3, unassigned: 0, overdue: 0, slaMinutes: 60 },
  { name: "پیگیری تأمین‌کننده", key: "SUPPLIER_ISSUE", total: 4, unassigned: 1, overdue: 2, slaMinutes: 45 },
  { name: "نیازمند اطلاعات مشتری", key: "CUSTOMER_INFO_REQUIRED", total: 3, unassigned: 0, overdue: 1, slaMinutes: 120 },
  { name: "نتیجهٔ نامشخص تأمین‌کننده", key: "UNKNOWN_OUTCOME", total: 2, unassigned: 2, overdue: 0, slaMinutes: 30 },
  { name: "بررسی بازگشت‌وجه", key: "REFUND_REVIEW", total: 2, unassigned: 0, overdue: 0, slaMinutes: 240 },
];

export default function WorkQueuePage() {
  const totals = queues.reduce(
    (acc, q) => ({ total: acc.total + q.total, unassigned: acc.unassigned + q.unassigned, overdue: acc.overdue + q.overdue }),
    { total: 0, unassigned: 0, overdue: 0 },
  );

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات و بازرسی</p>
          <h1>صف کارها</h1>
        </div>
        <p className="muted">دید مدیریتی روی همهٔ صف‌ها — کار فردی در میزکار اپراتور انجام می‌شود</p>
      </div>

      <div className="stat-strip">
        <div className="card stat-tile"><span>کل تسک‌های باز</span><strong>{totals.total.toLocaleString("fa-IR")}</strong></div>
        <div className="card stat-tile"><span>بدون تخصیص</span><strong>{totals.unassigned.toLocaleString("fa-IR")}</strong></div>
        <div className="card stat-tile"><span>عقب‌افتاده از SLA</span><strong className="freshness-bad">{totals.overdue.toLocaleString("fa-IR")}</strong></div>
        <div className="card stat-tile"><span>تعداد صف فعال</span><strong>{queues.length.toLocaleString("fa-IR")}</strong></div>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>صف</th>
                <th>کل تسک</th>
                <th>بدون تخصیص</th>
                <th>عقب‌افتاده</th>
                <th>SLA هدف</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((queue) => (
                <tr key={queue.key}>
                  <td>{queue.name}</td>
                  <td>{queue.total.toLocaleString("fa-IR")}</td>
                  <td>{queue.unassigned.toLocaleString("fa-IR")}</td>
                  <td>{queue.overdue > 0 ? <span className="badge badge-danger">{queue.overdue.toLocaleString("fa-IR")} عقب‌افتاده</span> : <span className="muted">۰</span>}</td>
                  <td className="bp-ltr">{queue.slaMinutes}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
