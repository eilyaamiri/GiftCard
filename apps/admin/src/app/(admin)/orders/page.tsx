import Link from "next/link";
import { formatToman } from "@barat/ui";
import { mockOrders, ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "@/lib/mock-orders";

export const metadata = { title: "سفارش‌ها | پنل ادمین برات پی" };

const FILTERS = ["همه", "پرداخت‌شده", "در حال تحویل", "تحویل‌شده", "ناموفق", "بازگشت‌وجه"];

export default function OrdersPage() {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات فروش</p>
          <h1>سفارش‌ها</h1>
        </div>
        <p className="muted">{mockOrders.length.toLocaleString("fa-IR")} سفارش در ۲۴ ساعت گذشته</p>
      </div>

      <div className="filter-bar">
        {FILTERS.map((filter, index) => (
          <button key={filter} type="button" className={`filter${index === 0 ? " active" : ""}`}>
            {filter}
          </button>
        ))}
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>شمارهٔ سفارش</th>
                <th>مشتری</th>
                <th>محصول</th>
                <th>وضعیت</th>
                <th>مبلغ</th>
                <th>زمان ثبت</th>
              </tr>
            </thead>
            <tbody>
              {mockOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link href={`/orders/${order.id}`} className="order-id">
                      {order.number}
                    </Link>
                  </td>
                  <td>{order.customer}</td>
                  <td>{order.sku}</td>
                  <td>
                    <span className={`badge ${ORDER_STATUS_BADGE[order.status]}`}>{ORDER_STATUS_LABEL[order.status]}</span>
                  </td>
                  <td>{formatToman(order.totalIrr)}</td>
                  <td className="muted">{order.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
