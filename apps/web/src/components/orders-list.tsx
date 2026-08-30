import Link from "next/link";
import { Badge, EmptyState, Ltr } from "@barat/ui";
import { PackageSearch } from "lucide-react";
import { orderStatusView } from "@/lib/status";
import type { OrderStatus } from "@barat/contracts";

export const demoOrders: { orderNumber: string; itemTitleFa: string; totalToman: string; status: OrderStatus }[] = [
  { orderNumber: "ORD-4F82AC19", itemTitleFa: "گیفت‌کارت اپل ۲۵ دلاری", totalToman: "۲٬۹۲۰٬۰۰۰ تومان", status: "FULFILLED" },
  { orderNumber: "ORD-9B10DE44", itemTitleFa: "پرداخت اشتراک OpenAI", totalToman: "۱٬۲۸۰٬۰۰۰ تومان", status: "FULFILLMENT_PENDING" },
  { orderNumber: "ORD-11A0C902", itemTitleFa: "گیفت‌کارت استیم ۵۰ دلاری", totalToman: "۶٬۴۸۰٬۰۰۰ تومان", status: "AWAITING_PAYMENT" },
];

export function OrdersList() {
  if (demoOrders.length === 0) {
    return (
      <EmptyState
        icon={<PackageSearch />}
        title="هنوز سفارشی ثبت نشده"
        description="پس از خرید، سفارش‌های شما اینجا نمایش داده می‌شود."
        action={<Link className="btn btn-primary" href="/gift-cards">شروع خرید</Link>}
      />
    );
  }
  return (
    <div className="grid" style={{ marginTop: 18, gap: 12 }}>
      {demoOrders.map((order) => {
        const view = orderStatusView(order.status);
        return (
          <Link key={order.orderNumber} href={`/orders/${order.orderNumber}`} className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <p style={{ margin: 0, fontWeight: 800 }}>{order.itemTitleFa}</p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}><Ltr>{order.orderNumber}</Ltr></p>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Ltr className="price">{order.totalToman}</Ltr>
              <Badge tone={view.tone}>{view.label}</Badge>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
