import Link from "next/link";
import { Badge, EmptyState, Ltr, formatJalaliDate, toPersianDigits } from "@barat/ui";
import { PackageSearch } from "lucide-react";
import { orderStatusView } from "@/lib/status";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { tomanFromIrr } from "@/app/checkout/purchase";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  await requireSession();
  const [profile, orders, payments, support] = await Promise.all([
    api.accountProfile(),
    api.accountOrders({ pageSize: 5 }),
    api.accountPayments({ pageSize: 1 }),
    api.supportRequests(),
  ]);

  const openTickets = support.filter((ticket) => ticket.status !== "COMPLETED" && ticket.status !== "CANCELLED").length;

  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      {profile.requiresProfileCompletion ? (
        <div className="alert warn" style={{ marginBlockEnd: 16 }}>
          برای تکمیل خرید، نام و نام خانوادگی خود را ثبت کنید.{" "}
          <Link href="/account/profile">تکمیل اطلاعات</Link>
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
        <div className="card pad">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>سفارش‌ها</p>
          <p style={{ fontSize: 28, fontWeight: 900, margin: "6px 0 0", color: "var(--navy)" }}>{toPersianDigits(orders.meta.total)}</p>
        </div>
        <div className="card pad">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>پرداخت‌ها</p>
          <p style={{ fontSize: 28, fontWeight: 900, margin: "6px 0 0", color: "var(--navy)" }}>{toPersianDigits(payments.meta.total)}</p>
        </div>
        <div className="card pad">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>پیگیری‌های باز</p>
          <p style={{ fontSize: 28, fontWeight: 900, margin: "6px 0 0", color: "var(--navy)" }}>{toPersianDigits(openTickets)}</p>
        </div>
      </div>

      <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 26 }}>آخرین سفارش‌ها</h2>
      {orders.items.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title="هنوز سفارشی ثبت نشده"
          description="پس از خرید، سفارش‌های شما اینجا نمایش داده می‌شود."
          action={<Link className="btn btn-primary" href="/gift-cards">شروع خرید</Link>}
        />
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          {orders.items.map((order) => {
            const view = orderStatusView(order.status);
            return (
              <Link key={order.id} href={`/account/orders/${order.id}`} className="card pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 800 }}><Ltr>{order.orderNumber}</Ltr></p>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{formatJalaliDate(order.createdAt, "d MMMM yyyy")}</p>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Ltr className="price">{tomanFromIrr(order.totalAmountIrr)}</Ltr>
                  <Badge tone={view.tone}>{view.label}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
