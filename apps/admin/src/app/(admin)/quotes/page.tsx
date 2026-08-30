import { formatToman, CountdownTimer } from "@barat/ui";

export const metadata = { title: "استعلام‌ها | پنل ادمین برات پی" };

interface QuoteRow {
  id: string;
  customer: string;
  sku: string;
  amountIrr: bigint;
  status: "ACTIVE" | "EXPIRED" | "ACCEPTED" | "CANCELLED";
  expiresAt: string;
}

const STATUS_LABEL: Record<QuoteRow["status"], string> = { ACTIVE: "فعال", EXPIRED: "منقضی", ACCEPTED: "پذیرفته‌شده", CANCELLED: "لغوشده" };
const STATUS_BADGE: Record<QuoteRow["status"], string> = { ACTIVE: "badge-info", EXPIRED: "badge-danger", ACCEPTED: "badge-success", CANCELLED: "badge-wait" };

const quotes: QuoteRow[] = [
  { id: "QT-88213", customer: "امیر حسینی", sku: "Apple Gift Card 50 USD (US)", amountIrr: 96_500_000n, status: "ACCEPTED", expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() },
  { id: "QT-88212", customer: "نیلوفر کریمی", sku: "Google Play 25 USD (TR)", amountIrr: 49_800_000n, status: "ACTIVE", expiresAt: new Date(Date.now() + 6 * 60_000).toISOString() },
  { id: "QT-88211", customer: "رضا صادقی", sku: "ChatGPT Plus — یک ماهه", amountIrr: 41_200_000n, status: "EXPIRED", expiresAt: new Date(Date.now() - 60_000).toISOString() },
  { id: "QT-88210", customer: "الهام رستمی", sku: "PlayStation 50 USD (US)", amountIrr: 96_000_000n, status: "CANCELLED", expiresAt: new Date(Date.now() - 3 * 60_000).toISOString() },
];

export default function QuotesPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات فروش</p>
          <h1>استعلام‌ها</h1>
        </div>
        <p className="muted">TTL پیش‌فرض ۵ دقیقه — پس از انقضا استعلام جدید صادر می‌شود</p>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>شناسهٔ استعلام</th>
                <th>مشتری</th>
                <th>محصول</th>
                <th>مبلغ</th>
                <th>وضعیت</th>
                <th>زمان باقی‌مانده</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr key={quote.id}>
                  <td className="order-id">{quote.id}</td>
                  <td>{quote.customer}</td>
                  <td>{quote.sku}</td>
                  <td>{formatToman(quote.amountIrr)}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[quote.status]}`}>{STATUS_LABEL[quote.status]}</span>
                  </td>
                  <td>{quote.status === "ACTIVE" ? <CountdownTimer expiresAt={quote.expiresAt} /> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
