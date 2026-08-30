export const metadata = { title: "کاتالوگ | پنل ادمین برات پی" };

const products = [
  { name: "Apple Gift Card", region: "US", skus: 4, offers: 2 },
  { name: "Google Play", region: "TR", skus: 3, offers: 3 },
  { name: "PlayStation Store", region: "US", skus: 3, offers: 1 },
  { name: "Steam Wallet", region: "US", skus: 4, offers: 2 },
  { name: "Netflix Gift Card", region: "US", skus: 2, offers: 1 },
  { name: "Xbox Gift Card", region: "US", skus: 3, offers: 2 },
  { name: "Amazon.com Gift Card", region: "US", skus: 4, offers: 3 },
];

export default function CatalogPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>کاتالوگ</h1>
        </div>
        <p className="muted">{products.length.toLocaleString("fa-IR")} محصول فعال</p>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>محصول</th>
                <th>Region</th>
                <th>تعداد SKU</th>
                <th>تعداد Offer تأمین‌کننده</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.name}>
                  <td>{product.name}</td>
                  <td className="bp-ltr">{product.region}</td>
                  <td>{product.skus.toLocaleString("fa-IR")}</td>
                  <td>{product.offers.toLocaleString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
