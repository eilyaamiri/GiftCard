export const metadata = { title: "تأمین‌کنندگان | پنل ادمین برات پی" };

const suppliers = [
  { name: "Tillo", assetType: "کد + پین خام", healthy: true, offers: 6 },
  { name: "Reloadly", assetType: "ایمیل مستقیم به مشتری", healthy: true, offers: 5 },
  { name: "Runa", assetType: "لینک URL", healthy: false, offers: 3 },
  { name: "Giftbit", assetType: "لینک URL / ایمیل مستقیم", healthy: true, offers: 4 },
];

export default function SuppliersPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>تأمین‌کنندگان</h1>
        </div>
        <p className="muted">نوع دارایی تحویل تعیین می‌کند اپراتور کد وارد می‌کند یا خیر</p>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>تأمین‌کننده</th>
                <th>نوع دارایی تحویل</th>
                <th>تعداد Offer</th>
                <th>وضعیت اتصال</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.name}>
                  <td>{supplier.name}</td>
                  <td>{supplier.assetType}</td>
                  <td>{supplier.offers.toLocaleString("fa-IR")}</td>
                  <td>
                    <span className={`badge ${supplier.healthy ? "badge-success" : "badge-danger"}`}>{supplier.healthy ? "متصل" : "قطع/کند"}</span>
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
